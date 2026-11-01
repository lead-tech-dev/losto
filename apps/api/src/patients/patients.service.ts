import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { appUrl } from '../common/app-url';
import { normalizeCameroonPhone } from '../common/text';
import { randomToken } from '../common/tokens';
import { CoverageService } from '../coverage/coverage.service';
import { Database, DB } from '../db/db.module';
import { Patient, patientMembers, patients, Plan, subscriptions } from '../db/schema';
import { ChangePlanDto, CreatePatientDto, UpdatePatientDto } from './dto/patient.dto';
import { PatientAccessService, PatientRole } from './patient-access.service';
import { PLAN_PRICES_EUR } from './plans';

type Subscription = typeof subscriptions.$inferSelect;

@Injectable()
export class PatientsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: PatientAccessService,
    private readonly coverage: CoverageService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreatePatientDto) {
    // Le parent et sa formule sont créés ensemble. L'abonnement reste "en attente" jusqu'au paiement (module 3).
    const patient = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(patients)
        .values({
          familyUserId: userId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          birthYear: dto.birthYear,
          whatsappPhone: normalizeCameroonPhone(dto.whatsappPhone),
          hasSmartphone: dto.hasSmartphone,
          city: dto.city,
          district: dto.district.trim(),
          addressDetails: dto.addressDetails?.trim() || null,
          conditions: dto.conditions,
          medicalHistory: dto.medicalHistory?.trim() || null,
          currentTreatments: dto.currentTreatments?.trim() || null,
          notes: dto.notes?.trim() || null,
          consentToken: randomToken(),
        })
        .returning();
      await tx.insert(subscriptions).values({ patientId: p.id, payerId: userId, plan: dto.plan });
      return p;
    });
    await this.audit.log(userId, 'patient.create', 'Patient', patient.id);
    return this.detail(userId, patient.id);
  }

  // Tous les parents que l'utilisateur peut voir : ceux qu'il a inscrits et ceux où il est invité.
  async list(userId: string) {
    const memberRows = await this.db
      .select({ patientId: patientMembers.patientId })
      .from(patientMembers)
      .where(eq(patientMembers.userId, userId));
    const memberIds = new Set(memberRows.map((r) => r.patientId));

    const owned = await this.db.select().from(patients).where(eq(patients.familyUserId, userId)).orderBy(asc(patients.createdAt));
    const shared = memberIds.size
      ? await this.db.select().from(patients).where(inArray(patients.id, [...memberIds])).orderBy(asc(patients.createdAt))
      : [];

    const all = [...owned.map((p) => ({ p, role: 'OWNER' as const })), ...shared.map((p) => ({ p, role: 'MEMBER' as const }))];
    const subs = all.length
      ? await this.db.select().from(subscriptions).where(inArray(subscriptions.patientId, all.map((x) => x.p.id)))
      : [];
    const subByPatient = new Map(subs.map((s) => [s.patientId, s]));

    return Promise.all(all.map(({ p, role }) => this.summary(p, role, subByPatient.get(p.id))));
  }

  async detail(userId: string, patientId: string) {
    const { patient, role } = await this.access.resolve(userId, patientId);
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.patientId, patientId)).limit(1);
    await this.audit.log(userId, 'patient.read', 'Patient', patientId);
    return {
      ...(await this.summary(patient, role, sub)),
      birthYear: patient.birthYear,
      whatsappPhone: patient.whatsappPhone,
      hasSmartphone: patient.hasSmartphone,
      addressDetails: patient.addressDetails,
      medicalHistory: patient.medicalHistory,
      currentTreatments: patient.currentTreatments,
      notes: patient.notes,
      createdAt: patient.createdAt,
      // Lien à faire suivre au parent tant que l'envoi WhatsApp automatique (module 6) n'existe pas
      consentUrl: role === 'OWNER' && !patient.consentGivenAt ? appUrl(`/consentement/${patient.consentToken}`) : null,
    };
  }

  async update(userId: string, patientId: string, dto: UpdatePatientDto) {
    await this.access.requireOwner(userId, patientId);
    const t = (v?: string) => (v === undefined ? undefined : v.trim() || null);
    await this.db
      .update(patients)
      .set({
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        birthYear: dto.birthYear,
        whatsappPhone: dto.whatsappPhone ? normalizeCameroonPhone(dto.whatsappPhone) : undefined,
        hasSmartphone: dto.hasSmartphone,
        city: dto.city,
        district: dto.district?.trim(),
        addressDetails: t(dto.addressDetails),
        conditions: dto.conditions,
        medicalHistory: t(dto.medicalHistory),
        currentTreatments: t(dto.currentTreatments),
        notes: t(dto.notes),
      })
      .where(eq(patients.id, patientId));
    await this.audit.log(userId, 'patient.update', 'Patient', patientId);
    return this.detail(userId, patientId);
  }

  async changePlan(userId: string, patientId: string, dto: ChangePlanDto) {
    await this.access.requireOwner(userId, patientId);
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.patientId, patientId)).limit(1);
    if (sub && sub.status !== 'PENDING') {
      // Un abonnement déjà payé change de formule via les paiements (module 3), pour gérer le prorata.
      throw new ConflictException('La formule d’un abonnement actif se change depuis la page Paiements');
    }
    await this.db.update(subscriptions).set({ plan: dto.plan }).where(eq(subscriptions.patientId, patientId));
    await this.audit.log(userId, 'patient.plan', 'Patient', patientId);
    return this.detail(userId, patientId);
  }

  private async summary(p: Patient, role: PatientRole, sub?: Subscription) {
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      city: p.city,
      district: p.district,
      conditions: p.conditions,
      consentGiven: Boolean(p.consentGivenAt),
      covered: await this.coverage.isCovered(p.city, p.district),
      role,
      subscription: sub ? subscriptionView(sub.plan, sub.status, sub.currentPeriodEnd) : null,
    };
  }
}

function subscriptionView(plan: Plan, status: Subscription['status'], currentPeriodEnd: Date | null) {
  return { plan, status, priceEur: PLAN_PRICES_EUR[plan], currentPeriodEnd };
}
