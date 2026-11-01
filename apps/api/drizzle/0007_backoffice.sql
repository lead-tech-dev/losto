CREATE TABLE "partner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"month" timestamp with time zone NOT NULL,
	"amount_xaf" integer NOT NULL,
	"items" integer NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone NOT NULL,
	"paid_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_ref" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payouts_partner_month_uq" ON "partner_payouts" USING btree ("partner_id","month");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_by_id_users_id_fk" FOREIGN KEY ("refunded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;