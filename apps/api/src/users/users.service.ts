import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { BCRYPT_ROUNDS, toPublicUser } from '../auth/auth.service';
import { Database, DB } from '../db/db.module';
import { partnerProfiles, PartnerProfile, Role, User, users } from '../db/schema';
import { CreateStaffDto } from './dto/create-staff.dto';

function withProfile(user: User, partnerProfile: PartnerProfile | null) {
  return { ...toPublicUser(user), partnerProfile };
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async createStaff(actorId: string, dto: CreateStaffDto) {
    const email = dto.email.trim().toLowerCase();
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictException('Un compte existe déjà avec cette adresse e-mail');

    const isPartner = dto.role !== Role.ADMIN;
    if (isPartner && !dto.city) {
      throw new BadRequestException('La ville est obligatoire pour un partenaire');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Transaction : le compte et son profil partenaire sont créés ensemble, ou pas du tout.
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          role: dto.role,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone?.trim(),
        })
        .returning();
      let profile: PartnerProfile | null = null;
      if (isPartner) {
        [profile] = await tx
          .insert(partnerProfiles)
          .values({
            userId: user.id,
            city: dto.city!,
            organizationName: dto.organizationName,
            licenseNumber: dto.licenseNumber,
          })
          .returning();
      }
      return withProfile(user, profile);
    });

    await this.audit.log(actorId, 'user.create', 'User', result.id);
    return result;
  }

  async list(role?: Role) {
    const rows = await this.db
      .select()
      .from(users)
      .leftJoin(partnerProfiles, eq(partnerProfiles.userId, users.id))
      .where(role ? eq(users.role, role) : undefined)
      .orderBy(desc(users.createdAt));
    return rows.map((r) => withProfile(r.users, r.partner_profiles));
  }

  async setActive(actorId: string, userId: string, isActive: boolean) {
    if (actorId === userId && !isActive) {
      throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte');
    }
    const [user] = await this.db.update(users).set({ isActive }).where(eq(users.id, userId)).returning();
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    await this.audit.log(actorId, isActive ? 'user.activate' : 'user.deactivate', 'User', userId);
    return toPublicUser(user);
  }

  // Marque les documents d'un partenaire comme vérifiés (numéro d'Ordre, agrément...)
  async verifyPartner(actorId: string, userId: string) {
    const [profile] = await this.db
      .update(partnerProfiles)
      .set({ verifiedAt: new Date() })
      .where(eq(partnerProfiles.userId, userId))
      .returning();
    if (!profile) throw new NotFoundException('Profil partenaire introuvable');
    await this.audit.log(actorId, 'partner.verify', 'PartnerProfile', profile.id);
    return profile;
  }
}
