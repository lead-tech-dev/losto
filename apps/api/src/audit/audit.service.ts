import { Inject, Injectable } from '@nestjs/common';
import { Database, DB } from '../db/db.module';
import { auditLogs } from '../db/schema';

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Enregistre qui a fait quoi sur quelle donnée. Utilisé pour toute action sensible.
  async log(actorId: string | null, action: string, entity: string, entityId?: string) {
    await this.db.insert(auditLogs).values({ actorId, action, entity, entityId });
  }
}
