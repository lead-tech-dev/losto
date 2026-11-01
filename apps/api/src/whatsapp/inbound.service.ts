import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { fmtLocal } from '../care/care-time';
import { ReadingsService } from '../care/readings.service';
import { implausible, ReadingInput } from '../care/thresholds';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import {
  alerts,
  consultations,
  deliveries,
  homeVisits,
  labRequests,
  Patient,
  patients,
  prescriptions,
  users,
  whatsappMessages,
} from '../db/schema';
import { NotifyService } from '../mail/notify.service';
import { AssistantLlm } from './assistant';
import { intentOf, mentionsMedical, parseReadings, simplify } from './parse';
import { WhatsAppService } from './whatsapp.service';

export interface IncomingMessage {
  from: string; // chiffres, indicatif compris
  waId: string;
  type: string; // text, audio, image…
  text?: string;
  at?: Date;
}

export const EMERGENCY_REPLY =
  'Si c’est grave, appelez tout de suite le 119 (urgences médicales) ou faites-vous conduire aux urgences de l’hôpital le plus proche. ' +
  'Nous prévenons immédiatement votre famille et votre médecin.';

const MENU =
  'Vous pouvez m’écrire :\n' +
  '- votre tension, par exemple « 13/8 » ou « 135/85 »\n' +
  '- votre glycémie, par exemple « glycémie 1,2 »\n' +
  '- « OK » quand vous avez pris vos médicaments\n' +
  '- « rendez-vous » ou « livraison » pour savoir où on en est\n' +
  '- ou votre question : l’équipe vous répond.\n' +
  'En cas d’urgence, appelez le 119.';

// Traite chaque message reçu d'un parent : mesure, urgence, consentement, question…
// Ordre volontaire : l'urgence passe avant tout le reste.
@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly wa: WhatsAppService,
    private readonly readings: ReadingsService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly assistant: AssistantLlm,
  ) {}

  async handle(msg: IncomingMessage): Promise<{ duplicate?: boolean; patientId?: string | null; action: string }> {
    const text = (msg.text ?? '').trim();
    const [row] = await this.db
      .insert(whatsappMessages)
      .values({
        phone: msg.from,
        direction: 'IN',
        kind: 'incoming',
        body: msg.type === 'text' ? text : `[message ${msg.type}]`,
        waId: msg.waId,
        status: 'RECEIVED',
        createdAt: msg.at,
      })
      .onConflictDoNothing({ target: whatsappMessages.waId })
      .returning();
    if (!row) return { duplicate: true, action: 'duplicate' }; // Meta renvoie parfois le même message

    const candidates = await this.db
      .select()
      .from(patients)
      .where(sql`regexp_replace(${patients.whatsappPhone}, '\\D', '', 'g') = ${msg.from}`)
      .orderBy(asc(patients.createdAt));

    const reply = (kind: string, body: string, patientId?: string | null) =>
      this.wa.send({ phone: msg.from, kind, text: body, patientId: patientId ?? null });
    const flag = (patientId?: string | null) =>
      this.db.update(whatsappMessages).set({ needsHuman: true, patientId: patientId ?? null }).where(eq(whatsappMessages.id, row.id));

    if (!candidates.length) {
      await flag(null);
      await reply(
        'unknown_sender',
        'Bonjour, ici Proche Santé. Ce numéro ne correspond à aucun parent suivi. Si vous êtes de la famille, votre espace est sur ' +
          `${appUrl('/')}. Un membre de l’équipe va lire votre message.`,
      );
      return { patientId: null, action: 'unknown_sender' };
    }

    // Urgence : toutes les personnes suivies sur ce numéro sont concernées (on ne prend pas le temps de demander qui)
    if (msg.type === 'text' && intentOf(text) === 'EMERGENCY') {
      await flag(candidates[0].id);
      await reply('emergency', EMERGENCY_REPLY, candidates[0].id);
      for (const p of candidates) await this.raiseEmergency(p, text);
      return { patientId: candidates[0].id, action: 'emergency' };
    }

    // Numéro partagé (souvent un couple) : le prénom en début de message dit de qui il s'agit
    const s = simplify(text);
    const named = candidates.filter((c) => s.includes(simplify(c.firstName)));
    const patient: Patient | undefined = candidates.length === 1 ? candidates[0] : named.length === 1 ? named[0] : undefined;
    // « Marie ok » → « ok » : le prénom en tête ne sert qu'à désigner la personne
    const lead = candidates.find((c) => s.startsWith(`${simplify(c.firstName)} `));
    const content = lead ? text.slice(lead.firstName.length).replace(/^[\s,:;-]+/, '') : text;
    const intent = intentOf(content);
    await this.db.update(whatsappMessages).set({ patientId: (patient ?? candidates[0]).id }).where(eq(whatsappMessages.id, row.id));

    if (msg.type !== 'text') {
      await flag((patient ?? candidates[0]).id);
      await reply('handoff', 'Je ne sais lire que les messages écrits. Un membre de l’équipe va écouter votre message et vous répondre.', patient?.id);
      await this.notify.admins(`WhatsApp : message ${msg.type} à écouter`, `Message ${msg.type} reçu du +${msg.from}.\n${appUrl('/admin/whatsapp')}`);
      return { patientId: patient?.id, action: 'non_text' };
    }

    const parsed = parseReadings(content);
    const patientSpecific = parsed.length > 0 || ['YES', 'TAKEN', 'STOP', 'START'].includes(intent);
    if (!patient && patientSpecific) {
      const names = candidates.map((c) => c.firstName);
      await reply(
        'which_patient',
        `Ce numéro est utilisé pour ${names.join(' et ')}. Commencez votre message par le prénom, par exemple « ${names[0]} 13/8 ».`,
      );
      return { patientId: null, action: 'which_patient' };
    }
    const p = patient ?? candidates[0];

    switch (intent) {
      case 'STOP':
        await this.db.update(patients).set({ whatsappOptOutAt: new Date() }).where(eq(patients.id, p.id));
        await this.audit.log(null, 'whatsapp.opt_out', 'Patient', p.id);
        await reply('opt_out', 'C’est noté : vous ne recevrez plus de messages automatiques de Proche Santé. Pour reprendre, répondez REPRENDRE.', p.id);
        await this.notify.family(
          p.id,
          `${p.firstName} a arrêté les messages WhatsApp`,
          `${p.firstName} a répondu STOP : les rappels WhatsApp sont suspendus. Le médecin continue d'appeler aux rendez-vous. ${p.firstName} peut reprendre en répondant REPRENDRE.`,
        );
        return { patientId: p.id, action: 'opt_out' };
      case 'START':
        await this.db.update(patients).set({ whatsappOptOutAt: null }).where(eq(patients.id, p.id));
        await reply('opt_in', `C’est noté, les messages reprennent. ${MENU}`, p.id);
        return { patientId: p.id, action: 'opt_in' };
      case 'YES':
        if (!p.consentGivenAt) {
          await this.db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, p.id));
          await this.audit.log(null, 'patient.consent.whatsapp', 'Patient', p.id);
          await reply('consent', `Merci ${p.firstName}, c’est noté. Bienvenue chez Proche Santé.\n${MENU}`, p.id);
          await this.notify.family(p.id, `${p.firstName} a accepté le suivi`, `${p.firstName} a accepté le suivi Proche Santé en répondant OUI sur WhatsApp.`);
          return { patientId: p.id, action: 'consent' };
        }
        await reply('assistant', `C’est noté, merci. ${MENU}`, p.id);
        return { patientId: p.id, action: 'yes' };
      case 'TAKEN':
        return this.taken(p, reply);
    }

    if (parsed.length) return this.readingsMessage(p, text, parsed, flag, reply);

    switch (intent) {
      case 'GREETING':
      case 'HELP':
        await reply('assistant', `Bonjour ${p.firstName}. ${MENU}`, p.id);
        return { patientId: p.id, action: 'menu' };
      case 'NEXT_APPOINTMENT':
        await reply('assistant', await this.nextAppointmentText(p), p.id);
        return { patientId: p.id, action: 'appointment' };
      case 'DELIVERY':
        await reply('assistant', await this.deliveryText(p), p.id);
        return { patientId: p.id, action: 'delivery' };
      case 'BILLING':
        await reply('assistant', 'L’abonnement et les paiements sont gérés par votre famille depuis son espace en ligne : vous n’avez rien à payer ici. Les médicaments sont réglés par votre famille avant la livraison.', p.id);
        return { patientId: p.id, action: 'billing' };
      case 'MEDICAL':
        return this.handoff(p, text, true, flag, reply);
    }

    // Autre question : l'assistant répond s'il est activé et que la question est pratique ; sinon un humain
    if (this.assistant.enabled) {
      const r = await this.assistant.reply(text, await this.facts(p));
      if (!r.medical && r.answer) {
        await reply('assistant', r.answer, p.id);
        return { patientId: p.id, action: 'assistant' };
      }
      return this.handoff(p, text, r.medical, flag, reply);
    }
    return this.handoff(p, text, false, flag, reply);
  }

  // ---------- Cas particuliers ----------

  private async raiseEmergency(p: Patient, text: string) {
    await this.db.insert(alerts).values({
      patientId: p.id,
      doctorId: p.doctorId,
      severity: 'URGENT',
      message: `Message d'urgence sur WhatsApp : « ${text.slice(0, 200)} »`,
    });
    await this.audit.log(null, 'whatsapp.emergency', 'Patient', p.id);
    const body =
      `${p.firstName} a envoyé un message inquiétant sur WhatsApp :\n« ${text} »\n\n` +
      `Nous lui avons dit d'appeler le 119 ou d'aller aux urgences. Appelez ${p.firstName} au ${p.whatsappPhone} ` +
      `ou demandez à un proche sur place de passer.`;
    await this.notify.family(p.id, `URGENT : message inquiétant de ${p.firstName}`, body);
    await this.notify.user(p.doctorId, `URGENT · ${p.firstName} ${p.lastName} : message d'urgence`, `${body}\n\nDossier : ${appUrl(`/medecin/patients/${p.id}`)}`);
    await this.notify.admins(`URGENT · WhatsApp de ${p.firstName} ${p.lastName}`, `${body}\n\n${appUrl('/admin/whatsapp')}`);
  }

  private async taken(p: Patient, reply: (k: string, b: string, id?: string | null) => Promise<unknown>) {
    const [last] = await this.db
      .select({ id: whatsappMessages.id })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.patientId, p.id),
          eq(whatsappMessages.kind, 'med_reminder'),
          isNull(whatsappMessages.acknowledgedAt),
          gt(whatsappMessages.createdAt, new Date(Date.now() - 12 * 3600_000)),
        ),
      )
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(1);
    if (last) await this.db.update(whatsappMessages).set({ acknowledgedAt: new Date() }).where(eq(whatsappMessages.id, last.id));
    await reply('reading_ack', last ? `Bravo ${p.firstName}, c’est noté.` : 'Merci, c’est noté.', p.id);
    return { patientId: p.id, action: 'taken' };
  }

  private async readingsMessage(
    p: Patient,
    text: string,
    parsed: ReturnType<typeof parseReadings>,
    flag: (id?: string | null) => Promise<unknown>,
    reply: (k: string, b: string, id?: string | null) => Promise<unknown>,
  ) {
    const questions = parsed.filter((x) => !x.ok).map((x) => (x as { question: string }).question);
    const good = parsed.filter((x) => x.ok) as { ok: true; reading: ReadingInput; label: string; note?: string }[];
    const rejected = good.filter((g) => implausible(g.reading));
    const valid = good.filter((g) => !implausible(g.reading));

    const lines: string[] = [];
    if (valid.length) {
      const created = await this.db.transaction((tx) =>
        this.readings.record(
          tx,
          p,
          valid.map((v) => v.reading),
          { source: 'WHATSAPP' },
        ),
      );
      lines.push(`Bien reçu, ${valid.map((v) => (v.note ? `${v.label} (${v.note})` : v.label)).join(' et ')}.`);
      if (created.some((a) => a.severity === 'URGENT')) {
        lines.push(
          'Cette valeur est préoccupante : votre médecin et votre famille sont prévenus. Si vous avez mal à la tête ou à la poitrine, ' +
            'du mal à parler, à respirer ou à voir, ou si vous vous sentez très mal, appelez le 119.',
        );
      } else if (created.length) {
        lines.push('Cette valeur est à surveiller : votre médecin est prévenu. Refaites une mesure demain à la même heure.');
      } else {
        lines.push('Merci.');
      }
      if (created.length) {
        await this.readings.emailDoctor(p, created);
        await this.notify.family(
          p.id,
          `Relevé à surveiller pour ${p.firstName}`,
          `${p.firstName} a envoyé un relevé sur WhatsApp : ${created.map((a) => a.message).join(', ')}.\n` +
            `Son médecin est prévenu.${created.some((a) => a.severity === 'URGENT') ? ` Un appel à ${p.firstName} (${p.whatsappPhone}) est bienvenu.` : ''}`,
        );
      }
    }
    if (rejected.length) {
      lines.push(
        `Je n’ai pas enregistré ${rejected.map((r) => r.label).join(' ni ')} : la valeur semble incorrecte. Vérifiez sur l’appareil et renvoyez-la, par exemple « 13/8 » ou « glycémie 1,2 ».`,
      );
    }
    lines.push(...questions);

    if (mentionsMedical(text)) {
      await this.handoff(p, text, true, flag, async () => undefined);
      lines.push(`J’ai aussi transmis votre message à votre médecin. En cas d’urgence, appelez le 119.`);
    }
    await reply('reading_ack', lines.join('\n'), p.id);
    return { patientId: p.id, action: valid.length ? 'reading' : 'reading_rejected' };
  }

  private async handoff(
    p: Patient,
    text: string,
    medical: boolean,
    flag: (id?: string | null) => Promise<unknown>,
    reply: (k: string, b: string, id?: string | null) => Promise<unknown>,
  ) {
    await flag(p.id);
    if (medical && p.doctorId) {
      const [doc] = await this.db.select({ lastName: users.lastName }).from(users).where(eq(users.id, p.doctorId));
      await reply(
        'handoff',
        `Votre question est transmise à votre médecin${doc ? `, le Dr ${doc.lastName},` : ''} qui vous répondra rapidement. En cas d’urgence, appelez le 119.`,
        p.id,
      );
      await this.notify.user(
        p.doctorId,
        `Question de ${p.firstName} ${p.lastName} sur WhatsApp`,
        `« ${text} »\n\nRépondez depuis le dossier : ${appUrl(`/medecin/patients/${p.id}`)}`,
      );
    } else {
      await reply('handoff', 'Merci pour votre message. Un membre de l’équipe Proche Santé vous répond rapidement.', p.id);
      await this.notify.admins(`WhatsApp : question de ${p.firstName} ${p.lastName}`, `« ${text} »\n\n${appUrl('/admin/whatsapp')}`);
    }
    return { patientId: p.id, action: medical ? 'handoff_doctor' : 'handoff_team' };
  }

  // ---------- Réponses pratiques ----------

  async nextAppointment(p: Patient): Promise<{ at: Date; text: string } | null> {
    const now = new Date();
    const found: { at: Date; text: string }[] = [];
    const [c] = await this.db
      .select({ at: consultations.scheduledAt, mode: consultations.mode, videoUrl: consultations.videoUrl, doctor: users.lastName })
      .from(consultations)
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .where(and(eq(consultations.patientId, p.id), eq(consultations.status, 'SCHEDULED'), gt(consultations.scheduledAt, now)))
      .orderBy(asc(consultations.scheduledAt))
      .limit(1);
    if (c) {
      found.push({
        at: c.at,
        text: `consultation avec le Dr ${c.doctor} ${fmtLocal(c.at)}, ${c.mode === 'VIDEO' ? `en vidéo : ${c.videoUrl}` : `par téléphone au ${p.whatsappPhone}`}`,
      });
    }
    const [v] = await this.db
      .select({ at: homeVisits.scheduledAt, nurse: users.firstName })
      .from(homeVisits)
      .innerJoin(users, eq(users.id, homeVisits.nurseId))
      .where(and(eq(homeVisits.patientId, p.id), eq(homeVisits.status, 'SCHEDULED'), gt(homeVisits.scheduledAt, now)))
      .orderBy(asc(homeVisits.scheduledAt))
      .limit(1);
    if (v) found.push({ at: v.at, text: `visite à domicile de ${v.nurse} ${fmtLocal(v.at)}` });
    const [l] = await this.db
      .select({ at: labRequests.appointmentAt, mode: labRequests.appointmentMode })
      .from(labRequests)
      .where(and(eq(labRequests.patientId, p.id), eq(labRequests.status, 'REQUESTED'), gt(labRequests.appointmentAt, now)))
      .orderBy(asc(labRequests.appointmentAt))
      .limit(1);
    if (l?.at) found.push({ at: l.at, text: `prise de sang ${l.mode === 'HOME_SAMPLING' ? 'à domicile' : 'au laboratoire'} ${fmtLocal(l.at)}` });
    return found.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
  }

  private async nextAppointmentText(p: Patient) {
    const n = await this.nextAppointment(p);
    return n
      ? `Votre prochain rendez-vous : ${n.text} (heure du Cameroun).`
      : 'Aucun rendez-vous n’est encore fixé. L’équipe va le programmer et vous recevrez un message.';
  }

  async deliveryText(p: Patient) {
    const [last] = await this.db
      .select({ status: prescriptions.status, delivery: deliveries.status, code: deliveries.code })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .leftJoin(deliveries, eq(deliveries.prescriptionId, prescriptions.id))
      .where(and(eq(consultations.patientId, p.id), inArray(prescriptions.status, ['SENT', 'AWAITING_PAYMENT', 'PREPARING', 'READY', 'DELIVERED'])))
      .orderBy(desc(prescriptions.createdAt))
      .limit(1);
    if (!last) return 'Vous n’avez pas de médicaments en commande en ce moment.';
    if (last.delivery === 'IN_TRANSIT') return `Le livreur est en route avec vos médicaments. Code à lui donner : ${last.code}.`;
    if (last.delivery === 'ASSIGNED' || last.delivery === 'PENDING')
      return `Vos médicaments sont prêts, le livreur va passer les chercher. Code à lui donner : ${last.code}.`;
    if (last.delivery === 'FAILED') return `Le livreur n’a pas pu vous remettre les médicaments ; il repasse bientôt. Code : ${last.code}.`;
    if (last.status === 'DELIVERED') return 'Vos derniers médicaments ont été livrés.';
    if (last.status === 'PREPARING') return 'La pharmacie prépare vos médicaments. Vous recevrez le code de livraison dès qu’ils partent.';
    return 'Votre ordonnance est à la pharmacie ; votre famille valide la commande avant la préparation.';
  }

  // Ce que l'assistant a le droit de dire : rien de médical, seulement l'organisation
  private async facts(p: Patient): Promise<string[]> {
    const next = await this.nextAppointment(p);
    return [
      `Le parent s'appelle ${p.firstName}. Il habite ${p.district}.`,
      'Proche Santé : un médecin appelle le parent chaque mois, la pharmacie prépare les médicaments et un livreur les apporte à domicile.',
      'Le parent peut envoyer sa tension (ex. 13/8) et sa glycémie (ex. glycémie 1,2) par message ; il répond OK après ses médicaments.',
      "L'abonnement et les paiements sont gérés par la famille depuis son espace en ligne, pas par le parent.",
      'Le livreur remet les médicaments contre un code à 4 chiffres envoyé au parent.',
      `Prochain rendez-vous : ${next ? next.text : 'pas encore fixé'}.`,
      `Livraison : ${await this.deliveryText(p)}`,
      'Urgences médicales au Cameroun : 119.',
    ];
  }
}
