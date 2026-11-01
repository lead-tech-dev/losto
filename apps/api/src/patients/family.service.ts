import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { appUrl } from '../common/app-url';
import { hashToken, newToken } from '../common/tokens';
import { Database, DB } from '../db/db.module';
import { invitations, patientMembers, patients, users } from '../db/schema';
import { MailerService } from '../mail/mailer.service';
import { PatientAccessService } from './patient-access.service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Partage du suivi d'un parent avec d'autres membres de la famille (frère, sœur...), en lecture seule.
@Injectable()
export class FamilyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: PatientAccessService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  async members(userId: string, patientId: string) {
    const { patient, role } = await this.access.resolve(userId, patientId);
    const [owner] = await this.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(eq(users.id, patient.familyUserId));
    const members = await this.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(patientMembers)
      .innerJoin(users, eq(users.id, patientMembers.userId))
      .where(eq(patientMembers.patientId, patientId))
      .orderBy(asc(patientMembers.createdAt));

    const isOwner = role === 'OWNER';
    // Un proche invité voit qui suit le parent, mais pas les adresses e-mail ni les invitations en attente
    const show = (u: typeof owner) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: isOwner ? u.email : undefined });
    const pending = isOwner
      ? await this.db
          .select({ id: invitations.id, email: invitations.email, expiresAt: invitations.expiresAt })
          .from(invitations)
          .where(
            and(eq(invitations.patientId, patientId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())),
          )
      : [];
    return { owner: show(owner), members: members.map(show), pendingInvitations: pending };
  }

  async invite(userId: string, patientId: string, rawEmail: string) {
    const patient = await this.access.requireOwner(userId, patientId);
    const email = rawEmail.trim().toLowerCase();

    const [inviter] = await this.db.select().from(users).where(eq(users.id, userId));
    if (inviter.email === email) throw new BadRequestException('Vous suivez déjà ce parent');

    const [alreadyMember] = await this.db
      .select({ id: patientMembers.id })
      .from(patientMembers)
      .innerJoin(users, eq(users.id, patientMembers.userId))
      .where(and(eq(patientMembers.patientId, patientId), eq(users.email, email)))
      .limit(1);
    if (alreadyMember) throw new ConflictException('Cette personne suit déjà ce parent');

    const { token, hash } = newToken();
    const [inv] = await this.db
      .insert(invitations)
      .values({
        patientId,
        invitedById: userId,
        email,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      })
      .returning();

    await this.mailer.send({
      to: email,
      subject: `${inviter.firstName} vous invite à suivre ${patient.firstName} sur Proche Santé`,
      text:
        `Bonjour,\n\n${inviter.firstName} ${inviter.lastName} vous invite à suivre la santé de ` +
        `${patient.firstName} ${patient.lastName} sur Proche Santé : consultations, relevés et comptes rendus.\n\n` +
        `Pour accepter (lien valable 7 jours), créez un compte ou connectez-vous avec cette adresse e-mail, puis ouvrez :\n` +
        `${appUrl(`/invitation?token=${token}`)}\n`,
    });
    await this.audit.log(userId, 'patient.invite', 'Patient', patientId);
    return { id: inv.id, email: inv.email, expiresAt: inv.expiresAt };
  }

  async cancelInvitation(userId: string, patientId: string, invitationId: string) {
    await this.access.requireOwner(userId, patientId);
    const [row] = await this.db
      .delete(invitations)
      .where(and(eq(invitations.id, invitationId), eq(invitations.patientId, patientId), isNull(invitations.acceptedAt)))
      .returning();
    if (!row) throw new NotFoundException('Invitation introuvable');
  }

  async removeMember(userId: string, patientId: string, memberUserId: string) {
    await this.access.requireOwner(userId, patientId);
    const [row] = await this.db
      .delete(patientMembers)
      .where(and(eq(patientMembers.patientId, patientId), eq(patientMembers.userId, memberUserId)))
      .returning();
    if (!row) throw new NotFoundException('Membre introuvable');
    await this.audit.log(userId, 'patient.member_remove', 'Patient', patientId);
  }

  // Un proche peut aussi arrêter de suivre de lui-même
  async leave(userId: string, patientId: string) {
    const { role } = await this.access.resolve(userId, patientId);
    if (role === 'OWNER') throw new BadRequestException('Le titulaire ne peut pas quitter le suivi');
    await this.db
      .delete(patientMembers)
      .where(and(eq(patientMembers.patientId, patientId), eq(patientMembers.userId, userId)));
    await this.audit.log(userId, 'patient.member_leave', 'Patient', patientId);
  }

  private async findValidInvitation(token: string) {
    const [row] = await this.db
      .select({
        id: invitations.id,
        patientId: invitations.patientId,
        email: invitations.email,
        patientFirstName: patients.firstName,
        inviterFirstName: users.firstName,
        inviterLastName: users.lastName,
      })
      .from(invitations)
      .innerJoin(patients, eq(patients.id, invitations.patientId))
      .innerJoin(users, eq(users.id, invitations.invitedById))
      .where(
        and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Invitation invalide, expirée ou déjà utilisée');
    return row;
  }

  async preview(token: string) {
    const inv = await this.findValidInvitation(token);
    return {
      email: inv.email,
      patientFirstName: inv.patientFirstName,
      invitedBy: `${inv.inviterFirstName} ${inv.inviterLastName}`,
    };
  }

  // L'invitation ne vaut que pour l'adresse invitée : le lien seul ne suffit pas à accéder au dossier.
  async accept(userId: string, token: string) {
    const inv = await this.findValidInvitation(token);
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (user.email !== inv.email) {
      throw new BadRequestException(`Cette invitation est adressée à ${inv.email}. Connectez-vous avec cette adresse.`);
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(patientMembers).values({ patientId: inv.patientId, userId }).onConflictDoNothing();
      await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    });
    await this.audit.log(userId, 'patient.member_join', 'Patient', inv.patientId);
    return { patientId: inv.patientId };
  }
}
