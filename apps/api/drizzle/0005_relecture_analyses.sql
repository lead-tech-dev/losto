ALTER TABLE "lab_requests" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD COLUMN "doctor_comment" text;