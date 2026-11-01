// Surveillance des erreurs : Sentry si SENTRY_DSN est renseigné, et une alerte e-mail à l'équipe
// (une seule par type d'erreur et par heure, pour ne pas noyer les boîtes).
// Aucune donnée de santé ne part chez Sentry : corps des requêtes, en-têtes et utilisateur sont retirés.
import { ArgumentsHost, Catch, HttpException, Injectable, Logger } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { NotifyService } from '../mail/notify.service';

let sentryOn = false;

export function initMonitoring() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
  });
  sentryOn = true;
}

const HOUR = 3600_000;

@Injectable()
export class ErrorReporter {
  private readonly logger = new Logger('Erreurs');
  private readonly lastAlert = new Map<string, number>();

  constructor(private readonly notify: NotifyService) {}

  // Signature d'une erreur : son type et son message, sans les identifiants qui varient
  static key(err: unknown): string {
    const e = err instanceof Error ? err : new Error(String(err));
    return `${e.name}: ${e.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').replace(/\d+/g, '<n>')}`.slice(0, 200);
  }

  async report(err: unknown, where: string, now = Date.now()): Promise<boolean> {
    const e = err instanceof Error ? err : new Error(String(err));
    this.logger.error(`${where} : ${e.message}`, e.stack);
    if (sentryOn) Sentry.captureException(e, { tags: { where } });
    const key = ErrorReporter.key(e);
    const last = this.lastAlert.get(key);
    if (last && now - last < HOUR) return false;
    this.lastAlert.set(key, now);
    if (process.env.NODE_ENV === 'test' && !process.env.ALERTS_IN_TESTS) return true;
    await this.notify
      .admins(
        `Erreur de l'application : ${e.message.slice(0, 80)}`,
        `Une erreur inattendue s'est produite (${where}).\n\n${key}\n\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}\n\n` +
          `Les erreurs identiques ne seront pas signalées à nouveau pendant une heure.`,
      )
      .catch(() => undefined);
    return true;
  }
}

// Erreurs 500 (bugs, base injoignable…) : signalées, puis réponse standard de Nest
@Catch()
@Injectable()
export class ErrorsFilter extends BaseExceptionFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly reporter: ErrorReporter,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<{ method?: string; route?: { path?: string }; url?: string }>();
      void this.reporter.report(exception, `${req?.method ?? ''} ${req?.route?.path ?? req?.url?.split('?')[0] ?? ''}`.trim());
    }
    super.catch(exception, host);
  }
}
