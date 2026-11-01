import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../db/schema';
import { ConsentService } from './consent.service';
import { CreatePatientDto, InviteDto, ReadingsQueryDto, UpdatePatientDto } from './dto/patient.dto';
import { FamilyService } from './family.service';
import { PatientRecordsService } from './patient-records.service';
import { PatientsService } from './patients.service';

const Id = () => Param('id', ParseUUIDPipe);

// Espace famille : tout est vérifié parent par parent (titulaire ou proche invité).
@Roles(Role.FAMILY)
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly records: PatientRecordsService,
    private readonly family: FamilyService,
  ) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePatientDto) {
    return this.patients.create(u.id, dto);
  }

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.patients.list(u.id);
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.patients.detail(u.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: UpdatePatientDto) {
    return this.patients.update(u.id, id, dto);
  }

  @Get(':id/dashboard')
  dashboard(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.records.dashboard(u.id, id);
  }

  @Get(':id/readings')
  readings(@CurrentUser() u: AuthUser, @Id() id: string, @Query() q: ReadingsQueryDto) {
    return this.records.readings(u.id, id, q.type, q.days);
  }

  @Get(':id/consultations')
  consultations(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.records.consultations(u.id, id);
  }

  @Get(':id/reports')
  reports(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.records.reports(u.id, id);
  }

  @Get(':id/prescriptions')
  prescriptions(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.records.prescriptions(u.id, id);
  }

  @Get(':id/members')
  members(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.family.members(u.id, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':id/invitations')
  invite(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: InviteDto) {
    return this.family.invite(u.id, id, dto.email);
  }

  @HttpCode(204)
  @Delete(':id/invitations/:invitationId')
  cancelInvitation(
    @CurrentUser() u: AuthUser,
    @Id() id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.family.cancelInvitation(u.id, id, invitationId);
  }

  @HttpCode(204)
  @Delete(':id/members/me')
  leave(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.family.leave(u.id, id);
  }

  @HttpCode(204)
  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() u: AuthUser, @Id() id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.family.removeMember(u.id, id, userId);
  }
}

@Roles(Role.FAMILY)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly family: FamilyService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.family.preview(token);
  }

  @HttpCode(200)
  @Post(':token/accept')
  accept(@CurrentUser() u: AuthUser, @Param('token') token: string) {
    return this.family.accept(u.id, token);
  }
}

// Page publique ouverte par le parent depuis WhatsApp, sans compte.
@Public()
@Throttle({ default: { ttl: 60_000, limit: 20 } })
@Controller('consent')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.consent.preview(token);
  }

  @HttpCode(200)
  @Post(':token')
  give(@Param('token') token: string) {
    return this.consent.give(token);
  }
}
