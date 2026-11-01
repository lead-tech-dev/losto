import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import { City, deliveries, partnerProfiles, Patient, patients, Role, users } from '../db/schema';

type TeamColumn = 'doctorId' | 'nurseId' | 'pharmacyId' | 'labId';
const COLUMN_ROLE: Record<TeamColumn, Role> = { doctorId: 'DOCTOR', nurseId: 'NURSE', pharmacyId: 'PHARMACY', labId: 'LAB' };

// Qui s'occupe de quel parent : un médecin, une pharmacie, et un(e) infirmier(e) pour la formule Sérénité.
@Injectable()
export class CareTeamService {
  private readonly logger = new Logger(CareTeamService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // Complète l'équipe d'un parent : pour chaque rôle manquant, le partenaire vérifié de la même ville
  // qui suit le moins de parents. Rien n'est remplacé si quelqu'un est déjà affecté.
  async autoAssign(patient: Patient, withNurse: boolean): Promise<Patient> {
    const wanted: TeamColumn[] = ['doctorId', 'pharmacyId', ...(withNurse ? (['nurseId'] as const) : [])];
    const patch: Partial<Record<TeamColumn, string>> = {};
    for (const col of wanted) {
      if (patient[col]) continue;
      const pick = await this.leastLoaded(COLUMN_ROLE[col], col, patient.city);
      if (pick) patch[col] = pick;
      else this.logger.warn(`Aucun partenaire ${COLUMN_ROLE[col]} disponible à ${patient.city} pour ${patient.id}`);
    }
    if (Object.keys(patch).length === 0) return patient;
    const [updated] = await this.db.update(patients).set(patch).where(eq(patients.id, patient.id)).returning();
    await this.audit.log(null, 'care.auto_assign', 'Patient', patient.id);
    return updated;
  }

  // Laboratoire : affecté à la première demande d'analyses
  async ensureLab(patient: Patient): Promise<string | null> {
    if (patient.labId) return patient.labId;
    const lab = await this.leastLoaded('LAB', 'labId', patient.city);
    if (!lab) {
      this.logger.warn(`Aucun laboratoire disponible à ${patient.city} pour ${patient.id}`);
      return null;
    }
    await this.db.update(patients).set({ labId: lab }).where(eq(patients.id, patient.id));
    return lab;
  }

  // Livreur : choisi par livraison, le moins chargé parmi les livraisons en cours de sa ville
  async pickCourier(city: City): Promise<string | null> {
    const candidates = await this.verifiedPartners('COURIER', city);
    if (!candidates.length) return null;
    const loads = await this.db
      .select({ id: deliveries.courierId, n: count() })
      .from(deliveries)
      .where(and(isNotNull(deliveries.courierId), inArray(deliveries.status, ['ASSIGNED', 'IN_TRANSIT'])))
      .groupBy(deliveries.courierId);
    const load = new Map(loads.map((l) => [l.id, l.n]));
    candidates.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
    return candidates[0].id;
  }

  private verifiedPartners(role: Role, city: City) {
    return this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(partnerProfiles, eq(partnerProfiles.userId, users.id))
      .where(
        and(
          eq(users.role, role),
          eq(users.isActive, true),
          isNotNull(partnerProfiles.verifiedAt), // seulement les partenaires dont l'admin a vérifié les documents
          eq(partnerProfiles.city, city),
        ),
      )
      .orderBy(asc(users.createdAt));
  }

  private async leastLoaded(role: Role, col: TeamColumn, city: City): Promise<string | null> {
    const candidates = await this.verifiedPartners(role, city);
    if (!candidates.length) return null;

    const loads = await this.db
      .select({ id: patients[col], n: count() })
      .from(patients)
      .where(isNotNull(patients[col]))
      .groupBy(patients[col]);
    const load = new Map(loads.map((l) => [l.id, l.n]));
    candidates.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
    return candidates[0].id;
  }

  // Affectation manuelle par l'admin (remplacement d'un médecin, etc.)
  async setTeam(actorId: string, patientId: string, team: Partial<Record<TeamColumn, string | null>>) {
    const [patient] = await this.db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient) throw new NotFoundException('Parent introuvable');
    for (const [col, userId] of Object.entries(team) as [TeamColumn, string | null][]) {
      if (!userId) continue;
      const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u || u.role !== COLUMN_ROLE[col] || !u.isActive) {
        throw new BadRequestException(`Le compte choisi n'est pas un(e) ${COLUMN_ROLE[col].toLowerCase()} actif`);
      }
    }
    const [updated] = await this.db.update(patients).set(team).where(eq(patients.id, patientId)).returning();
    await this.audit.log(actorId, 'care.set_team', 'Patient', patientId);
    return { doctorId: updated.doctorId, nurseId: updated.nurseId, pharmacyId: updated.pharmacyId };
  }
}
