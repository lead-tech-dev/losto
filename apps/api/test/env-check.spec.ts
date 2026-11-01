import { checkProductionEnv } from '../src/common/env-check';

describe('contrôles de démarrage en production', () => {
  const ok = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@h/db',
    JWT_SECRET: 'a'.repeat(48),
    WEB_ORIGIN: 'https://proche-sante.vercel.app',
    SMTP_HOST: 'smtp',
    TRANZAK_APP_ID: 'x',
    TRANZAK_APP_KEY: 'y',
    WHATSAPP_TOKEN: 'z',
    INVOICE_ISSUER_NAME: 'Startup Valley',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };

  it('accepte une configuration complète', () => {
    expect(checkProductionEnv(ok)).toEqual({ errors: [], warnings: [] });
  });

  it('refuse un secret faible, un site en http et les simulations', () => {
    const r = checkProductionEnv({ ...ok, JWT_SECRET: 'remplace-moi-par-une-longue-chaine-aleatoire', WEB_ORIGIN: 'http://site', PAYMENTS_SIMULATION: 'true', WHATSAPP_SIMULATION: 'true' });
    expect(r.errors).toHaveLength(4);
    expect(checkProductionEnv({ ...ok, DATA_ENCRYPTION_KEY: 'court' }).errors).toEqual([expect.stringContaining('DATA_ENCRYPTION_KEY')]);
  });

  it('prévient sans bloquer quand un service externe manque', () => {
    const r = checkProductionEnv({ ...ok, SMTP_HOST: '', WHATSAPP_TOKEN: '' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });

  it('ne contrôle rien en développement', () => {
    expect(checkProductionEnv({ NODE_ENV: 'development' })).toEqual({ errors: [], warnings: [] });
  });
});
