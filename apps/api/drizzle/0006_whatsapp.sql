CREATE TYPE "public"."wa_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."wa_status" AS ENUM('RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"patient_id" uuid,
	"user_id" uuid,
	"direction" "wa_direction" NOT NULL,
	"kind" text NOT NULL,
	"template" text,
	"body" text NOT NULL,
	"wa_id" text,
	"status" "wa_status" NOT NULL,
	"error" text,
	"dedupe_key" text,
	"needs_human" boolean DEFAULT false NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_wa_id_unique" UNIQUE("wa_id"),
	CONSTRAINT "whatsapp_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "monthly_reports" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "whatsapp_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_phone_idx" ON "whatsapp_messages" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "wa_patient_idx" ON "whatsapp_messages" USING btree ("patient_id","created_at");--> statement-breakpoint
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;