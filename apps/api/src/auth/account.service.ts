import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { appUrl } from '../common/app-url';
import { hashToken, newToken } from '../common/tokens';
import { Database, DB } from '../db/db.module';
import { passwordResetTokens, users } from '../db/schema';
import { MailerService } from '../mail/mailer.service';
import { BCRYPT_ROUNDS, toPublicUser } from './auth.service';
import { UpdateProfileDto } from './dto/account.dto';

const RESET_TTL_MS = 60 * 60 * 1000; // un lien de réinitialisation est valable 1 heure

@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  // Toujours la même réponse, que l'adresse existe ou non : on ne révèle pas qui est inscrit.
  async forgotPassword(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !user.isActive) return;

    const { token, hash } = newToken();
    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    await this.mailer.send({
      to: user.email,
      subject: 'Réinitialiser votre mot de passe Proche Santé',
      text:
        `Bonjour ${user.firstName},\n\n` +
        `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n` +
        `${appUrl(`/reinitialiser?token=${token}`)}\n\n` +
        `Si vous n'avez rien demandé, ignorez cet e-mail : votre mot de passe ne change pas.`,
    });
    await this.audit.log(user.id, 'password.reset_request', 'User', user.id);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) throw new BadRequestException('Lien invalide ou expiré. Refaites une demande.');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
      // Le lien ne sert qu'une fois ; les autres liens en attente de ce compte sont annulés aussi
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));
    });
    await this.audit.log(row.userId, 'password.reset', 'User', row.userId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }
    await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) })
      .where(eq(users.id, userId));
    await this.audit.log(userId, 'password.change', 'User', userId);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const [user] = await this.db
      .update(users)
      .set({
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        // Chaîne vide = numéro retiré
        phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
      })
      .where(eq(users.id, userId))
      .returning();
    return toPublicUser(user);
  }
}
