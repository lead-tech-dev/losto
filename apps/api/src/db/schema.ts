// Schéma de données de Proche Santé.
// Chaque pgTable devient une table PostgreSQL, chaque pgEnum limite les valeurs possibles d'une colonne.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------- Types énumérés ----------

export const ROLES = ['FAMILY', 'DOCTOR', 'NURSE', 'PHARMACY', 'LAB', 'COURIER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];
// Role.ADMIN, Role.FAMILY... pour écrire le code sans faute de frappe
export const Role = Object.fromEntries(ROLES.map((r) => [r, r])) as { [K in Role]: K };

export const CITIES = ['DOUALA', 'YAOUNDE', 'OTHER'] as const;
export type City = (typeof CITIES)[number];

export const roleEnum = pgEnum('role', ROLES);
export const cityEnum = pgEnum('city', CITIES);
export const CONDITIONS = ['DIABETES', 'HYPERTENSION', 'CHOLESTEROL', 'ASTHMA', 'THYROID', 'SENIOR_FOLLOWUP'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const PLANS = ['ESSENTIEL', 'SERENITE'] as const; // 25 € / 45 € par mois
export type Plan = (typeof PLANS)[number];
export const READING_TYPES = ['BLOOD_PRESSURE', 'GLUCOSE', 'WEIGHT'] as const;
export type ReadingType = (typeof READING_TYPES)[number];

export const conditionEnum = pgEnum('condition', CONDITIONS);
export const planEnum = pgEnum('plan', PLANS);
// SUSPENDED = impayé après les relances : le suivi est arrêté jusqu'à régularisation
export const SUBSCRIPTION_STATUSES = ['PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const consultationModeEnum = pgEnum('consultation_mode', ['VIDEO', 'PHONE']);
export const consultationStatusEnum = pgEnum('consultation_status', ['SCHEDULED', 'DONE', 'MISSED', 'CANCELED']);
// AWAITING_PAYMENT = la pharmacie a donné son prix, la famille doit valider et payer avant préparation
export const prescriptionStatusEnum = pgEnum('prescription_status', [
  'SENT',
  'AWAITING_PAYMENT',
  'PREPARING',
  'READY',
  'DELIVERED',
  'CANCELED',
]);

export const PAYMENT_METHODS = ['CARD', 'MOBILE_MONEY'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentProviderEnum = pgEnum('payment_provider', ['STRIPE', 'TRANZAK']);
export const paymentKindEnum = pgEnum('payment_kind', ['SUBSCRIPTION', 'MEDICATION']);
export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const currencyEnum = pgEnum('currency', ['EUR', 'XAF']);
export const deliveryStatusEnum = pgEnum('delivery_status', ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED']);
export const readingTypeEnum = pgEnum('reading_type', READING_TYPES);
export const readingSourceEnum = pgEnum('reading_source', ['WHATSAPP', 'NURSE', 'DOCTOR']);
export const consultationKindEnum = pgEnum('consultation_kind', ['INITIAL', 'MONTHLY', 'EXTRA']); // bilan de départ, mensuelle, en plus
export const labStatusEnum = pgEnum('lab_status', ['REQUESTED', 'SAMPLED', 'RESULTS_AVAILABLE', 'CANCELED']);
export const LAB_APPOINTMENT_MODES = ['AT_LAB', 'HOME_SAMPLING'] as const;
export const labAppointmentModeEnum = pgEnum('lab_appointment_mode', LAB_APPOINTMENT_MODES);
export const REFERRAL_URGENCIES = ['ROUTINE', 'URGENT', 'EMERGENCY'] as const;
export const referralUrgencyEnum = pgEnum('referral_urgency', REFERRAL_URGENCIES);
export const alertSeverityEnum = pgEnum('alert_severity', ['WARNING', 'URGENT']);
export const waDirectionEnum = pgEnum('wa_direction', ['IN', 'OUT']);
export const WA_STATUSES = ['RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'] as const;
export const waStatusEnum = pgEnum('wa_status', WA_STATUSES);

// Colonnes de dates réutilisées partout
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- Comptes ----------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  // Famille : reçoit aussi les notifications sur WhatsApp (en plus de l'e-mail)
  whatsappNotifications: boolean('whatsapp_notifications').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  stripeCustomerId: text('stripe_customer_id').unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Infos professionnelles des partenaires (médecin, pharmacie, infirmier, livreur)
export const partnerProfiles = pgTable('partner_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  organizationName: text('organization_name'), // cabinet, pharmacie
  licenseNumber: text('license_number'), // n° d'inscription à l'Ordre, agrément
  city: cityEnum('city').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }), // documents vérifiés par l'admin
  createdAt: createdAt(),
});

// ---------- Le parent suivi ----------

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyUserId: uuid('family_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthYear: integer('birth_year'),
    whatsappPhone: text('whatsapp_phone').notNull(), // numéro camerounais du parent
    hasSmartphone: boolean('has_smartphone').notNull().default(true),
    city: cityEnum('city').notNull(),
    district: text('district').notNull(), // quartier, pour la livraison
    addressDetails: text('address_details'),
    conditions: conditionEnum('conditions').array().notNull().default(sql`'{}'`),
    medicalHistory: text('medical_history'), // antécédents
    currentTreatments: text('current_treatments'), // traitements déclarés à l'inscription
    notes: text('notes'),
    // Équipe soignante, affectée automatiquement à l'activation (modifiable par l'admin)
    doctorId: uuid('doctor_id').references(() => users.id),
    nurseId: uuid('nurse_id').references(() => users.id),
    pharmacyId: uuid('pharmacy_id').references(() => users.id),
    labId: uuid('lab_id').references(() => users.id),
    // Consentement : le parent confirme lui-même (lien envoyé par WhatsApp) qu'il accepte d'être suivi
    consentToken: text('consent_token').notNull().unique(),
    consentGivenAt: timestamp('consent_given_at', { withTimezone: true }),
    // Le parent a répondu STOP : plus aucun message automatique (il peut répondre REPRENDRE)
    whatsappOptOutAt: timestamp('whatsapp_opt_out_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('patients_family_idx').on(t.familyUserId)],
);

// Autres membres de la famille qui consultent le même parent (lecture seule)
export const patientMembers = pgTable(
  'patient_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('patient_members_uq').on(t.patientId, t.userId)],
);

// Invitation envoyée par e-mail à un membre de la famille
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  invitedById: uuid('invited_by_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(), // on ne garde que l'empreinte du jeton
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// Messagerie : un fil par compte famille, avec l'équipe Proche Santé
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyUserId: uuid('family_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    fromTeam: boolean('from_team').notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }), // lu par le destinataire
    createdAt: createdAt(),
  },
  (t) => [index('messages_family_idx').on(t.familyUserId, t.createdAt)],
);

// Quartiers où le service est disponible (médecin, pharmacie et livreur présents)
export const coverageZones = pgTable(
  'coverage_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    city: cityEnum('city').notNull(),
    district: text('district').notNull(), // nom affiché : "Bonapriso"
    districtKey: text('district_key').notNull(), // nom normalisé pour la comparaison : "bonapriso"
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('coverage_zones_uq').on(t.city, t.districtKey)],
);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .unique() // une formule par parent
    .references(() => patients.id, { onDelete: 'cascade' }),
  payerId: uuid('payer_id')
    .notNull()
    .references(() => users.id),
  plan: planEnum('plan').notNull(),
  status: subscriptionStatusEnum('status').notNull().default('PENDING'),
  paymentMethod: paymentMethodEnum('payment_method'), // choisi au premier paiement
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  // Mobile Money : nouvelle formule appliquée au prochain renouvellement
  pendingPlan: planEnum('pending_plan'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  signupFeePaidAt: timestamp('signup_fee_paid_at', { withTimezone: true }),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  // Relances : dernier rappel envoyé (avant échéance ou après impayé), pour ne pas envoyer deux fois le même
  lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Numérotation continue des factures, sans trou ni doublon même si deux paiements arrivent en même temps
export const invoiceNumberSeq = pgSequence('invoice_number_seq', { startWith: 1 });

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payerId: uuid('payer_id')
      .notNull()
      .references(() => users.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    prescriptionId: uuid('prescription_id').references(() => prescriptions.id, { onDelete: 'set null' }),
    kind: paymentKindEnum('kind').notNull(),
    provider: paymentProviderEnum('provider').notNull(),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    // Montant en plus petite unité : centimes pour EUR, francs pour XAF (pas de décimales)
    amount: integer('amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    // Détail de ce qui est payé : [{ "label": "Formule Essentiel, novembre 2026", "amount": 2500 }]
    lines: jsonb('lines').notNull(),
    plan: planEnum('plan'),
    includesSignupFee: boolean('includes_signup_fee').notNull().default(false),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    providerRef: text('provider_ref'), // requestId Tranzak, facture ou session Stripe
    mobileWalletNumber: text('mobile_wallet_number'),
    failureReason: text('failure_reason'),
    invoiceNumber: text('invoice_number').unique(), // attribué au paiement réussi : PS-2026-000001
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payments_payer_idx').on(t.payerId, t.createdAt),
    uniqueIndex('payments_provider_ref_uq').on(t.provider, t.providerRef),
  ],
);

// ---------- Soins ----------

export const consultations = pgTable(
  'consultations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => users.id),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(20),
    kind: consultationKindEnum('kind').notNull().default('MONTHLY'),
    mode: consultationModeEnum('mode').notNull().default('PHONE'),
    status: consultationStatusEnum('status').notNull().default('SCHEDULED'),
    videoUrl: text('video_url'), // salle de visio, créée pour les consultations en visio
    summary: text('summary'), // compte rendu du médecin, lisible par la famille
    missedReason: text('missed_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('consultations_doctor_idx').on(t.doctorId, t.scheduledAt), index('consultations_patient_idx').on(t.patientId)],
);

// Créneaux hebdomadaires où un médecin ou un infirmier est disponible, en heure du Cameroun (UTC+1, sans heure d'été)
export const availabilitySlots = pgTable(
  'availability_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(), // 1 = lundi ... 7 = dimanche
    startMinute: integer('start_minute').notNull(), // minutes depuis minuit : 540 = 9 h
    endMinute: integer('end_minute').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('availability_user_idx').on(t.userId)],
);

// Visites à domicile de l'infirmier(e), formule Sérénité
export const homeVisits = pgTable(
  'home_visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    nurseId: uuid('nurse_id')
      .notNull()
      .references(() => users.id),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(45),
    status: consultationStatusEnum('status').notNull().default('SCHEDULED'),
    treatmentChecked: boolean('treatment_checked'),
    note: text('note'),
    missedReason: text('missed_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('home_visits_nurse_idx').on(t.nurseId, t.scheduledAt), index('home_visits_patient_idx').on(t.patientId)],
);

// Analyses demandées par le médecin (résultats déposés par le laboratoire au module 5)
export const labRequests = pgTable('lab_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  consultationId: uuid('consultation_id').references(() => consultations.id, { onDelete: 'set null' }),
  requestedById: uuid('requested_by_id')
    .notNull()
    .references(() => users.id),
  tests: jsonb('tests').notNull(), // ["HbA1c", "Créatinine"]
  note: text('note'),
  status: labStatusEnum('status').notNull().default('REQUESTED'),
  labId: uuid('lab_id').references(() => users.id), // laboratoire partenaire chargé du prélèvement
  appointmentAt: timestamp('appointment_at', { withTimezone: true }),
  appointmentMode: labAppointmentModeEnum('appointment_mode'),
  sampledAt: timestamp('sampled_at', { withTimezone: true }),
  resultsAbnormal: boolean('results_abnormal'),
  // Résultats visibles par la famille seulement une fois lus et commentés par le médecin
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  doctorComment: text('doctor_comment'),
  results: text('results'),
  resultsAt: timestamp('results_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Orientation vers un spécialiste ou l'hôpital ; la famille est prévenue
export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  consultationId: uuid('consultation_id').references(() => consultations.id, { onDelete: 'set null' }),
  doctorId: uuid('doctor_id')
    .notNull()
    .references(() => users.id),
  destination: text('destination').notNull(), // "Cardiologue", "Urgences de l'hôpital Laquintinie"...
  urgency: referralUrgencyEnum('urgency').notNull(),
  reason: text('reason').notNull(),
  familyNotifiedAt: timestamp('family_notified_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// Alerte envoyée au médecin quand un relevé dépasse un seuil
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    readingId: uuid('reading_id').references(() => readings.id, { onDelete: 'cascade' }),
    labRequestId: uuid('lab_request_id'),
    doctorId: uuid('doctor_id').references(() => users.id), // médecin du parent au moment de l'alerte
    severity: alertSeverityEnum('severity').notNull(),
    message: text('message').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedById: uuid('acknowledged_by_id').references(() => users.id),
    acknowledgeNote: text('acknowledge_note'),
    createdAt: createdAt(),
  },
  (t) => [index('alerts_doctor_idx').on(t.doctorId, t.acknowledgedAt)],
);

export const prescriptions = pgTable('prescriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  consultationId: uuid('consultation_id')
    .notNull()
    .references(() => consultations.id, { onDelete: 'cascade' }),
  pharmacyId: uuid('pharmacy_id').references(() => users.id),
  // [{ "name": "Metformine 500 mg", "dosage": "1 matin et soir", "quantity": 60 }]
  items: jsonb('items').notNull(),
  status: prescriptionStatusEnum('status').notNull().default('SENT'),
  priceXaf: integer('price_xaf'), // prix pharmacie en FCFA, refacturé sans marge
  pharmacyNote: text('pharmacy_note'), // ex. "Amlodipine remplacée par un générique"
  cancelReason: text('cancel_reason'),
  pricedAt: timestamp('priced_at', { withTimezone: true }),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const deliveries = pgTable('deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  prescriptionId: uuid('prescription_id')
    .notNull()
    .unique()
    .references(() => prescriptions.id, { onDelete: 'cascade' }),
  courierId: uuid('courier_id').references(() => users.id),
  // Code à 4 chiffres connu du parent et de la famille, jamais du livreur : il le reçoit à la remise
  code: text('code').notNull(),
  codeAttempts: integer('code_attempts').notNull().default(0),
  attempts: integer('attempts').notNull().default(0), // tentatives de livraison échouées
  failureReason: text('failure_reason'),
  pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
  status: deliveryStatusEnum('status').notNull().default('PENDING'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Relevés envoyés par le parent (WhatsApp) ou mesurés par l'infirmier / le médecin
export const readings = pgTable(
  'readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    type: readingTypeEnum('type').notNull(),
    systolic: integer('systolic'), // tension, en mmHg
    diastolic: integer('diastolic'),
    value: numeric('value', { precision: 6, scale: 2 }), // glycémie en g/L, poids en kg
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    source: readingSourceEnum('source').notNull(),
    recordedById: uuid('recorded_by_id').references(() => users.id), // infirmier ou médecin qui a mesuré
    homeVisitId: uuid('home_visit_id'),
    consultationId: uuid('consultation_id'),
    createdAt: createdAt(),
  },
  (t) => [index('readings_patient_idx').on(t.patientId, t.measuredAt)],
);

export const monthlyReports = pgTable(
  'monthly_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    month: timestamp('month', { withTimezone: true }).notNull(), // 1er jour du mois concerné
    content: text('content').notNull(),
    // Brouillon généré automatiquement, relu (et corrigé) par l'équipe avant l'envoi à la famille
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('monthly_reports_patient_month_uq').on(t.patientId, t.month)],
);

// Journal des accès aux données de santé : qui a fait quoi, sur quoi, et quand
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // ex. "user.create"
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entity, t.entityId)],
);

export type User = typeof users.$inferSelect;
export type PartnerProfile = typeof partnerProfiles.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Consultation = typeof consultations.$inferSelect;
export type HomeVisit = typeof homeVisits.$inferSelect;
export type Reading = typeof readings.$inferSelect;

// ---------- WhatsApp ----------

// Tous les messages WhatsApp, reçus et envoyés : historique, fenêtre de 24 h, anti-doublon, coût
export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(), // chiffres seulement, indicatif compris : 237677123456
    patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // destinataire famille
    direction: waDirectionEnum('direction').notNull(),
    // welcome, med_reminder, appt_reminder, reading_ack, emergency, assistant, handoff, staff_reply, family_notice, delivery_code…
    kind: text('kind').notNull(),
    template: text('template'), // modèle Meta utilisé (fenêtre de 24 h fermée)
    body: text('body').notNull(),
    waId: text('wa_id').unique(), // identifiant du message chez Meta
    status: waStatusEnum('status').notNull(),
    error: text('error'),
    dedupeKey: text('dedupe_key').unique(), // un rappel donné n'est envoyé qu'une fois
    needsHuman: boolean('needs_human').notNull().default(false), // message à traiter par l'équipe
    handledAt: timestamp('handled_at', { withTimezone: true }),
    handledById: uuid('handled_by_id').references(() => users.id),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }), // rappel de médicaments confirmé par « OK »
    createdAt: createdAt(),
  },
  (t) => [index('wa_phone_idx').on(t.phone, t.createdAt), index('wa_patient_idx').on(t.patientId, t.createdAt)],
);
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
