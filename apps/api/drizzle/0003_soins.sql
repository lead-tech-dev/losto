CREATE TYPE "public"."alert_severity" AS ENUM('WARNING', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."consultation_kind" AS ENUM('INITIAL', 'MONTHLY', 'EXTRA');--> statement-breakpoint
CREATE TYPE "public"."lab_status" AS ENUM('REQUESTED', 'SAMPLED', 'RESULTS_AVAILABLE', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."referral_urgency" AS ENUM('ROUTINE', 'URGENT', 'EMERGENCY');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"reading_id" uuid,
	"doctor_id" uuid,
	"severity" "alert_severity" NOT NULL,
	"message" text NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_id" uuid,
	"acknowledge_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"nurse_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"status" "consultation_status" DEFAULT 'SCHEDULED' NOT NULL,
	"treatment_checked" boolean,
	"note" text,
	"missed_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"consultation_id" uuid,
	"requested_by_id" uuid NOT NULL,
	"tests" jsonb NOT NULL,
	"note" text,
	"status" "lab_status" DEFAULT 'REQUESTED' NOT NULL,
	"results" text,
	"results_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"consultation_id" uuid,
	"doctor_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"urgency" "referral_urgency" NOT NULL,
	"reason" text NOT NULL,
	"family_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "duration_minutes" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "kind" "consultation_kind" DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "missed_reason" text;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "doctor_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "nurse_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "pharmacy_id" uuid;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "recorded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "home_visit_id" uuid;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "consultation_id" uuid;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_visits" ADD CONSTRAINT "home_visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_visits" ADD CONSTRAINT "home_visits_nurse_id_users_id_fk" FOREIGN KEY ("nurse_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_doctor_idx" ON "alerts" USING btree ("doctor_id","acknowledged_at");--> statement-breakpoint
CREATE INDEX "availability_user_idx" ON "availability_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "home_visits_nurse_idx" ON "home_visits" USING btree ("nurse_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "home_visits_patient_idx" ON "home_visits" USING btree ("patient_id");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_nurse_id_users_id_fk" FOREIGN KEY ("nurse_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_pharmacy_id_users_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;