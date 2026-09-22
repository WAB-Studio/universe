-- drizzle-kit never emits this: `db/schema/index.ts` re-exports the tables but
-- not the `goals` PgSchema object itself, so its schema diff never sees a
-- schema to create. Hand-written, ahead of every grant below.
CREATE SCHEMA "goals";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "goals" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "goals" TO "authenticated";
--> statement-breakpoint
-- The default shield: the next CREATE TABLE that forgets its own REVOKE
-- concedes nothing, as reading's 0000_shallow_hammerhead.sql:11-13 does.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "goals"
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "goals"
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "goals"
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
--> statement-breakpoint
CREATE TABLE "goals"."goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"horizon" date NOT NULL,
	"measure_name" text,
	"measure_unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_measure_paired" CHECK (("goals"."goals"."measure_name" is null) = ("goals"."goals"."measure_unit" is null))
);
--> statement-breakpoint
ALTER TABLE "goals"."goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals"."phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"aim" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phases_ends_on_after_starts_on" CHECK ("goals"."phases"."ends_on" >= "goals"."phases"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "goals"."phases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals"."evidence_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label_key" text NOT NULL,
	"unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "goals"."evidence_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals"."commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cadence_kind" text NOT NULL,
	"cadence_n" integer,
	"cadence_weekdays" smallint[],
	"satisfaction" text NOT NULL,
	"target_quantity" integer,
	"unit" text,
	"source_id" uuid,
	"threshold" integer,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commitments_weekdays_for_weekdays" CHECK (case when "goals"."commitments"."cadence_kind" = 'weekdays' then coalesce(array_length("goals"."commitments"."cadence_weekdays", 1), 0) > 0 else "goals"."commitments"."cadence_weekdays" is null end),
	CONSTRAINT "commitments_weekdays_iso_range" CHECK ("goals"."commitments"."cadence_weekdays" <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
	CONSTRAINT "commitments_n_for_counted_kinds" CHECK (("goals"."commitments"."cadence_kind" in ('times_per_week', 'every_n_days', 'times_per_month')) = ("goals"."commitments"."cadence_n" is not null and "goals"."commitments"."cadence_n" > 0)),
	CONSTRAINT "commitments_quantity_for_quantity" CHECK (("goals"."commitments"."satisfaction" = 'quantity') = ("goals"."commitments"."target_quantity" is not null and "goals"."commitments"."unit" is not null)),
	CONSTRAINT "commitments_source_for_evidence" CHECK (("goals"."commitments"."satisfaction" = 'evidence') = ("goals"."commitments"."source_id" is not null and "goals"."commitments"."threshold" is not null and "goals"."commitments"."threshold" >= 1))
);
--> statement-breakpoint
ALTER TABLE "goals"."commitments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals"."one_offs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"name" text NOT NULL,
	"day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals"."one_offs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals"."facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"commitment_id" uuid,
	"one_off_id" uuid,
	"goal_id" uuid,
	"day" date NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quantity" integer,
	"note" text,
	CONSTRAINT "facts_note_length" CHECK (length("goals"."facts"."note") <= 280),
	CONSTRAINT "facts_one_subject" CHECK (("goals"."facts"."commitment_id" is null) <> ("goals"."facts"."one_off_id" is null))
);
--> statement-breakpoint
ALTER TABLE "goals"."facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals"."goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."phases" ADD CONSTRAINT "phases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."phases" ADD CONSTRAINT "phases_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "goals"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."commitments" ADD CONSTRAINT "commitments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."commitments" ADD CONSTRAINT "commitments_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "goals"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."commitments" ADD CONSTRAINT "commitments_source_id_evidence_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "goals"."evidence_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."one_offs" ADD CONSTRAINT "one_offs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."one_offs" ADD CONSTRAINT "one_offs_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "goals"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."facts" ADD CONSTRAINT "facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."facts" ADD CONSTRAINT "facts_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "goals"."commitments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."facts" ADD CONSTRAINT "facts_one_off_id_one_offs_id_fk" FOREIGN KEY ("one_off_id") REFERENCES "goals"."one_offs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."facts" ADD CONSTRAINT "facts_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "goals"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_user_id_retired_at_idx" ON "goals"."commitments" USING btree ("user_id","retired_at");--> statement-breakpoint
CREATE INDEX "facts_user_id_day_idx" ON "goals"."facts" USING btree ("user_id","day");--> statement-breakpoint
CREATE POLICY "goals_select_self" ON "goals"."goals" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goals"."goals"."user_id");--> statement-breakpoint
CREATE POLICY "goals_insert_self" ON "goals"."goals" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "goals"."goals"."user_id");--> statement-breakpoint
CREATE POLICY "goals_update_self" ON "goals"."goals" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "goals"."goals"."user_id") WITH CHECK ((select auth.uid()) = "goals"."goals"."user_id");--> statement-breakpoint
CREATE POLICY "goals_delete_self" ON "goals"."goals" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "goals"."goals"."user_id");--> statement-breakpoint
CREATE POLICY "phases_select_self" ON "goals"."phases" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goals"."phases"."user_id");--> statement-breakpoint
CREATE POLICY "phases_insert_self" ON "goals"."phases" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "goals"."phases"."user_id");--> statement-breakpoint
CREATE POLICY "phases_delete_self" ON "goals"."phases" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "goals"."phases"."user_id");--> statement-breakpoint
CREATE POLICY "evidence_sources_select_all" ON "goals"."evidence_sources" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "commitments_select_self" ON "goals"."commitments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goals"."commitments"."user_id");--> statement-breakpoint
CREATE POLICY "commitments_insert_self" ON "goals"."commitments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "goals"."commitments"."user_id");--> statement-breakpoint
CREATE POLICY "commitments_update_self" ON "goals"."commitments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "goals"."commitments"."user_id") WITH CHECK ((select auth.uid()) = "goals"."commitments"."user_id");--> statement-breakpoint
CREATE POLICY "commitments_delete_self" ON "goals"."commitments" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "goals"."commitments"."user_id");--> statement-breakpoint
CREATE POLICY "one_offs_select_self" ON "goals"."one_offs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goals"."one_offs"."user_id");--> statement-breakpoint
CREATE POLICY "one_offs_insert_self" ON "goals"."one_offs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "goals"."one_offs"."user_id");--> statement-breakpoint
CREATE POLICY "one_offs_delete_self" ON "goals"."one_offs" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "goals"."one_offs"."user_id");--> statement-breakpoint
CREATE POLICY "facts_select_self" ON "goals"."facts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goals"."facts"."user_id");--> statement-breakpoint
CREATE POLICY "facts_insert_self" ON "goals"."facts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "goals"."facts"."user_id");--> statement-breakpoint
CREATE POLICY "facts_delete_self" ON "goals"."facts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "goals"."facts"."user_id");--> statement-breakpoint
REVOKE ALL ON TABLE "goals"."goals" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
ALTER TABLE "goals"."goals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON TABLE "goals"."goals" TO "authenticated";
--> statement-breakpoint
-- `created_at` is not here: the server's clock writes it and nobody forges it.
GRANT INSERT (id, user_id, name, horizon) ON TABLE "goals"."goals" TO "authenticated";
--> statement-breakpoint
-- The one pair filled after a goal is open, by the first commitment that
-- measures something. The name and the horizon are written once and no grant
-- exists to change them.
GRANT UPDATE (measure_name, measure_unit) ON TABLE "goals"."goals" TO "authenticated";
--> statement-breakpoint
REVOKE ALL ON TABLE "goals"."phases" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
ALTER TABLE "goals"."phases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON TABLE "goals"."phases" TO "authenticated";
--> statement-breakpoint
GRANT INSERT (id, user_id, goal_id, aim, starts_on, ends_on)
  ON TABLE "goals"."phases" TO "authenticated";
--> statement-breakpoint
REVOKE ALL ON TABLE "goals"."commitments" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
ALTER TABLE "goals"."commitments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON TABLE "goals"."commitments" TO "authenticated";
--> statement-breakpoint
-- `retired_at` is not here: a commitment is born live.
GRANT INSERT (id, user_id, goal_id, name, cadence_kind, cadence_n,
              cadence_weekdays, satisfaction, target_quantity, unit,
              source_id, threshold)
  ON TABLE "goals"."commitments" TO "authenticated";
--> statement-breakpoint
-- The only column anyone may ever update, and no DELETE grant beside it: that
-- is what makes "retired, never deleted" a fact of this layer rather than a
-- habit of the query.
GRANT UPDATE (retired_at) ON TABLE "goals"."commitments" TO "authenticated";
--> statement-breakpoint
REVOKE ALL ON TABLE "goals"."one_offs" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
ALTER TABLE "goals"."one_offs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON TABLE "goals"."one_offs" TO "authenticated";
--> statement-breakpoint
GRANT INSERT (id, user_id, goal_id, name, day)
  ON TABLE "goals"."one_offs" TO "authenticated";
--> statement-breakpoint
REVOKE ALL ON TABLE "goals"."facts" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
ALTER TABLE "goals"."facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No UPDATE grant to any role, here or anywhere below. A fact is written once
-- and removed whole: DELETE is how a tap is undone.
GRANT SELECT, DELETE ON TABLE "goals"."facts" TO "authenticated";
--> statement-breakpoint
-- `written_at` is not here: the day is the person's and travels with the
-- insert, the moment is the server's and nobody forges it.
GRANT INSERT (id, user_id, commitment_id, one_off_id, goal_id, day, quantity, note)
  ON TABLE "goals"."facts" TO "authenticated";
--> statement-breakpoint
REVOKE ALL ON TABLE "goals"."evidence_sources" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
-- Configuration, not a person's rows: SELECT and nothing else, and RLS is
-- enabled without FORCE so the catalogue row below still lands as the owner.
GRANT SELECT ON TABLE "goals"."evidence_sources" TO "authenticated";
--> statement-breakpoint
-- The reading dictionary. A second source is one more INSERT like this one,
-- never a migration and never a screen (RNP-10).
INSERT INTO "goals"."evidence_sources" (key, label_key, unit)
  VALUES ('reading_lookups', 'sources.readingLookups', 'searches');
