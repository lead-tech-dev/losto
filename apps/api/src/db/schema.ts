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
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------- Types énumérés ----------

export const ROLES = ['FAMILY', 'DOCTOR', 'NURSE', 'PHARMACY', 'COURIER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];
// Role.ADMIN, Role.FAMILY... pour écrire le code sans faute de frappe
export const Role = Object.fromEntries(ROLES.map((r) => [r, r])) as { [K in Role]: K };

export const CITIES = ['DOUALA', 'YAOUNDE', 'OTHER'] as const;
export type City = (typeof CITIES)[number];

export const roleEnum = pgEnum('role', ROLES);
export const cityEnum = pgEnum('city', CITIES);
export const conditionEnum = pgEnum('condition', [
  'DIABETES',
  'HYPERTENSION',
  'CHOLESTEROL',
  'ASTHMA',
  'THYROID',
  'SENIOR_FOLLOWUP',
]);
export const planEnum = pgEnum('plan', ['ESSENTIEL', 'SERENITE']); // 25 € / 45 € par mois
export const subscriptionStatusEnum = pgEnum('subscription_status', ['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED']);
export const consultationModeEnum = pgEnum('consultation_mode', ['VIDEO', 'PHONE']);
export const consultationStatusEnum = pgEnum('consultation_status', ['SCHEDULED', 'DONE', 'MISSED', 'CANCELED']);
export const prescriptionStatusEnum = pgEnum('prescription_status', ['SENT', 'PREPARING', 'READY', 'DELIVERED', 'CANCELED']);
export const deliveryStatusEnum = pgEnum('delivery_status', ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED']);
export const readingTypeEnum = pgEnum('reading_type', ['BLOOD_PRESSURE', 'GLUCOSE', 'WEIGHT']);
export const readingSourceEnum = pgEnum('reading_source', ['WHATSAPP', 'NURSE', 'DOCTOR']);

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
  isActive: boolean('is_active').notNull().default(true),
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
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('patients_family_idx').on(t.familyUserId)],
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
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
    mode: consultationModeEnum('mode').notNull().default('PHONE'),
    status: consultationStatusEnum('status').notNull().default('SCHEDULED'),
    summary: text('summary'), // compte rendu du médecin
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('consultations_doctor_idx').on(t.doctorId, t.scheduledAt), index('consultations_patient_idx').on(t.patientId)],
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
