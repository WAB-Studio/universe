import { defineConfig } from "drizzle-kit";

// Runs outside Next.js, so `lib/env.ts` is unavailable and `process.env` is read directly.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: {
    // Session pooler: DDL and advisory locks need a connection that is not swapped mid-transaction.
    url: process.env.MIGRATION_DATABASE_URL!,
  },
  // `public`, `auth`, orbit's `finances` and voyager's `reading` are not ours to diff.
  schemaFilter: ["goals"],
  casing: "snake_case",
  // Teaches drizzle-kit which roles already exist, so it never emits `create role`.
  entities: { roles: { provider: "supabase" } },
  // A bookkeeping table of its own: this app's migration sequence never
  // competes with orbit's or voyager's for the next `idx`.
  migrations: { schema: "drizzle", table: "__drizzle_migrations_goals" },
});
