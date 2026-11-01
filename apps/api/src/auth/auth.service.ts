import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import { Role, User, users } from '../db/schema';
import { LoginDto } from './dto/login.dto';
import { RegisterFamilyDto } from './dto/register-family.dto';
import { TERMS_VERSION } from '../legal/legal.controller';

export const BCRYPT_ROUNDS = 12;

// Version d'un utilisateur renvoyée au client : jamais le hash du mot de passe.
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  // Seules les familles s'inscrivent elles-mêmes. Les partenaires sont créés par l'admin après vérification.
  async registerFamily(dto: RegisterFamilyDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.findByEmail(email)) {
      throw new ConflictException('Un compte existe déjà avec cette adresse e-mail');
    }

    const [user] = await this.db
      .insert(users)
      .values({
        email,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        role: Role.FAMILY,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim(),
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      })
      .returning();
    await this.audit.log(user.id, 'user.register', 'User', user.id);
    return this.issueToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.findByEmail(dto.email.trim().toLowerCase());
    // Même message que le compte existe ou non : on ne révèle pas quelles adresses sont inscrites.
    const valid = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || !valid || !user.isActive) {
      throw new UnauthorizedException('E-mail ou mot de passe incorrect');
    }
    await this.audit.log(user.id, 'user.login', 'User', user.id);
    return this.issueToken(user);
  }

  async me(userId: string): Promise<PublicUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return toPublicUser(user);
  }

  private async issueToken(user: User) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    return { accessToken, user: toPublicUser(user) };
  }
}
