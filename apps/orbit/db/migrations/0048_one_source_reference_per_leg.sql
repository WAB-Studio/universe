-- RF-134's model half: one row per (movement, account leg) naming the reference that leg's own
-- statement gave it. `transactions.external_ref` is untouched — it governs the app's own
-- export/import round trip, a different key for a different source. No reader or writer exists yet
-- (Module 15); this is a seat, proved here by the constraints and policies alone.
CREATE TABLE "finances"."transaction_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_id" uuid,
	"source_ref" text,
	"source_seq" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_sources_transaction_account_unique" UNIQUE("transaction_id","account_id"),
	CONSTRAINT "transaction_sources_ref_or_seq" CHECK (num_nonnulls("finances"."transaction_sources"."source_ref", "finances"."transaction_sources"."source_seq") >= 1),
	CONSTRAINT "transaction_sources_ref_length" CHECK (length("finances"."transaction_sources"."source_ref") <= 200)
);
--> statement-breakpoint
ALTER TABLE "finances"."transaction_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finances"."transaction_sources" ADD CONSTRAINT "transaction_sources_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "finances"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finances"."transaction_sources" ADD CONSTRAINT "transaction_sources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "finances"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finances"."transaction_sources" ADD CONSTRAINT "transaction_sources_statement_id_account_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "finances"."account_statements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_sources_account_ref_unique" ON "finances"."transaction_sources" USING btree ("account_id","source_ref") WHERE "finances"."transaction_sources"."source_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_sources_statement_seq_unique" ON "finances"."transaction_sources" USING btree ("statement_id","source_seq") WHERE "finances"."transaction_sources"."source_seq" is not null;--> statement-breakpoint
CREATE POLICY "transaction_sources_select" ON "finances"."transaction_sources" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select private.can_read_account("finances"."transaction_sources"."account_id")));--> statement-breakpoint
CREATE POLICY "transaction_sources_insert" ON "finances"."transaction_sources" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select private.can_write_account("finances"."transaction_sources"."account_id")));--> statement-breakpoint
CREATE POLICY "transaction_sources_delete" ON "finances"."transaction_sources" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select private.can_write_account("finances"."transaction_sources"."account_id")));--> statement-breakpoint
ALTER TABLE "finances"."transaction_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Supabase grants anon/authenticated/service_role at CREATE TABLE; every one of the three is revoked
-- before `authenticated` is re-granted, column by column.
REVOKE ALL ON TABLE "finances"."transaction_sources" FROM anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT (id, transaction_id, account_id, statement_id, source_ref, source_seq, created_at) ON TABLE "finances"."transaction_sources" TO authenticated;--> statement-breakpoint
GRANT INSERT (transaction_id, account_id, statement_id, source_ref, source_seq) ON TABLE "finances"."transaction_sources" TO authenticated;--> statement-breakpoint
-- No UPDATE: a source reference is replaced by deleting and re-inserting.
GRANT DELETE ON TABLE "finances"."transaction_sources" TO authenticated;--> statement-breakpoint
CREATE TRIGGER capture_audit AFTER INSERT OR UPDATE OR DELETE ON "finances"."transaction_sources"
  FOR EACH ROW EXECUTE FUNCTION private.capture_audit();