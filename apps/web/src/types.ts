// Formes des données renvoyées par l'API pour l'espace famille.

export interface Subscription {
  plan: 'ESSENTIEL' | 'SERENITE';
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
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
