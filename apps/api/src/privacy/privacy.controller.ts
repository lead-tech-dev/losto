import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Inject, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Database, DB } from '../db/db.module';
import { patients, Role } from '../db/schema';
import { PatientAccessService } from '../patients/patient-access.service';
import { PrivacyService } from './privacy.service';

class EraseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  confirmFirstName!: string;
}

const fileName = (first: string) => `proche-sante-${first.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}-${new Date().toISOString().slice(0, 10)}.json`;

// La famille titulaire exerce les droits du parent (copie, effacement)
@Roles(Role.FAMILY)
@Controller('patients/:id/privacy')
export class FamilyPrivacyController {
  constructor(
    private readonly access: PatientAccessService,
    private readonly privacy: PrivacyService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Get('export')
  async export(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const p = await this.access.requireOwner(u.id, id);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(p.firstName)}"`);
    return this.privacy.export(u.id, p);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('erase')
  async erase(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EraseDto) {
    const p = await this.access.requireOwner(u.id, id);
    return this.privacy.erase(u.id, p, dto.confirmFirstName);
  }
}

// L'équipe traite les demandes reçues autrement (courrier, WhatsApp du parent lui-même)
@Roles(Role.ADMIN)
@Controller('admin/patients/:id/privacy')
export class AdminPrivacyController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly privacy: PrivacyService,
  ) {}

  private async patient(id: string) {
    const [p] = await this.db.select().from(patients).where(eq(patients.id, id));
    if (!p || p.erasedAt) throw new NotFoundException('Parent introuvable');
    return p;
  }

  @Get('export')
  async export(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const p = await this.patient(id);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(p.firstName)}"`);
    return this.privacy.export(u.id, p);
  }

  @Post('erase')
  async erase(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EraseDto) {
    return this.privacy.erase(u.id, await this.patient(id), dto.confirmFirstName);
  }
}
