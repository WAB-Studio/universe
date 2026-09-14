CREATE TABLE "reading"."word_answers" (
	"word" text PRIMARY KEY NOT NULL,
	"lemma" text,
	"rule" text,
	"translations" text[] NOT NULL,
	"definition" text,
	"example_en" text NOT NULL,
	"example_es" text NOT NULL,
	"model" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading"."phrase_notes" (
	"phrase_hash" text PRIMARY KEY NOT NULL,
	"notes" jsonb NOT NULL,
	"model" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading"."client_spend" (
	"day" date NOT NULL,
	"client" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "client_spend_day_client_pk" PRIMARY KEY("day","client"),
	CONSTRAINT "client_spend_calls_non_negative" CHECK ("reading"."client_spend"."calls" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reading"."word_texts" ADD COLUMN "translations" text[];--> statement-breakpoint
ALTER TABLE "reading"."word_texts" ADD COLUMN "translations_asked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Not a reader's record: RLS on, zero policies. Only db/client.ts's owner
-- role touches these three, and Supabase auto-grants at CREATE TABLE
-- regardless of 0000's default-privilege revoke, so each still needs its own.
ALTER TABLE "reading"."word_answers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reading"."phrase_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reading"."client_spend" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "reading"."word_answers" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
REVOKE ALL ON TABLE "reading"."phrase_notes" FROM "anon", "authenticated", "service_role";
--> statement-breakpoint
REVOKE ALL ON TABLE "reading"."client_spend" FROM "anon", "authenticated", "service_role";