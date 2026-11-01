import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import { messages, users } from '../db/schema';

// Un fil de discussion par compte famille, avec l'équipe Proche Santé.
@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private thread(familyUserId: string) {
    return this.db
      .select({
        id: messages.id,
        body: messages.body,
        fromTeam: messages.fromTeam,
        createdAt: messages.createdAt,
        readAt: messages.readAt,
      })
      .from(messages)
      .where(eq(messages.familyUserId, familyUserId))
      .orderBy(asc(messages.createdAt));
  }

  // Ouvrir le fil marque comme lus les messages de l'autre côté.
  private markRead(familyUserId: string, fromTeam: boolean) {
    return this.db
      .update(messages)
      .set({ readAt: new Date() })
      .where(and(eq(messages.familyUserId, familyUserId), eq(messages.fromTeam, fromTeam), isNull(messages.readAt)));
  }

  // ---- Côté famille ----

  async familyThread(userId: string) {
    await this.markRead(userId, true);
    return this.thread(userId);
  }

  async familyUnread(userId: string) {
    const [row] = await this.db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.familyUserId, userId), eq(messages.fromTeam, true), isNull(messages.readAt)));
    return { unread: row.n };
  }

  async familySend(userId: string, body: string) {
    const [m] = await this.db
      .insert(messages)
      .values({ familyUserId: userId, authorId: userId, fromTeam: false, body: body.trim() })
      .returning();
    return m;
  }

  // ---- Côté équipe ----

  async threads() {
    const rows = await this.db
      .select({
        familyUserId: messages.familyUserId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        lastAt: max(messages.createdAt),
        unread: sql<number>`count(*) filter (where ${messages.fromTeam} = false and ${messages.readAt} is null)`.mapWith(Number),
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.familyUserId))
      .groupBy(messages.familyUserId, users.firstName, users.lastName, users.email)
      .orderBy(desc(max(messages.createdAt)));
    return rows;
  }

  async teamThread(actorId: string, familyUserId: string) {
    const [family] = await this.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(and(eq(users.id, familyUserId), eq(users.role, 'FAMILY')))
      .limit(1);
    if (!family) throw new NotFoundException('Famille introuvable');
    await this.markRead(familyUserId, false);
    await this.audit.log(actorId, 'messages.read', 'User', familyUserId);
    return { family, messages: await this.thread(familyUserId) };
  }

  async teamSend(actorId: string, familyUserId: string, body: string) {
    const [family] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, familyUserId), eq(users.role, 'FAMILY')))
      .limit(1);
    if (!family) throw new NotFoundException('Famille introuvable');
    const [m] = await this.db
      .insert(messages)
      .values({ familyUserId, authorId: actorId, fromTeam: true, body: body.trim() })
      .returning();
    return m;
  }
}
