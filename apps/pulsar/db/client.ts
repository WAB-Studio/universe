import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { env } from "@/lib/env";

// `globalThis` survives a dev hot reload; without it every edit leaks a pool.
const globalForDb = globalThis as unknown as {
  sql: ReturnType<typeof postgres> | undefined;
};

const sql =
  globalForDb.sql ??
  postgres(env.DATABASE_URL, {
    // Supavisor's transaction mode rejects named prepared statements.
    prepare: false,
    // Above one: a day's screen fans its queries out with `Promise.all`, and a
    // single connection turns them back into a queue (RNP-03).
    max: 8,
    // Seconds. postgres@3 defaults to null and would hold the socket forever.
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });
