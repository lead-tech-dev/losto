import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { createHmac, timingSafeEqual } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClinicalAccessService } from '../care/clinical-access.service';
import { Database, DB } from '../db/db.module';
import { patients, Role, users, whatsappMessages } from '../db/schema';
import { PatientAccessService } from '../patients/patient-access.service';
import { WhatsAppInboundService } from './inbound.service';
import { decrypt } from '../db/crypto';
import { waPhone } from './phone';
import { previousMonth, ReportsService } from './reports.service';
import { TEMPLATES } from './templates';
import { WhatsAppService } from './whatsapp.service';

class ReplyDto {
  @IsString()
  @IsNotEmpty({ message: 'Écrivez un message' })
  @MaxLength(2000)
  text!: string;
}

class SimulateDto extends ReplyDto {
  @IsString()
  @Matches(/^\+?[\d ]{8,20}$/, { message: 'Numéro invalide' })
  phone!: string;
}

class ReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content!: string;
}

class GenerateDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mois attendu au format AAAA-MM' })
  month?: string;
}

interface MetaWebhook {
  entry?: {
    changes?: {
      value?: {
        messages?: { from: string; id: string; timestamp?: string; type: string; text?: { body?: string } }[];
        statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
      };
    }[];
  }[];
}

const STATUS_MAP: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

// ---------- Notifications de Meta (messages reçus, accusés de réception) ----------

@Public()
@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: Database,
    private readonly inbound: WhatsAppInboundService,
  ) {}

  // Vérification de l'adresse par Meta lors du branchement
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && token === expected) return res.type('text/plain').send(challenge);
    throw new ForbiddenException();
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }) {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    const signature = req.headers['x-hub-signature-256'];
    if (!secret || !req.rawBody || typeof signature !== 'string') throw new UnauthorizedException('Signature absente');
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`);
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new UnauthorizedException('Signature invalide');

    const body = req.body as MetaWebhook;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) {
          const status = STATUS_MAP[s.status];
          if (!status) continue;
          await this.db
            .update(whatsappMessages)
            .set({ status, error: status === 'FAILED' ? (s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? 'Échec') : undefined })
            .where(eq(whatsappMessages.waId, s.id));
        }
        for (const m of change.value?.messages ?? []) {
          await this.inbound.handle({
            from: m.from.replace(/\D/g, ''),
            waId: m.id,
            type: m.type,
            text: m.text?.body,
            at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
          });
        }
      }
    }
    return { ok: true };
  }
}

// ---------- Fils de discussion (lecture et réponse par l'équipe ou le médecin) ----------

async function threadOf(db: Database, phone: string) {
  return db
    .select({
      id: whatsappMessages.id,
      direction: whatsappMessages.direction,
      kind: whatsappMessages.kind,
      template: whatsappMessages.template,
      body: whatsappMessages.body,
      status: whatsappMessages.status,
      error: whatsappMessages.error,
      needsHuman: whatsappMessages.needsHuman,
      handledAt: whatsappMessages.handledAt,
      acknowledgedAt: whatsappMessages.acknowledgedAt,
      createdAt: whatsappMessages.createdAt,
      patientId: whatsappMessages.patientId,
    })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.phone, phone))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(200)
    .then((rows) => rows.reverse());
}

async function replyOnThread(db: Database, wa: WhatsAppService, phone: string, text: string, userId: string, patientId: string | null) {
  if (!(await wa.windowOpen(phone))) {
    throw new ConflictException(
      'Plus de 24 h depuis le dernier message du parent : WhatsApp n’autorise pas de réponse libre. Appelez-le, ou attendez qu’il écrive.',
    );
  }
  const r = await wa.send({ phone, kind: 'staff_reply', text, patientId });
  if (r.status !== 'SENT') throw new ConflictException('Le message n’a pas pu partir. Réessayez dans un instant.');
  await db
    .update(whatsappMessages)
    .set({ handledAt: new Date(), handledById: userId })
    .where(and(eq(whatsappMessages.phone, phone), eq(whatsappMessages.needsHuman, true), isNull(whatsappMessages.handledAt)));
  return { ok: true };
}

@Roles(Role.ADMIN)
@Controller('admin/whatsapp')
export class AdminWhatsAppController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly wa: WhatsAppService,
    private readonly inbound: WhatsAppInboundService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  status() {
    return {
      configured: this.wa.configured,
      simulation: this.config.get('WHATSAPP_SIMULATION') === 'true',
      templates: Object.entries(TEMPLATES).map(([name, t]) => ({ name, body: t.body, params: t.params })),
    };
  }

  // Une ligne par numéro : dernier message, parent(s), messages à traiter
  @Get('threads')
  async threads() {
    const rows = await this.db.execute<{
      phone: string;
      last_at: Date;
      last_body: string;
      last_direction: string;
      pending: number;
      names: string | null;
    }>(sql`
      select m.phone,
             max(m.created_at) as last_at,
             (array_agg(m.body order by m.created_at desc))[1] as last_body,
             (array_agg(m.direction::text order by m.created_at desc))[1] as last_direction,
             count(*) filter (where m.needs_human and m.handled_at is null)::int as pending,
             (select string_agg(p.first_name || ' ' || p.last_name, ', ')
                from ${patients} p where regexp_replace(p.whatsapp_phone, '\\D', '', 'g') = m.phone) as names
        from ${whatsappMessages} m
       where m.user_id is null
       group by m.phone
       order by count(*) filter (where m.needs_human and m.handled_at is null) > 0 desc, max(m.created_at) desc
       limit 200`);
    return rows.rows.map((r) => ({
      phone: r.phone,
      lastAt: r.last_at,
      lastBody: decrypt(r.last_body),
      lastDirection: r.last_direction,
      pending: Number(r.pending),
      names: r.names,
    }));
  }

  @Get('threads/:phone')
  async thread(@CurrentUser() user: AuthUser, @Param('phone') raw: string) {
    const phone = waPhone(`+${raw}`);
    if (!phone) throw new NotFoundException();
    const messages = await threadOf(this.db, phone);
    const people = await this.db
      .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, city: patients.city, district: patients.district })
      .from(patients)
      .where(sql`regexp_replace(${patients.whatsappPhone}, '\\D', '', 'g') = ${phone}`);
    for (const p of people) await this.audit.log(user.id, 'whatsapp.thread.read', 'Patient', p.id);
    return { phone, patients: people, windowOpen: await this.wa.windowOpen(phone), messages };
  }

  @Post('threads/:phone/reply')
  async reply(@CurrentUser() user: AuthUser, @Param('phone') raw: string, @Body() dto: ReplyDto) {
    const phone = waPhone(`+${raw}`);
    if (!phone) throw new NotFoundException();
    const [p] = await this.db.select({ id: patients.id }).from(patients).where(sql`regexp_replace(${patients.whatsappPhone}, '\\D', '', 'g') = ${phone}`).limit(1);
    return replyOnThread(this.db, this.wa, phone, dto.text.trim(), user.id, p?.id ?? null);
  }

  @Post('threads/:phone/handled')
  async handled(@CurrentUser() user: AuthUser, @Param('phone') raw: string) {
    const phone = waPhone(`+${raw}`) ?? '';
    await this.db
      .update(whatsappMessages)
      .set({ handledAt: new Date(), handledById: user.id })
      .where(and(eq(whatsappMessages.phone, phone), eq(whatsappMessages.needsHuman, true), isNull(whatsappMessages.handledAt)));
    return { ok: true };
  }

  // Mode simulation uniquement : écrire « comme le parent » pour essayer le parcours sans Meta
  @Post('simulate')
  async simulate(@Body() dto: SimulateDto) {
    if (this.config.get('WHATSAPP_SIMULATION') !== 'true') throw new ForbiddenException('Disponible seulement en mode simulation');
    const phone = waPhone(dto.phone);
    if (!phone) throw new NotFoundException();
    return this.inbound.handle({ from: phone, waId: `sim.in.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`, type: 'text', text: dto.text });
  }
}

@Roles(Role.ADMIN)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.reports.list(status === 'sent' ? 'sent' : 'draft');
  }

  @Post('generate')
  generate(@Body() dto: GenerateDto) {
    return this.reports.generateAll(dto.month ?? previousMonth(new Date()));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReportDto) {
    return this.reports.update(user.id, id, dto.content);
  }

  @Post(':id/send')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.send(user.id, id);
  }
}

// ---------- Médecin : les messages de ses patients ----------

@Roles(Role.DOCTOR)
@Controller('doctor/patients/:id/whatsapp')
export class DoctorWhatsAppController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly wa: WhatsAppService,
    private readonly access: ClinicalAccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const p = await this.access.patientForDoctor(user.id, id);
    const phone = waPhone(p.whatsappPhone)!;
    await this.audit.log(user.id, 'whatsapp.thread.read', 'Patient', id);
    // Numéro partagé : seulement les messages de ce parent (et les réponses envoyées sur ce numéro)
    const messages = (await threadOf(this.db, phone)).filter((m) => !m.patientId || m.patientId === id);
    return { windowOpen: await this.wa.windowOpen(phone), messages };
  }

  @Post('reply')
  async reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyDto) {
    const p = await this.access.patientForDoctor(user.id, id);
    const [doc] = await this.db.select({ lastName: users.lastName }).from(users).where(eq(users.id, user.id));
    return replyOnThread(this.db, this.wa, waPhone(p.whatsappPhone)!, `Dr ${doc.lastName} : ${dto.text.trim()}`, user.id, id);
  }
}

// ---------- Famille : renvoyer le message de bienvenue ----------

@Roles(Role.FAMILY)
@Controller('patients/:id/whatsapp')
export class FamilyWhatsAppController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly wa: WhatsAppService,
    private readonly access: PatientAccessService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('welcome')
  async resend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const patient = await this.access.requireOwner(user.id, id);
    if (patient.consentGivenAt) throw new ConflictException(`${patient.firstName} a déjà accepté le suivi`);
    if (!patient.hasSmartphone) throw new ConflictException(`${patient.firstName} n’a pas de smartphone : transmettez-lui le lien vous-même`);
    const [owner] = await this.db.select().from(users).where(eq(users.id, user.id));
    const today = new Date().toISOString().slice(0, 10);
    const r = await this.wa.welcome(patient, `${owner.firstName} ${owner.lastName}`, `welcome:${id}:${today}`);
    if (r.status === 'DUPLICATE') throw new ConflictException('Le message a déjà été renvoyé aujourd’hui');
    if (r.status !== 'SENT') throw new ConflictException('Le message n’a pas pu partir. Vérifiez le numéro WhatsApp du parent.');
    return { ok: true };
  }
}
