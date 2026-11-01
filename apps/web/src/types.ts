// Formes des données renvoyées par l'API pour l'espace famille.

export interface Subscription {
  plan: 'ESSENTIEL' | 'SERENITE';
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
  priceEur: number;
  currentPeriodEnd: string | null;
}

export interface PatientSummary {
  id: string;
  firstName: string;
  lastName: string;
  city: string;
  district: string;
  conditions: string[];
  consentGiven: boolean;
  covered: boolean;
  role: 'OWNER' | 'MEMBER';
  subscription: Subscription | null;
}

export interface PatientDetail extends PatientSummary {
  birthYear: number | null;
  whatsappPhone: string;
  hasSmartphone: boolean;
  addressDetails: string | null;
  medicalHistory: string | null;
  currentTreatments: string | null;
  notes: string | null;
  createdAt: string;
  consentUrl: string | null;
}

export interface Reading {
  id: string;
  type: 'BLOOD_PRESSURE' | 'GLUCOSE' | 'WEIGHT';
  systolic: number | null;
  diastolic: number | null;
  value: number | null;
  measuredAt: string;
  source: string;
}

export interface PrescriptionItem {
  name: string;
  dosage?: string;
  quantity?: number;
}

export interface Dashboard {
  nextConsultation: { id: string; scheduledAt: string; mode: string; doctorName: string } | null;
  latestReadings: Reading[];
  treatment:
    | { source: 'PRESCRIPTION'; items: PrescriptionItem[]; since: string }
    | { source: 'DECLARED'; text: string }
    | null;
  deliveries: { id: string; status: string; deliveredAt: string | null; createdAt: string }[];
}

export interface Consultation {
  id: string;
  scheduledAt: string;
  mode: string;
  status: string;
  summary: string | null;
  doctorName: string;
}

export interface Report {
  id: string;
  month: string;
  content: string;
  sentAt: string | null;
}

export interface Prescription {
  id: string;
  items: PrescriptionItem[];
  status: string;
  priceXaf: number | null;
  createdAt: string;
  doctorName: string;
  deliveryStatus: string | null;
  deliveredAt: string | null;
}

export interface Members {
  owner: { id: string; name: string; email?: string };
  members: { id: string; name: string; email?: string }[];
  pendingInvitations: { id: string; email: string; expiresAt: string }[];
}

export interface Message {
  id: string;
  body: string;
  fromTeam: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface PaymentLine {
  label: string;
  amount: number;
}

export interface PaymentView {
  id: string;
  kind: 'SUBSCRIPTION' | 'MEDICATION';
  method: 'CARD' | 'MOBILE_MONEY';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'REFUNDED';
  amount: number;
  currency: 'EUR' | 'XAF';
  amountLabel: string;
  lines: PaymentLine[];
  plan: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  invoiceNumber: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  patientId: string;
  patientName?: string;
}

export interface SubscriptionView {
  role: 'OWNER' | 'MEMBER';
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
  plan: 'ESSENTIEL' | 'SERENITE';
  pendingPlan: 'ESSENTIEL' | 'SERENITE' | null;
  paymentMethod: 'CARD' | 'MOBILE_MONEY' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  priceEur: number;
  nextPayment: { plan: string; eur: number; xaf: number; includesSignupFee: boolean };
  canPay: { card: boolean; mobileMoney: boolean; reason: string | null };
  pendingPayment: PaymentView | null;
  cardConfigured: boolean;
  mobileMoneyConfigured: boolean;
}

export type CheckoutResult = { kind: 'redirect'; url: string } | { kind: 'mobile'; payment: PaymentView };
