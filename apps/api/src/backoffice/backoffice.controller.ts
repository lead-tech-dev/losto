import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SignupFollowupService } from '../billing/signup-followup.service';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../db/schema';
import { previousMonth } from '../whatsapp/reports.service';
import { BackofficeService } from './backoffice.service';
import { StatementsService } from './statements.service';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const month = (raw: string | undefined, fallback: string) => {
  const m = raw ?? fallback;
  if (!MONTH.test(m)) throw new BadRequestException('Mois attendu au format AAAA-MM');
  return m;
};
const currentMonth = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 7);

class RefundDto {
  @IsString()
  @IsNotEmpty({ message: 'Indiquez le motif du remboursement' })
  @MaxLength(500)
  reason!: string;

  // Mobile Money : référence du remboursement fait sur le portail Tranzak (obligatoire)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

class PayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

@Roles(Role.ADMIN)
@Controller('admin')
export class BackofficeController {
  constructor(
    private readonly bo: BackofficeService,
    private readonly statements: StatementsService,
    private readonly signups: SignupFollowupService,
  ) {}

  @Get('overview')
  overview() {
    return this.bo.overview();
  }

  @Get('delays')
  delays() {
    return this.bo.delays();
  }

  @Get('patients')
  patients(@Query('search') search?: string, @Query('city') city?: string, @Query('status') status?: string) {
    return this.bo.patients({ search, city, status });
  }

  @Get('partners')
  partners(@Query('city') city = '', @Query('role') role = '') {
    return this.bo.partners(city, role);
  }

  @Get('payments')
  payments(@Query('status') status?: string, @Query('kind') kind?: string, @Query('month') m?: string, @Query('search') search?: string) {
    return this.bo.payments({ status, kind, month: m ? month(m, m) : undefined, search });
  }

  @Get('unpaid')
  unpaid() {
    return this.bo.unpaid();
  }

  // Inscriptions jamais payées : étape bloquante, relances envoyées, contact de la famille
  @Get('signups')
  async signupsPending() {
    return { pending: await this.signups.list(), conversion: await this.signups.conversion() };
  }

  @Post('payments/:id/refund')
  refund(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    return this.bo.refund(u.id, id, dto.reason, dto.reference);
  }

  @Get('payouts')
  payouts(@Query('month') m?: string) {
    return this.statements.month(month(m, previousMonth(new Date())));
  }

  @Get('payouts/:partnerId')
  payout(@Param('partnerId', ParseUUIDPipe) id: string, @Query('month') m?: string) {
    return this.statements.statement(id, month(m, previousMonth(new Date())));
  }

  @Post('payouts/:partnerId/:month/paid')
  paid(@CurrentUser() u: AuthUser, @Param('partnerId', ParseUUIDPipe) id: string, @Param('month') m: string, @Body() dto: PayoutDto) {
    return this.statements.markPaid(u.id, id, month(m, m), dto.reference);
  }

  @Get('metrics')
  metrics(@Query('months') months?: string) {
    return this.bo.metrics(Number(months) || 6);
  }

  @Get('audit')
  audit(
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    const date = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    return this.bo.auditLog({ action, entity, entityId, actor, from: date(from), to: date(to), page: Number(page) || 1 });
  }
}

// Chaque partenaire consulte ses propres relevés (et seulement les siens)
@Roles(Role.DOCTOR, Role.NURSE, Role.PHARMACY, Role.LAB, Role.COURIER)
@Controller('me/statement')
export class MyStatementController {
  constructor(private readonly statements: StatementsService) {}

  @Get()
  mine(@CurrentUser() u: AuthUser, @Query('month') m?: string) {
    return this.statements.statement(u.id, month(m, currentMonth()));
  }
}
