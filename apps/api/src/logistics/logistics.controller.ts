import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Database, DB } from '../db/db.module';
import { deliveries, LAB_APPOINTMENT_MODES, Role, users } from '../db/schema';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CourierService } from './courier.service';
import { LabService } from './lab.service';
import { PharmacyService } from './pharmacy.service';

class PriceDto {
  @IsInt() @Min(100) @Max(2_000_000) priceXaf: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}
class AppointmentDto {
  @IsDateString() at: string;
  @IsIn(LAB_APPOINTMENT_MODES) mode: (typeof LAB_APPOINTMENT_MODES)[number];
}
class ResultsDto {
  @IsString() @MinLength(3) @MaxLength(10_000) results: string;
  @IsBoolean() abnormal: boolean;
}
class ReviewDto {
  @IsString() @MinLength(3) @MaxLength(2000) comment: string;
}
class CodeDto {
  @Matches(/^\d{4}$/, { message: 'Le code fait 4 chiffres' }) code: string;
}
class AssignCourierDto {
  @IsString() courierId: string;
}

const Id = () => Param('id', ParseUUIDPipe);

@Roles(Role.PHARMACY)
@Controller('pharmacy/prescriptions')
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.pharmacy.list(u.id, status);
  }

  @Post(':id/price')
  price(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: PriceDto) {
    return this.pharmacy.setPrice(u.id, id, dto.priceXaf, dto.note);
  }

  @Post(':id/reject')
  reject(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: ReasonDto) {
    return this.pharmacy.reject(u.id, id, dto.reason);
  }

  @Post(':id/ready')
  ready(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.pharmacy.ready(u.id, id);
  }
}

@Roles(Role.LAB)
@Controller('lab/requests')
export class LabController {
  constructor(private readonly lab: LabService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.lab.list(u.id);
  }

  @Post(':id/appointment')
  appointment(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: AppointmentDto) {
    return this.lab.appointment(u.id, id, new Date(dto.at), dto.mode);
  }

  @Post(':id/sampled')
  sampled(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.lab.sampled(u.id, id);
  }

  @Post(':id/results')
  results(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: ResultsDto) {
    return this.lab.results(u.id, id, dto.results, dto.abnormal);
  }
}

@Roles(Role.DOCTOR)
@Controller('doctor/labs')
export class DoctorLabController {
  constructor(private readonly lab: LabService) {}

  @Post(':id/review')
  review(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: ReviewDto) {
    return this.lab.review(u.id, id, dto.comment);
  }
}

@Roles(Role.COURIER)
@Controller('courier/deliveries')
export class CourierController {
  constructor(private readonly courier: CourierService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.courier.list(u.id);
  }

  @Post(':id/picked-up')
  pickedUp(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.courier.pickedUp(u.id, id);
  }

  // Limite de débit : empêche d'essayer les 10 000 codes possibles
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':id/delivered')
  delivered(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CodeDto) {
    return this.courier.delivered(u.id, id, dto.code);
  }

  @Post(':id/failed')
  failed(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: ReasonDto) {
    return this.courier.failed(u.id, id, dto.reason);
  }

  @Post(':id/retry')
  retry(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.courier.retry(u.id, id);
  }
}

@Roles(Role.ADMIN)
@Controller('admin/deliveries')
export class AdminDeliveriesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // Réaffecter une livraison à un autre livreur (absence, zone...)
  @Patch(':id/courier')
  async assign(@CurrentUser() actor: AuthUser, @Id() id: string, @Body() dto: AssignCourierDto) {
    const [c] = await this.db.select().from(users).where(eq(users.id, dto.courierId)).limit(1);
    if (!c || c.role !== 'COURIER' || !c.isActive) throw new BadRequestException('Ce compte n’est pas un livreur actif');
    const [d] = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    if (!d) throw new NotFoundException('Livraison introuvable');
    const status = d.status === 'PENDING' || d.status === 'FAILED' ? (d.pickedUpAt ? 'IN_TRANSIT' : 'ASSIGNED') : d.status;
    await this.db.update(deliveries).set({ courierId: dto.courierId, status }).where(eq(deliveries.id, id));
    await this.audit.log(actor.id, 'delivery.assign', 'Delivery', id);
    return { courierId: dto.courierId, status };
  }
}
