import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Database, DB } from '../db/db.module';
import { availabilitySlots, Role } from '../db/schema';
import { CareTeamService } from './care-team.service';
import { DoctorService } from './doctor.service';
import {
  AckAlertDto,
  AvailabilityDto,
  CareTeamDto,
  CompleteConsultationDto,
  CompleteVisitDto,
  ExtraConsultationDto,
  MissedDto,
  RescheduleDto,
} from './dto/care.dto';
import { NurseService } from './nurse.service';

const Id = (name = 'id') => Param(name, ParseUUIDPipe);
const DAY = 24 * 60 * 60 * 1000;

function range(from?: string, to?: string) {
  const f = from ? new Date(from) : new Date(Date.now() - DAY);
  const t = to ? new Date(to) : new Date(f.getTime() + 8 * DAY);
  if (isNaN(f.getTime()) || isNaN(t.getTime()) || t <= f || t.getTime() - f.getTime() > 62 * DAY) {
    throw new BadRequestException('Période invalide (62 jours maximum)');
  }
  return [f, t] as const;
}

// Disponibilités hebdomadaires : médecins et infirmiers
@Roles(Role.DOCTOR, Role.NURSE)
@Controller('care/availability')
export class AvailabilityController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.db
      .select({ weekday: availabilitySlots.weekday, startMinute: availabilitySlots.startMinute, endMinute: availabilitySlots.endMinute })
      .from(availabilitySlots)
      .where(eq(availabilitySlots.userId, u.id))
      .orderBy(asc(availabilitySlots.weekday), asc(availabilitySlots.startMinute));
  }

  // Remplace toute la semaine type en une fois
  @Put()
  async set(@CurrentUser() u: AuthUser, @Body() dto: AvailabilityDto) {
    for (const s of dto.slots) {
      if (s.endMinute - s.startMinute < 20) throw new BadRequestException('Chaque plage doit durer au moins 20 minutes');
    }
    const byDay = new Map<number, typeof dto.slots>();
    for (const s of dto.slots) byDay.set(s.weekday, [...(byDay.get(s.weekday) ?? []), s]);
    for (const list of byDay.values()) {
      list.sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < list.length; i++) {
        if (list[i].startMinute < list[i - 1].endMinute) throw new BadRequestException('Deux plages se chevauchent le même jour');
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(availabilitySlots).where(eq(availabilitySlots.userId, u.id));
      if (dto.slots.length) await tx.insert(availabilitySlots).values(dto.slots.map((s) => ({ ...s, userId: u.id })));
    });
    await this.audit.log(u.id, 'care.availability', 'User', u.id);
    return this.get(u);
  }
}

@Roles(Role.DOCTOR)
@Controller('doctor')
export class DoctorController {
  constructor(private readonly doctor: DoctorService) {}

  @Get('agenda')
  agenda(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.doctor.agenda(u.id, ...range(from, to));
  }

  @Get('slots')
  slots(@CurrentUser() u: AuthUser) {
    return this.doctor.slots(u.id);
  }

  @Get('patients')
  patients(@CurrentUser() u: AuthUser) {
    return this.doctor.patients(u.id);
  }

  @Get('patients/:id')
  file(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.doctor.patientFile(u.id, id);
  }

  @Post('patients/:id/consultations')
  extra(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: ExtraConsultationDto) {
    return this.doctor.extra(u.id, id, dto.scheduledAt ? new Date(dto.scheduledAt) : undefined, dto.mode);
  }

  @Post('consultations/:id/complete')
  complete(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CompleteConsultationDto) {
    return this.doctor.complete(u.id, id, dto);
  }

  @Post('consultations/:id/missed')
  missed(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: MissedDto) {
    return this.doctor.missed(u.id, id, dto.reason);
  }

  @Post('consultations/:id/reschedule')
  reschedule(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: RescheduleDto) {
    return this.doctor.reschedule(u.id, id, new Date(dto.scheduledAt));
  }

  @Get('alerts')
  alerts(@CurrentUser() u: AuthUser) {
    return this.doctor.openAlerts(u.id);
  }

  @Post('alerts/:id/ack')
  ack(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: AckAlertDto) {
    return this.doctor.acknowledge(u.id, id, dto.note);
  }
}

@Roles(Role.NURSE)
@Controller('nurse')
export class NurseController {
  constructor(private readonly nurse: NurseService) {}

  @Get('visits')
  visits(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.nurse.visits(u.id, ...range(from, to));
  }

  @Get('visits/:id')
  visit(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.nurse.visitDetail(u.id, id);
  }

  @Post('visits/:id/complete')
  complete(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CompleteVisitDto) {
    return this.nurse.complete(u.id, id, dto);
  }

  @Post('visits/:id/missed')
  missed(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: MissedDto) {
    return this.nurse.missed(u.id, id, dto.reason);
  }
}

@Roles(Role.ADMIN)
@Controller('admin/patients')
export class AdminCareController {
  constructor(private readonly team: CareTeamService) {}

  @Patch(':id/care-team')
  setTeam(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CareTeamDto) {
    return this.team.setTeam(u.id, id, dto);
  }
}
