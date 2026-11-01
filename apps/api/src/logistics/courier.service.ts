import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import { consultations, deliveries, partnerProfiles, patients, prescriptions, users } from '../db/schema';
import { NotifyService } from '../mail/notify.service';

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class CourierService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  // Le livreur voit où récupérer et où livrer. Ni le contenu du colis, ni le code de remise.
  async list(courierId: string) {
    const rows = await this.db
      .select({
        d: deliveries,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        phone: patients.whatsappPhone,
        district: patients.district,
        city: patients.city,
        addressDetails: patients.addressDetails,
        pharmacyId: prescriptions.pharmacyId,
      })
      .from(deliveries)
      .innerJoin(prescriptions, eq(prescriptions.id, deliveries.prescriptionId))
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .where(and(eq(deliveries.courierId, courierId), inArray(deliveries.status, ['ASSIGNED', 'IN_TRANSIT', 'FAILED'])))
      .orderBy(asc(deliveries.createdAt));
    const pharmacyIds = [...new Set(rows.map((r) => r.pharmacyId).filter((x): x is string => Boolean(x)))];
    const pharmacies = pharmacyIds.length
      ? await this.db
          .select({ id: users.id, phone: users.phone, firstName: users.firstName, lastName: users.lastName, org: partnerProfiles.organizationName })
          .from(users)
          .leftJoin(partnerProfiles, eq(partnerProfiles.userId, users.id))
          .where(inArray(users.id, pharmacyIds))
      : [];
    return rows.map((r) => {
      const ph = pharmacies.find((x) => x.id === r.pharmacyId);
      return {
        id: r.d.id,
        status: r.d.status,
        attempts: r.d.attempts,
        failureReason: r.d.failureReason,
        pickedUpAt: r.d.pickedUpAt,
        createdAt: r.d.createdAt,
        pickup: { name: ph?.org ?? `${ph?.firstName ?? ''} ${ph?.lastName ?? ''}`.trim(), phone: ph?.phone ?? null },
        dropoff: {
          name: `${r.patientFirstName} ${r.patientLastName}`,
          phone: r.phone,
          address: `${r.district}, ${r.city === 'DOUALA' ? 'Douala' : r.city === 'YAOUNDE' ? 'Yaoundé' : ''}${r.addressDetails ? ` · ${r.addressDetails}` : ''}`,
        },
      };
    });
  }

  private async own(courierId: string, deliveryId: string) {
    const [row] = await this.db
      .select({ d: deliveries, patientId: consultations.patientId, prescriptionId: prescriptions.id })
      .from(deliveries)
      .innerJoin(prescriptions, eq(prescriptions.id, deliveries.prescriptionId))
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(eq(deliveries.id, deliveryId))
      .limit(1);
    if (!row || row.d.courierId !== courierId) throw new NotFoundException('Livraison introuvable');
    return row;
  }

  async pickedUp(courierId: string, deliveryId: string) {
    const { d } = await this.own(courierId, deliveryId);
    if (d.status !== 'ASSIGNED') throw new ConflictException('Colis déjà récupéré ou livraison close');
    await this.db.update(deliveries).set({ status: 'IN_TRANSIT', pickedUpAt: new Date() }).where(eq(deliveries.id, deliveryId));
    await this.audit.log(courierId, 'delivery.picked_up', 'Delivery', deliveryId);
    return { status: 'IN_TRANSIT' };
  }

  // Remise contre le code donné par le parent : preuve que le colis est arrivé à la bonne personne
  async delivered(courierId: string, deliveryId: string, code: string) {
    const { d, patientId, prescriptionId } = await this.own(courierId, deliveryId);
    if (d.status !== 'IN_TRANSIT') throw new ConflictException('Récupérez d’abord le colis à la pharmacie');
    if (d.codeAttempts >= MAX_CODE_ATTEMPTS) {
      throw new ForbiddenException('Trop de codes erronés : appelez l’équipe Proche Santé');
    }
    if (code.trim() !== d.code) {
      await this.db.update(deliveries).set({ codeAttempts: d.codeAttempts + 1 }).where(eq(deliveries.id, deliveryId));
      const left = MAX_CODE_ATTEMPTS - d.codeAttempts - 1;
      throw new ConflictException(left > 0 ? `Code incorrect. Encore ${left} essai(s).` : 'Code incorrect. Appelez l’équipe Proche Santé.');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(deliveries).set({ status: 'DELIVERED', deliveredAt: new Date() }).where(eq(deliveries.id, deliveryId));
      await tx.update(prescriptions).set({ status: 'DELIVERED' }).where(eq(prescriptions.id, prescriptionId));
    });
    await this.audit.log(courierId, 'delivery.delivered', 'Delivery', deliveryId);
    const [p] = await this.db.select().from(patients).where(eq(patients.id, patientId));
    await this.notify.family(patientId, `Médicaments livrés à ${p.firstName}`, `Les médicaments ont été remis à ${p.firstName}, contre le code de livraison.`);
    return { status: 'DELIVERED' };
  }

  async failed(courierId: string, deliveryId: string, reason: string) {
    const { d, patientId } = await this.own(courierId, deliveryId);
    if (!['ASSIGNED', 'IN_TRANSIT'].includes(d.status)) throw new ConflictException('Livraison déjà close');
    await this.db
      .update(deliveries)
      .set({ status: 'FAILED', attempts: d.attempts + 1, failureReason: reason.trim() })
      .where(eq(deliveries.id, deliveryId));
    await this.audit.log(courierId, 'delivery.failed', 'Delivery', deliveryId);
    const [p] = await this.db.select().from(patients).where(eq(patients.id, patientId));
    await this.notify.family(
      patientId,
      `Livraison à ${p.firstName} reportée`,
      `Le livreur n'a pas pu remettre les médicaments : ${reason}.\nIl repassera ; vous pouvez aussi nous écrire depuis la messagerie pour convenir d'un moment.`,
    );
    return { status: 'FAILED' };
  }

  // Nouvelle tentative le lendemain : le colis est toujours chez le livreur ou à la pharmacie
  async retry(courierId: string, deliveryId: string) {
    const { d } = await this.own(courierId, deliveryId);
    if (d.status !== 'FAILED') throw new ConflictException('Rien à relancer');
    await this.db
      .update(deliveries)
      .set({ status: d.pickedUpAt ? 'IN_TRANSIT' : 'ASSIGNED', failureReason: null })
      .where(eq(deliveries.id, deliveryId));
    return { status: d.pickedUpAt ? 'IN_TRANSIT' : 'ASSIGNED' };
  }
}
