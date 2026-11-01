import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Database, DB } from '../db/db.module';
import { Patient, patientMembers, patients } from '../db/schema';

// OWNER = le compte qui a inscrit le parent et paie ; MEMBER = un proche invité, en lecture seule.
export type PatientRole = 'OWNER' | 'MEMBER';

@Injectable()
export class PatientAccessService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Renvoie le parent et le rôle de l'utilisateur. Sans droit d'accès : "introuvable"
  // (et non "interdit"), pour ne pas révéler qu'un dossier existe.
  async resolve(userId: string, patientId: string): Promise<{ patient: Patient; role: PatientRole }> {
    const [patient] = await this.db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient || patient.erasedAt) throw new NotFoundException('Parent introuvable');
    if (patient.familyUserId === userId) return { patient, role: 'OWNER' };

    const [member] = await this.db
      .select({ id: patientMembers.id })
      .from(patientMembers)
      .where(and(eq(patientMembers.patientId, patientId), eq(patientMembers.userId, userId)))
      .limit(1);
    if (member) return { patient, role: 'MEMBER' };
    throw new NotFoundException('Parent introuvable');
  }

  // Modifier le dossier, changer la formule, inviter : réservé au titulaire.
  async requireOwner(userId: string, patientId: string): Promise<Patient> {
    const { patient, role } = await this.resolve(userId, patientId);
    if (role !== 'OWNER') {
      throw new ForbiddenException('Seul le titulaire du compte peut faire cette modification');
    }
    return patient;
  }
}
