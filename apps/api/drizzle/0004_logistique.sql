CREATE TYPE "public"."lab_appointment_mode" AS ENUM('AT_LAB', 'HOME_SAMPLING');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'LAB' BEFORE 'COURIER';--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "lab_request_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "code" text NOT NULL DEFAULT lpad(floor(random() * 10000)::int::text, 4, '0');--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "code" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "picked_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD COLUMN "lab_id" uuid;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD COLUMN "appointment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD COLUMN "appointment_mode" "lab_appointment_mode";--> statement-breakpoint
ALTER TABLE "lab_requests" ADD COLUMN "sampled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD COLUMN "results_abnormal" boolean;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "lab_id" uuid;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "pharmacy_note" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "priced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_lab_id_users_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_lab_id_users_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;