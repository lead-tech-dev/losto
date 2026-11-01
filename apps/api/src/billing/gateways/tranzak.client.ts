import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Client de l'API Tranzak (Mobile Money MTN et Orange au Cameroun).
// Doc : https://docs.developer.tranzak.me/
//   POST /auth/token                                  → jeton (valable ~2 h)
//   POST /xp021/v1/request/create-mobile-wallet-charge → envoie la demande de paiement sur le téléphone
//   GET  /xp021/v1/request/details?requestId=…          → statut réel d'un paiement

export type TranzakStatus =
  | 'PENDING'
  | 'PAYER_REDIRECT_REQUIRED'
  | 'PAYMENT_IN_PROGRESS'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'CANCELLED'
  | 'CANCELLED_BY_PAYER'
  | 'CANCELLED/REFUNDED';

export interface TranzakRequest {
  requestId: string;
  status: TranzakStatus;
  amount: number;
  currencyCode: string;
  mchTransactionRef?: string;
  transactionId?: string;
  errorMessage?: string;
}

export interface MobileChargeInput {
  amountXaf: number;
  description: string;
  mchTransactionRef: string; // 32 caractères max, unique sur 30 jours
  mobileWalletNumber: string; // indicatif sans "+" : "2376XXXXXXXX"
  payerNote?: string;
}

// Interface commune au vrai client et au faux client des tests
export abstract class TranzakGateway {
  abstract get configured(): boolean;
  abstract chargeMobileWallet(input: MobileChargeInput): Promise<TranzakRequest>;
  abstract getRequest(requestId: string): Promise<TranzakRequest>;
}

@Injectable()
export class TranzakClient extends TranzakGateway {
  private readonly logger = new Logger(TranzakClient.name);
  private readonly baseUrl: string;
  private readonly appId?: string;
  private readonly appKey?: string;
  private token?: { value: string; expiresAt: number };

  constructor(config: ConfigService) {
    super();
    this.appId = config.get('TRANZAK_APP_ID');
    this.appKey = config.get('TRANZAK_APP_KEY');
    const sandbox = config.get('TRANZAK_ENV') !== 'production';
    this.baseUrl = sandbox ? 'https://sandbox.dsapi.tranzak.me' : 'https://dsapi.tranzak.me';
  }

  get configured(): boolean {
    return Boolean(this.appId && this.appKey);
  }

  // Le jeton est gardé en mémoire et renouvelé aux 3/4 de sa durée, comme le recommande Tranzak.
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await this.call<{ token: string; expiresIn: number }>('/auth/token', {
      method: 'POST',
      body: { appId: this.appId, appKey: this.appKey },
      auth: false,
    });
    this.token = { value: res.token, expiresAt: Date.now() + res.expiresIn * 750 };
    return res.token;
  }

  chargeMobileWallet(input: MobileChargeInput): Promise<TranzakRequest> {
    return this.call<TranzakRequest>('/xp021/v1/request/create-mobile-wallet-charge', {
      method: 'POST',
      body: {
        amount: input.amountXaf,
        currencyCode: 'XAF',
        description: input.description.slice(0, 255),
        payerNote: input.payerNote?.slice(0, 32),
        mchTransactionRef: input.mchTransactionRef,
        mobileWalletNumber: input.mobileWalletNumber,
      },
    });
  }

  getRequest(requestId: string): Promise<TranzakRequest> {
    return this.call<TranzakRequest>(`/xp021/v1/request/details?requestId=${encodeURIComponent(requestId)}`, {
      method: 'GET',
    });
  }

  private async call<T>(path: string, opts: { method: 'GET' | 'POST'; body?: unknown; auth?: boolean }): Promise<T> {
    if (!this.configured) {
      throw new ServiceUnavailableException('Le paiement Mobile Money n’est pas encore configuré');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth !== false) headers.Authorization = `Bearer ${await this.getToken()}`;

    const res = await fetch(this.baseUrl + path, {
      method: opts.method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; errorMsg?: string } | null;
    if (!res.ok || !json?.success || !json.data) {
      this.logger.error(`Tranzak ${opts.method} ${path.split('?')[0]} → ${res.status} ${json?.errorMsg ?? ''}`);
      throw new ServiceUnavailableException(
        json?.errorMsg ? `Mobile Money : ${json.errorMsg}` : 'Le service Mobile Money ne répond pas, réessayez dans un instant',
      );
    }
    return json.data;
  }
}
