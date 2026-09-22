import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// No privileged Supabase key may reach Postgres here: the server reaches it
// through `DATABASE_URL` and Auth through the publishable key alone. A
// `service_role` key would bypass every RLS policy.
export const env = createEnv({
  server: {
    // Supabase transaction pooler (6543), used by the running app.
    DATABASE_URL: z.url(),
    // Supabase session pooler (5432), used by drizzle-kit only.
    MIGRATION_DATABASE_URL: z.url(),
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
