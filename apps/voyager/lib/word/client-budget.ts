import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { env } from "@/lib/env";

// A budget nobody can charge is a budget that does not exist: with no salt
// configured, every caller reads `null` and the route above answers 204 —
// the same switch `WORD_TEXT_DAILY_CALL_CAP` already is for RL-41/RL-42. The
// address itself is hashed away in the same step and never returned.
export function clientKey(request: Request): string | null {
  if (!env.CLIENT_KEY_SALT) return null;
  const forwardedFor = request.headers.get("x-forwarded-for");
  const address = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
  if (!address) return null;
  return createHash("sha256").update(`${env.CLIENT_KEY_SALT}:${address}`).digest("hex");
}

/**
 * The per-caller half of RL-44/RL-47's budget, on top of `claimDailyCall`'s
 * global one (`lib/word/spend.ts`). One statement: insert-or-bump, returning
 * the day's total for this client in the same round trip the caller compares
 * against `WORD_UNLISTED_DAILY_CLIENT_CAP`.
 */
export async function claimClientCall(client: string): Promise<number> {
  const [row] = await db.execute<{ calls: number }>(sql`
    insert into reading.client_spend as cs (day, client, calls)
    values (current_date, ${client}, 1)
    on conflict (day, client) do update set calls = cs.calls + 1
    returning cs.calls
  `);
  return row.calls;
}
