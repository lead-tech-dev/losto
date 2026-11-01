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
  nextConsultation: { id: string; scheduledAt: string; mode: string; kind: string; videoUrl: string | null; doctorName: string } | null;
  nextVisit: { id: string; scheduledAt: string } | null;
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
  kind?: string;
  summary: string | null;
  doctorName: string;
  referrals?: { destination: string; urgency: string; reason: string }[];
  labRequests?: FamilyLab[];
}

export interface FamilyLab {
  id: string;
  tests: string[];
  note: string | null;
  status: string;
  appointmentAt: string | null;
  appointmentMode: 'AT_LAB' | 'HOME_SAMPLING' | null;
  awaitingDoctorReview: boolean;
  results: string | null;
  doctorComment: string | null;
  createdAt: string;
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
  deliveryCode?: string | null;
  pharmacyNote?: string | null;
  cancelReason?: string | null;
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

// ---------- Portail soignants ----------

export interface ConsultationView {
  id: string;
  patientId: string;
  scheduledAt: string;
  durationMinutes: number;
  kind: 'INITIAL' | 'MONTHLY' | 'EXTRA';
  mode: 'VIDEO' | 'PHONE';
  status: 'SCHEDULED' | 'DONE' | 'MISSED' | 'CANCELED';
  videoUrl: string | null;
  summary: string | null;
  missedReason: string | null;
}

export interface AgendaItem extends ConsultationView {
  patient: { id: string; name: string; phone: string; conditions: string[] };
}

export interface AlertView {
  id: string;
  patientId: string;
  patientName: string;
  severity: 'WARNING' | 'URGENT';
  message: string;
  createdAt: string;
}

export interface DoctorPatientRow {
  id: string;
  name: string;
  birthYear: number | null;
  district: string;
  city: string;
  conditions: string[];
  plan: string | null;
  subscriptionStatus: string | null;
  openAlerts: number;
  nextConsultation: string | null;
}

export interface PatientFile {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    birthYear: number | null;
    whatsappPhone: string;
    hasSmartphone: boolean;
    city: string;
    district: string;
    addressDetails: string | null;
    conditions: string[];
    medicalHistory: string | null;
    currentTreatments: string | null;
    notes: string | null;
    plan: string | null;
    subscriptionStatus: string | null;
  };
  consultations: ConsultationView[];
  prescriptions: { id: string; items: PrescriptionItem[]; status: string; createdAt: string; consultationId: string }[];
  labRequests: { id: string; tests: string[]; status: string; results: string | null; resultsAbnormal: boolean | null; reviewedAt: string | null; doctorComment: string | null; note: string | null; createdAt: string }[];
  referrals: { id: string; destination: string; urgency: string; reason: string; createdAt: string }[];
  homeVisits: { id: string; scheduledAt: string; status: string; note: string | null; treatmentChecked: boolean | null }[];
  readings: Reading[];
  openAlerts: (Omit<AlertView, 'patientName'>)[];
}

export interface Slot {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface NurseVisit {
  id: string;
  patientId: string;
  scheduledAt: string;
  status: string;
  note: string | null;
  patient: { name: string; phone: string; address: string };
}

export interface NurseVisitDetail {
  visit: { id: string; scheduledAt: string; status: string; note: string | null; treatmentChecked: boolean | null };
  patient: { id: string; name: string; birthYear: number | null; phone: string; address: string; conditions: string[]; notes: string | null };
  treatment: { items: PrescriptionItem[]; since: string } | { declared: string } | null;
  recentReadings: { type: string; systolic: number | null; diastolic: number | null; value: number | null; measuredAt: string }[];
}

// ---------- Pharmacie, laboratoire, livreur ----------

export interface PharmacyPrescription {
  id: string;
  items: PrescriptionItem[];
  status: string;
  priceXaf: number | null;
  pharmacyNote: string | null;
  cancelReason: string | null;
  createdAt: string;
  readyAt: string | null;
  patientName: string;
  district: string;
  doctorName: string;
  deliveryStatus: string | null;
}

export interface LabRequestRow {
  id: string;
  tests: string[];
  note: string | null;
  status: string;
  appointmentAt: string | null;
  appointmentMode: 'AT_LAB' | 'HOME_SAMPLING' | null;
  sampledAt: string | null;
  results: string | null;
  resultsAbnormal: boolean | null;
  resultsAt: string | null;
  createdAt: string;
  patient: { name: string; phone: string; address: string };
  doctorName: string;
}

export interface CourierDelivery {
  id: string;
  status: 'ASSIGNED' | 'IN_TRANSIT' | 'FAILED';
  attempts: number;
  failureReason: string | null;
  pickedUpAt: string | null;
  createdAt: string;
  pickup: { name: string; phone: string | null };
  dropoff: { name: string; phone: string; address: string };
}
