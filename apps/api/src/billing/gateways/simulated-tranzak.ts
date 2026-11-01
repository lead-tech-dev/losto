import { Logger } from '@nestjs/common';
import { MobileChargeInput, TranzakGateway, TranzakRequest } from './tranzak.client';

// Mobile Money simulé, pour essayer l'application sans compte Tranzak (PAYMENTS_SIMULATION=true).
// Le paiement est "validé" 6 secondes après la demande ; un numéro finissant par 000 simule un refus.
// Jamais actif en production (voir billing.module.ts).
export class SimulatedTranzak extends TranzakGateway {
  private readonly logger = new Logger('SimulatedTranzak');
  private readonly requests = new Map<string, TranzakRequest & { createdAt: number; refuse: boolean }>();
  private n = 0;

  get configured() {
    return true;
  }

  async chargeMobileWallet(input: MobileChargeInput): Promise<TranzakRequest> {
    const requestId = `SIM${Date.now()}${++this.n}`;
    const req = {
      requestId,
      status: 'PENDING' as const,
      amount: input.amountXaf,
      currencyCode: 'XAF',
      mchTransactionRef: input.mchTransactionRef,
      createdAt: Date.now(),
      refuse: input.mobileWalletNumber.endsWith('000'),
    };
    this.requests.set(requestId, req);
    this.logger.warn(`Paiement SIMULÉ de ${input.amountXaf} FCFA demandé au ${input.mobileWalletNumber}`);
    return this.view(req);
  }

  async getRequest(requestId: string): Promise<TranzakRequest> {
    const req = this.requests.get(requestId);
    if (!req) throw new Error('Demande simulée inconnue (le serveur a peut-être redémarré)');
    return this.view(req);
  }

  private view(r: TranzakRequest & { createdAt: number; refuse: boolean }): TranzakRequest {
    const done = Date.now() - r.createdAt > 6000;
    const status = !done ? 'PENDING' : r.refuse ? 'CANCELLED_BY_PAYER' : 'SUCCESSFUL';
    return { requestId: r.requestId, amount: r.amount, currencyCode: 'XAF', mchTransactionRef: r.mchTransactionRef, status };
  }
}
