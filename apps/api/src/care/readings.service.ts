import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import { alerts, Patient, readings, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { MailerService } from '../mail/mailer.service';
import { evaluateReading, implausible, ReadingInput, Severity } from './thresholds';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface RecordedAlert {
  severity: Severity;
  message: string;
}

// Enregistre des relevés (mesurés par un soignant ou envoyés par le parent sur WhatsApp)
// et crée les alertes pour le médecin du parent.
@Injectable()
export class ReadingsService {
  private readonly logger = new Logger(ReadingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mailer: MailerService,
  ) {}

  validate(list: ReadingInput[]) {
    for (const r of list) {
      const problem = implausible(r);
      if (problem) throw new BadRequestException(problem);
    }
  }

  async record(
    tx: Tx,
    patient: Patient,
    list: ReadingInput[],
    ctx: { source: 'NURSE' | 'DOCTOR' | 'WHATSAPP'; recordedById?: string; homeVisitId?: string; consultationId?: string; measuredAt?: Date },
  ): Promise<RecordedAlert[]> {
    const created: RecordedAlert[] = [];
    for (const r of list) {
      const [row] = await tx
        .insert(readings)
        .values({
          patientId: patient.id,
          type: r.type,
          systolic: r.type === 'BLOOD_PRESSURE' ? r.systolic : null,
          diastolic: r.type === 'BLOOD_PRESSURE' ? r.diastolic : null,
          value: r.type === 'BLOOD_PRESSURE' ? null : String(r.value),
          measuredAt: ctx.measuredAt ?? new Date(),
          source: ctx.source,
          recordedById: ctx.recordedById ?? null,
          homeVisitId: ctx.homeVisitId,
          consultationId: ctx.consultationId,
        })
        .returning();
      const verdict = evaluateReading(r);
      if (verdict) {
        await tx.insert(alerts).values({
          patientId: patient.id,
          readingId: row.id,
          doctorId: patient.doctorId,
          severity: verdict.severity,
          message: verdict.message,
          // Mesuré par le médecin lui-même : il l'a sous les yeux, l'alerte est déjà vue
          acknowledgedAt: ctx.source === 'DOCTOR' ? new Date() : null,
          acknowledgedById: ctx.source === 'DOCTOR' ? (ctx.recordedById ?? null) : null,
        });
        created.push(verdict);
      }
    }
    return created;
  }

  // Alerte urgente (infirmier ou WhatsApp) : le médecin est aussi prévenu par e-mail
  async emailDoctor(patient: Patient, list: RecordedAlert[]) {
    const urgent = list.filter((a) => a.severity === 'URGENT');
    if (!urgent.length || !patient.doctorId) return;
    const [doc] = await this.db.select().from(users).where(eq(users.id, patient.doctorId));
    if (!doc) return;
    await this.mailer
      .send({
        to: doc.email,
        subject: `URGENT · ${patient.firstName} ${patient.lastName} : ${urgent[0].message}`,
        text:
          `Docteur ${doc.lastName},\n\nRelevé à domicile pour ${patient.firstName} ${patient.lastName} ` +
          `(${patient.whatsappPhone}) :\n${urgent.map((a) => `- ${a.message}`).join('\n')}\n\n` +
          `Dossier : ${appUrl(`/medecin/patients/${patient.id}`)}`,
      })
      .catch((e) => this.logger.error(`E-mail d'alerte : ${e.message}`));
  }
}
