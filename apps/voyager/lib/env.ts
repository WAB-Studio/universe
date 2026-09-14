import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// No privileged Supabase key may reach Postgres here: the server reaches it
// through `DATABASE_URL` and Auth through the publishable key alone. A
// `service_role` key would bypass every RLS policy (RNL-10). The storage
// credential below is the one exception this file grants, and it is scoped
// to Storage alone — an S3 access key, never `service_role` — because it
// never builds a client that touches the `reading` schema.
export const env = createEnv({
  server: {
    // Registering this address with MyMemory raises its free daily quota.
    // Optional so the app builds and runs against MyMemory's anonymous tier
    // with nothing configured at all (RL-09).
    TRANSLATE_MYMEMORY_EMAIL: z.string().email().optional(),
    // A paid MyMemory key, only if volume ever outgrows the free tier.
    TRANSLATE_MYMEMORY_KEY: z.string().min(1).optional(),
    // Supabase transaction pooler (6543), used by the running app.
    DATABASE_URL: z.url(),
    // Supabase session pooler (5432), used by drizzle-kit only.
    MIGRATION_DATABASE_URL: z.url(),
    // RL-41 and RL-42, the word's definition and example sentence. Optional
    // so a build with no key still succeeds; the route degrades to 204.
    OPENAI_API_KEY: z.string().min(1).optional(),
    // The daily ceiling on RL-41/RL-42 model calls, counted in whole calls,
    // never dollars. Optional: unset means the route always answers 204.
    WORD_TEXT_DAILY_CALL_CAP: z.coerce.number().int().positive().optional(),
    // The daily ceiling on RL-36 photos ingested from Openverse. Same shape,
    // same reason.
    WORD_PHOTO_DAILY_CAP: z.coerce.number().int().positive().optional(),
    // The daily ceiling on RL-44/RL-47 calls per caller, keyed by a salted
    // hash of the IP. Optional: unset means 204 for every caller.
    WORD_UNLISTED_DAILY_CLIENT_CAP: z.coerce.number().int().positive().optional(),
    // The daily ceiling on RL-46 phrase-notes model calls. Same shape as
    // WORD_TEXT_DAILY_CALL_CAP.
    PHRASE_NOTES_DAILY_CALL_CAP: z.coerce.number().int().positive().optional(),
    // RL-46's own per-caller ceiling, checked the same way RL-44/RL-47
    // check WORD_UNLISTED_DAILY_CLIENT_CAP — but the counter underneath is
    // shared, not separate: both routes bump the same `reading.client_spend`
    // row for a caller, one row keyed by (day, client) carrying two
    // ceilings. Optional: unset means 204 for every caller, the same switch
    // WORD_UNLISTED_DAILY_CLIENT_CAP already is.
    PHRASE_NOTES_DAILY_CLIENT_CAP: z.coerce.number().int().positive().optional(),
    // Salts the per-caller hash WORD_UNLISTED_DAILY_CLIENT_CAP and
    // PHRASE_NOTES_DAILY_CLIENT_CAP both count against, so the IP itself is
    // never stored.
    CLIENT_KEY_SALT: z.string().min(16).optional(),
    // Supabase Storage's S3-compatible endpoint, region and bucket, and an
    // S3 access key pair scoped to Storage alone (see the file comment
    // above). All four optional together: missing any one, the photo route
    // answers 204 with no upload attempted.
    SUPABASE_STORAGE_S3_ENDPOINT: z.url().optional(),
    SUPABASE_STORAGE_S3_REGION: z.string().min(1).optional(),
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    // The prefix check rejects a pasted privileged key or a legacy JWT at build time.
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .startsWith("sb_publishable_"),
    NEXT_PUBLIC_SITE_URL: z.url(),
  },
  // Client variables are inlined at build time, so they must be spelled out.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
  emptyStringAsUndefined: true,
});
