// Le client Tranzak envoie les bonnes requêtes (chemins, champs, jeton) — fetch est simulé.
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranzakClient } from '../src/billing/gateways/tranzak.client';

describe('Client Tranzak', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let next: (url: string) => { status: number; body: unknown };
  const realFetch = global.fetch;

  beforeEach(() => {
    calls.length = 0;
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = next(url);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const client = (env: Record<string, string> = {}) =>
    new TranzakClient(new ConfigService({ TRANZAK_APP_ID: 'app1', TRANZAK_APP_KEY: 'SAND_key', ...env }));

  const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });

  it('obtient un jeton une fois, puis le réutilise', async () => {
    next = (url) =>
      url.endsWith('/auth/token')
        ? ok({ token: 'tok123', expiresIn: 7200 })
        : ok({ requestId: 'REQ1', status: 'PENDING', amount: 16400, currencyCode: 'XAF' });
    const c = client();
    await c.chargeMobileWallet({ amountXaf: 16400, description: 'Suivi', mchTransactionRef: 'abc', mobileWalletNumber: '237677123456' });
    await c.getRequest('REQ1');

    expect(calls.map((x) => x.url)).toEqual([
      'https://sandbox.dsapi.tranzak.me/auth/token',
      'https://sandbox.dsapi.tranzak.me/xp021/v1/request/create-mobile-wallet-charge',
      'https://sandbox.dsapi.tranzak.me/xp021/v1/request/details?requestId=REQ1',
    ]);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ appId: 'app1', appKey: 'SAND_key' });
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({
      amount: 16400,
      currencyCode: 'XAF',
      mchTransactionRef: 'abc',
      mobileWalletNumber: '237677123456',
    });
  });

  it('utilise l’adresse de production si TRANZAK_ENV=production', async () => {
    next = () => ok({ token: 't', expiresIn: 7200 });
    await client({ TRANZAK_ENV: 'production' })
      .getRequest('REQ9')
      .catch(() => undefined);
    expect(calls[0].url).toBe('https://dsapi.tranzak.me/auth/token');
  });

  it("traduit une erreur Tranzak (success: false) en message lisible", async () => {
    next = (url) =>
      url.endsWith('/auth/token')
        ? ok({ token: 't', expiresIn: 7200 })
        : { status: 200, body: { success: false, data: {}, errorMsg: 'Numéro invalide', errorCode: 0 } };
    await expect(
      client().chargeMobileWallet({ amountXaf: 100, description: 'x', mchTransactionRef: 'r', mobileWalletNumber: '2370' }),
    ).rejects.toThrow('Mobile Money : Numéro invalide');
  });

  it('refuse de fonctionner sans identifiants', async () => {
    const c = new TranzakClient(new ConfigService({}));
    expect(c.configured).toBe(false);
    await expect(c.getRequest('x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(calls).toHaveLength(0);
  });
});
