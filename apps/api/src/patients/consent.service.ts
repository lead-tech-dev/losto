import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import { patients, users } from '../db/schema';

// Le parent confirme lui-même qu'il accepte d'être suivi et que sa famille reçoive ses comptes rendus.
// Le lien lui sera envoyé par WhatsApp (module 6) ; en attendant, la famille le lui fait suivre.
@Injectable()
export class ConsentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private async find(token: string) {
    const [row] = await this.db
      .select({
        id: patients.id,
        firstName: patients.firstName,
        consentGivenAt: patients.consentGivenAt,
        familyFirstName: users.firstName,
        familyLastName: users.lastName,
      })
      .from(patients)
      .innerJoin(users, eq(users.id, patients.familyUserId))
      .where(eq(patients.consentToken, token))
      .limit(1);
    if (!row) throw new NotFoundException('Lien invalide');
    return row;
  }

  // Ne montre que le strict nécessaire : le prénom du parent et le nom de l'enfant qui l'a inscrit.
  async preview(token: string) {
    const row = await this.find(token);
    return {
      patientFirstName: row.firstName,
      familyName: `${row.familyFirstName} ${row.familyLastName}`,
      given: Boolean(row.consentGivenAt),
    };
  }

  async give(token: string) {
    const row = await this.find(token);
    if (!row.consentGivenAt) {
      await this.db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, row.id));
      await this.audit.log(null, 'patient.consent', 'Patient', row.id);
    }
    return { given: true };
  }
}
