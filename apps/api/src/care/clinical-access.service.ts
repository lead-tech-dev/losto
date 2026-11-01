import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Database, DB } from '../db/db.module';
import { consultations, homeVisits, Patient, patients } from '../db/schema';

// Cloisonnement des dossiers : un soignant ne voit que les parents qui lui sont affectés.
// Sinon la réponse est "introuvable", comme côté famille.
@Injectable()
export class ClinicalAccessService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async patientForDoctor(doctorId: string, patientId: string): Promise<Patient> {
    const [p] = await this.db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!p || p.doctorId !== doctorId) throw new NotFoundException('Patient introuvable');
    return p;
  }

  async patientForNurse(nurseId: string, patientId: string): Promise<Patient> {
    const [p] = await this.db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!p || p.nurseId !== nurseId) throw new NotFoundException('Patient introuvable');
    return p;
  }

  // Une consultation appartient au médecin qui la tient
  async consultationForDoctor(doctorId: string, consultationId: string) {
    const [c] = await this.db.select().from(consultations).where(eq(consultations.id, consultationId)).limit(1);
    if (!c || c.doctorId !== doctorId) throw new NotFoundException('Consultation introuvable');
    const [p] = await this.db.select().from(patients).where(eq(patients.id, c.patientId));
    return { consultation: c, patient: p };
  }

  async visitForNurse(nurseId: string, visitId: string) {
    const [v] = await this.db.select().from(homeVisits).where(eq(homeVisits.id, visitId)).limit(1);
    if (!v || v.nurseId !== nurseId) throw new NotFoundException('Visite introuvable');
    const [p] = await this.db.select().from(patients).where(eq(patients.id, v.patientId));
    return { visit: v, patient: p };
  }
}
