import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { fmtXaf } from '../billing/billing.util';
import { CareTeamService } from '../care/care-team.service';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import { consultations, deliveries, patients, payments, prescriptions, users } from '../db/schema';
import { NotifyService } from '../mail/notify.service';

// Codes de remise : 4 chiffres, connus du parent et de la famille, jamais transmis au livreur
export function newDeliveryCode(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

const STATUSES = ['SENT', 'AWAITING_PAYMENT', 'PREPARING', 'READY', 'DELIVERED', 'CANCELED'] as const;

@Injectable()
export class PharmacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly team: CareTeamService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  // Ordonnances reçues par cette pharmacie. La pharmacie voit le nom et le quartier du patient, pas son dossier.
  async list(pharmacyId: string, status?: string) {
    if (status && !(STATUSES as readonly string[]).includes(status)) throw new BadRequestException('Statut inconnu');
    const rows = await this.db
      .select({
        p: prescriptions,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        district: patients.district,
        doctorFirstName: users.firstName,
        doctorLastName: users.lastName,
        deliveryStatus: deliveries.status,
      })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .leftJoin(deliveries, eq(deliveries.prescriptionId, prescriptions.id))
      .where(
        and(
          eq(prescriptions.pharmacyId, pharmacyId),
          status ? eq(prescriptions.status, status as (typeof STATUSES)[number]) : undefined,
        ),
      )
      .orderBy(desc(prescriptions.createdAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.p.id,
      items: r.p.items,
      status: r.p.status,
      priceXaf: r.p.priceXaf,
      pharmacyNote: r.p.pharmacyNote,
      cancelReason: r.p.cancelReason,
      createdAt: r.p.createdAt,
      readyAt: r.p.readyAt,
      patientName: `${r.patientFirstName} ${r.patientLastName}`,
      district: r.district,
      doctorName: `Dr ${r.doctorFirstName} ${r.doctorLastName}`,
      deliveryStatus: r.deliveryStatus,
    }));
  }

  private async own(pharmacyId: string, prescriptionId: string) {
    const [row] = await this.db
      .select({ p: prescriptions, patientId: consultations.patientId, doctorId: consultations.doctorId })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(eq(prescriptions.id, prescriptionId))
      .limit(1);
    if (!row || row.p.pharmacyId !== pharmacyId) throw new NotFoundException('Ordonnance introuvable');
    return row;
  }

  // Prix de la pharmacie (FCFA), soumis à la famille. Corrigeable tant qu'aucun paiement n'est en cours.
  async setPrice(pharmacyId: string, prescriptionId: string, priceXaf: number, note?: string) {
    const { p, patientId } = await this.own(pharmacyId, prescriptionId);
    if (!['SENT', 'AWAITING_PAYMENT'].includes(p.status)) throw new ConflictException('Le prix ne peut plus être modifié');
    const [pending] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.prescriptionId, prescriptionId), eq(payments.status, 'PENDING')))
      .limit(1);
    if (pending) throw new ConflictException('Un paiement est en cours : le prix ne peut pas changer');

    await this.db
      .update(prescriptions)
      .set({ priceXaf, pharmacyNote: note?.trim() || null, status: 'AWAITING_PAYMENT', pricedAt: new Date() })
      .where(eq(prescriptions.id, prescriptionId));
    await this.audit.log(pharmacyId, 'pharmacy.price', 'Prescription', prescriptionId);
    await this.notify.family(
      patientId,
      `Médicaments à valider : ${fmtXaf(priceXaf)}`,
      `La pharmacie a préparé le devis de la dernière ordonnance : ${fmtXaf(priceXaf)}, prix pharmacie sans marge.` +
        `${note ? `\nNote de la pharmacie : ${note}` : ''}\n` +
        `Validez et payez pour lancer la préparation et la livraison : ${appUrl(`/parents/${patientId}`)}`,
    );
    return { status: 'AWAITING_PAYMENT', priceXaf };
  }

  // Impossible à servir (rupture, médicament inconnu...) : le médecin et la famille sont prévenus
  async reject(pharmacyId: string, prescriptionId: string, reason: string) {
    const { p, patientId, doctorId } = await this.own(pharmacyId, prescriptionId);
    if (!['SENT', 'AWAITING_PAYMENT'].includes(p.status)) throw new ConflictException('Cette ordonnance est déjà payée : contactez l’équipe');
    await this.db
      .update(prescriptions)
      .set({ status: 'CANCELED', cancelReason: reason.trim() })
      .where(eq(prescriptions.id, prescriptionId));
    await this.audit.log(pharmacyId, 'pharmacy.reject', 'Prescription', prescriptionId);
    const [pat] = await this.db.select().from(patients).where(eq(patients.id, patientId));
    await this.notify.user(
      doctorId,
      `Ordonnance non servie : ${pat.firstName} ${pat.lastName}`,
      `La pharmacie ne peut pas servir l'ordonnance de ${pat.firstName} ${pat.lastName}.\nMotif : ${reason}\n` +
        `Merci de prescrire une alternative : ${appUrl(`/medecin/patients/${patientId}`)}`,
    );
    await this.notify.family(
      patientId,
      `Ordonnance de ${pat.firstName} : la pharmacie ne peut pas la servir`,
      `Motif : ${reason}\nLe médecin a été prévenu et va proposer une alternative. Rien ne vous a été facturé.`,
    );
    return { status: 'CANCELED' };
  }

  // Commande prête : la livraison est créée avec son code, un livreur de la ville est affecté
  async ready(pharmacyId: string, prescriptionId: string) {
    const { p, patientId } = await this.own(pharmacyId, prescriptionId);
    if (p.status !== 'PREPARING') throw new ConflictException('Seule une commande payée et en préparation peut être marquée prête');
    const [pat] = await this.db.select().from(patients).where(eq(patients.id, patientId));
    const courierId = await this.team.pickCourier(pat.city);
    const code = newDeliveryCode();

    await this.db.transaction(async (tx) => {
      await tx.update(prescriptions).set({ status: 'READY', readyAt: new Date() }).where(eq(prescriptions.id, prescriptionId));
      await tx
        .insert(deliveries)
        .values({ prescriptionId, code, courierId, status: courierId ? 'ASSIGNED' : 'PENDING' })
        .onConflictDoNothing();
    });
    await this.audit.log(pharmacyId, 'pharmacy.ready', 'Prescription', prescriptionId);
    await this.notify.family(
      patientId,
      `Médicaments de ${pat.firstName} prêts : code de livraison ${code}`,
      `Les médicaments de ${pat.firstName} sont prêts et partent en livraison.\n\n` +
        `CODE DE LIVRAISON : ${code}\n` +
        `${pat.firstName} devra donner ce code au livreur à la remise du colis. Transmettez-le-lui ; ne le donnez à personne d'autre.`,
    );
    return { status: 'READY', courierAssigned: Boolean(courierId) };
  }

  async listInProgress(pharmacyId: string) {
    return this.list(pharmacyId).then((all) => all.filter((x) => ['SENT', 'AWAITING_PAYMENT', 'PREPARING', 'READY'].includes(x.status)));
  }

  // Utilisé par la tâche quotidienne : livraisons sans livreur (aucun n'était disponible au moment "prête")
  async assignPendingDeliveries() {
    const pending = await this.db
      .select({ id: deliveries.id, city: patients.city })
      .from(deliveries)
      .innerJoin(prescriptions, eq(prescriptions.id, deliveries.prescriptionId))
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .where(inArray(deliveries.status, ['PENDING']));
    let n = 0;
    for (const d of pending) {
      const courierId = await this.team.pickCourier(d.city);
      if (!courierId) continue;
      await this.db.update(deliveries).set({ courierId, status: 'ASSIGNED' }).where(eq(deliveries.id, d.id));
      n++;
    }
    return n;
  }
}
