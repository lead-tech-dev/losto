import { ErrorReporter } from '../src/common/monitoring';
import { NotifyService } from '../src/mail/notify.service';

describe('signalement des erreurs', () => {
  const notify = { admins: jest.fn(async (_subject: string, _text: string) => undefined) };
  const reporter = new ErrorReporter(notify as unknown as NotifyService);

  beforeAll(() => {
    process.env.ALERTS_IN_TESTS = '1';
  });
  afterAll(() => {
    delete process.env.ALERTS_IN_TESTS;
  });

  it('prévient l’équipe une seule fois par heure pour une même erreur', async () => {
    const t = Date.now();
    expect(await reporter.report(new Error('connexion refusée au port 5432'), 'GET /api/patients', t)).toBe(true);
    expect(await reporter.report(new Error('connexion refusée au port 5433'), 'GET /api/patients', t + 60_000)).toBe(false);
    expect(await reporter.report(new Error('autre panne'), 'POST /api/x', t + 60_000)).toBe(true);
    expect(await reporter.report(new Error('connexion refusée au port 5432'), 'GET /api/patients', t + 2 * 3600_000)).toBe(true);
    expect(notify.admins).toHaveBeenCalledTimes(3);
    expect(notify.admins.mock.calls[0][0]).toBe("Erreur de l'application : connexion refusée au port 5432");
  });

  it('regroupe les erreurs qui ne diffèrent que par un identifiant', () => {
    expect(ErrorReporter.key(new Error('Parent 3f2b1c4d-1111-4222-8333-944455556666 introuvable'))).toBe(
      ErrorReporter.key(new Error('Parent 9a8b7c6d-1111-4222-8333-944455556666 introuvable')),
    );
  });
});
