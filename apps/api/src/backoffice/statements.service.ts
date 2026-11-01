import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import { consultations, deliveries, homeVisits, labRequests, partnerPayouts, partnerProfiles, patients, payments, prescriptions, Role, users } from '../db/schema';
import { NotifyService } from '../mail/notify.service';
import { monthStart } from '../whatsapp/reports.service';
import { partnerRates } from './rates';

export interface StatementLine {
  date: Date;
  patient: string; // prénom + initiale : pas plus que nécessaire
  label: string;
  amountXaf: number;
}

export interface Statement {
  partnerId: string;
  name: string;
  role: Role;
  city: string | null;
  month: string;
  lines: StatementLine[];
  totalXaf: number;
  payout: { amountXaf: number; reference: string | null; paidAt: Date } | null;
}

const PAYABLE: Role[] = ['DOCTOR', 'NURSE', 'COURIER', 'PHARMACY', 'LAB'];

export function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

const short = (first: string, last: string) => `${first} ${last.charAt(0)}.`;

// Ce que Proche Santé doit à chaque partenaire pour un mois : actes réalisés × tarif, et pour les
// pharmacies le prix des médicaments encaissé auprès des familles (reversé sans marge).
@Injectable()
export class StatementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  private range(ym: string) {
    return { from: monthStart(ym), to: monthStart(nextMonth(ym)) };
  }

  async linesFor(partnerId: string, role: Role, ym: string): Promise<StatementLine[]> {
    const { from, to } = this.range(ym);
    const r = partnerRates();
    const lines: StatementLine[] = [];
    if (role === 'DOCTOR') {
      const rows = await this.db
        .select({ at: consultations.completedAt, kind: consultations.kind, first: patients.firstName, last: patients.lastName })
        .from(consultations)
        .innerJoin(patients, eq(patients.id, consultations.patientId))
        .where(and(eq(consultations.doctorId, partnerId), eq(consultations.status, 'DONE'), gte(consultations.completedAt, from), lt(consultations.completedAt, to)));
      for (const x of rows) {
        const initial = x.kind === 'INITIAL';
        lines.push({ date: x.at!, patient: short(x.first, x.last), label: initial ? 'Bilan de départ' : 'Consultation', amountXaf: initial ? r.initialConsultation : r.consultation });
      }
    }
    if (role === 'NURSE') {
      const rows = await this.db
        .select({ at: homeVisits.completedAt, first: patients.firstName, last: patients.lastName })
        .from(homeVisits)
        .innerJoin(patients, eq(patients.id, homeVisits.patientId))
        .where(and(eq(homeVisits.nurseId, partnerId), eq(homeVisits.status, 'DONE'), gte(homeVisits.completedAt, from), lt(homeVisits.completedAt, to)));
      for (const x of rows) lines.push({ date: x.at!, patient: short(x.first, x.last), label: 'Visite à domicile', amountXaf: r.homeVisit });
    }
    if (role === 'COURIER') {
      const rows = await this.db
        .select({ d: deliveries, first: patients.firstName, last: patients.lastName })
        .from(deliveries)
        .innerJoin(prescriptions, eq(prescriptions.id, deliveries.prescriptionId))
        .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
        .innerJoin(patients, eq(patients.id, consultations.patientId))
        .where(and(eq(deliveries.courierId, partnerId), eq(deliveries.status, 'DELIVERED'), gte(deliveries.deliveredAt, from), lt(deliveries.deliveredAt, to)));
      for (const x of rows) {
        lines.push({ date: x.d.deliveredAt!, patient: short(x.first, x.last), label: 'Livraison', amountXaf: r.delivery });
        if (x.d.attempts > 0) {
          lines.push({
            date: x.d.deliveredAt!,
            patient: short(x.first, x.last),
            label: `Passage${x.d.attempts > 1 ? 's' : ''} sans remise (${x.d.attempts})`,
            amountXaf: r.failedDelivery * x.d.attempts,
          });
        }
      }
    }
    if (role === 'PHARMACY') {
      const rows = await this.db
        .select({ at: payments.paidAt, price: prescriptions.priceXaf, first: patients.firstName, last: patients.lastName })
        .from(payments)
        .innerJoin(prescriptions, eq(prescriptions.id, payments.prescriptionId))
        .innerJoin(patients, eq(patients.id, payments.patientId))
        .where(
          and(
            eq(prescriptions.pharmacyId, partnerId),
            eq(payments.kind, 'MEDICATION'),
            eq(payments.status, 'SUCCEEDED'),
            gte(payments.paidAt, from),
            lt(payments.paidAt, to),
          ),
        );
      for (const x of rows) lines.push({ date: x.at!, patient: short(x.first, x.last), label: 'Médicaments (prix pharmacie)', amountXaf: x.price ?? 0 });
    }
    if (role === 'LAB') {
      const rows = await this.db
        .select({ at: labRequests.sampledAt, first: patients.firstName, last: patients.lastName })
        .from(labRequests)
        .innerJoin(patients, eq(patients.id, labRequests.patientId))
        .where(
          and(
            eq(labRequests.labId, partnerId),
            eq(labRequests.appointmentMode, 'HOME_SAMPLING'),
            inArray(labRequests.status, ['SAMPLED', 'RESULTS_AVAILABLE']),
            gte(labRequests.sampledAt, from),
            lt(labRequests.sampledAt, to),
          ),
        );
      for (const x of rows) lines.push({ date: x.at!, patient: short(x.first, x.last), label: 'Prélèvement à domicile', amountXaf: r.homeSampling });
    }
    return lines.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private async partner(partnerId: string) {
    const [p] = await this.db
      .select({ id: users.id, role: users.role, first: users.firstName, last: users.lastName, org: partnerProfiles.organizationName, city: partnerProfiles.city })
      .from(users)
      .leftJoin(partnerProfiles, eq(partnerProfiles.userId, users.id))
      .where(eq(users.id, partnerId));
    if (!p || !PAYABLE.includes(p.role)) throw new NotFoundException('Partenaire introuvable');
    return p;
  }

  private label(p: { role: Role; first: string; last: string; org: string | null }) {
    if (p.org && (p.role === 'PHARMACY' || p.role === 'LAB')) return p.org;
    return p.role === 'DOCTOR' ? `Dr ${p.first} ${p.last}` : `${p.first} ${p.last}`;
  }

  async statement(partnerId: string, ym: string): Promise<Statement> {
    const p = await this.partner(partnerId);
    const lines = await this.linesFor(p.id, p.role, ym);
    const [paid] = await this.db
      .select()
      .from(partnerPayouts)
      .where(and(eq(partnerPayouts.partnerId, p.id), eq(partnerPayouts.month, monthStart(ym))));
    return {
      partnerId: p.id,
      name: this.label(p),
      role: p.role,
      city: p.city,
      month: ym,
      lines,
      totalXaf: lines.reduce((s, l) => s + l.amountXaf, 0),
      payout: paid ? { amountXaf: paid.amountXaf, reference: paid.reference, paidAt: paid.paidAt } : null,
    };
  }

  // Tous les partenaires ayant travaillé (ou déjà été payés) ce mois-là, sans le détail des actes
  async month(ym: string) {
    const all = await this.db.select({ id: users.id }).from(users).where(inArray(users.role, PAYABLE));
    const out: (Omit<Statement, 'lines'> & { items: number })[] = [];
    for (const u of all) {
      const { lines, ...s } = await this.statement(u.id, ym);
      if (lines.length || s.payout) out.push({ ...s, items: lines.length });
    }
    const rank: Record<string, number> = { DOCTOR: 0, NURSE: 1, LAB: 2, PHARMACY: 3, COURIER: 4 };
    return out.sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name, 'fr'));
  }

  async markPaid(adminId: string, partnerId: string, ym: string, reference?: string) {
    const s = await this.statement(partnerId, ym);
    if (!s.totalXaf) throw new ConflictException('Rien à verser pour ce mois');
    const [row] = await this.db
      .insert(partnerPayouts)
      .values({
        partnerId,
        month: monthStart(ym),
        amountXaf: s.totalXaf,
        items: s.lines.length,
        reference: reference?.trim() || null,
        paidAt: new Date(),
        paidById: adminId,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('Ce relevé est déjà marqué comme payé');
    await this.audit.log(adminId, 'payout.paid', 'User', partnerId);
    const month = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-15T00:00:00Z`));
    await this.notify.user(
      partnerId,
      `Proche Santé : versement de ${month}`,
      `Nous vous avons versé ${s.totalXaf.toLocaleString('fr-FR')} FCFA pour ${month} (${s.lines.length} acte${s.lines.length > 1 ? 's' : ''}).` +
        (row.reference ? `\nRéférence : ${row.reference}` : '') +
        `\nLe détail est dans votre espace, rubrique « Mes relevés ».`,
    );
    return { ok: true, amountXaf: row.amountXaf };
  }
}

