// Mints a real pulsar session and leaves it standing, for `seed-goal.ts` — a
// second process — to drive under. Unlike `apps/voyager/scripts/harness/
// mint-reader-session.ts`, which this file otherwise copies, nothing here
// drops the identity when it is done: the whole point is a person `seed-
// goal.ts` can still sign in as, and there is nothing here for it to sign in
// with once dropped.
//
// `registerEphemeralIdentity` is not imported: it inserts into `app_users`, a
// finances table a pulsar person has no row in. The run and the
// `harness.identities` insert are composed here instead, by hand, exactly as
// `mint-reader-session.ts` does it.
//
// NOTHING HERE ASKS THE AUTH SERVER TO SEND (`apps/orbit/scripts/harness/
// session.ts`'s own warning, word for word): the address is synthetic and
// undeliverable, and `POST /auth/v1/otp` against one still reaches the
// project's SMTP, whose bounce lands in a real inbox. A token row is landed
// by hand instead, and the real `GET /auth/confirm` — the route a real magic
// link lands on — verifies it.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { openRun } from "@repo/harness-registry";
import postgres from "postgres";

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, {
  prepare: false,
  max: 1,
});

function laneNumber(): number {
  const raw = process.env.HARNESS_LANE?.trim();
  if (!raw) return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`HARNESS_LANE must be a positive integer, not "${raw}"`);
  }
  return Number(raw);
}

const lane = laneNumber();

// `apps/pulsar` on `:320<n-1>` (`scripts/worktree.sh`'s own table). Overridable
// for a lane pointed at someone else's already-running server (`AGENTS.md`,
// "Harness lanes").
function baseUrl(): string {
  return process.env.PULSAR_BASE_URL ?? `http://localhost:${3200 + lane - 1}`;
}

function sessionFile(): string {
  return resolve(process.cwd(), `private/session-${lane}.json`);
}

/**
 * A fresh `auth.users` row and its `harness.identities` row, landed in one
 * transaction so a crash between the two never leaves either without the
 * other. Every column GoTrue's own verify path reads is filled — a null one
 * there is a 500, not a refusal.
 */
async function createIdentity(runId: string): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `harness-pulsar-${id}@example.invalid`;

  await sql.begin(async (tx) => {
    await tx`
      insert into auth.users (
        id, instance_id, aud, role, email, email_confirmed_at,
        encrypted_password, confirmation_token, recovery_token,
        email_change, email_change_token_current, email_change_token_new,
        email_change_confirm_status, phone_change, phone_change_token,
        reauthentication_token, raw_app_meta_data, raw_user_meta_data,
        is_sso_user, is_anonymous, created_at, updated_at)
      values (
        ${id}, '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', ${email}, now(),
        '', '', '',
        '', '', '',
        0, '', '',
        '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        false, false, now(), now())`;

    await tx`
      insert into harness.identities (user_id, run_id, email, disposition)
      values (${id}, ${runId}, ${email}, 'ephemeral')`;
  });

  return { id, email };
}

// Same technique as orbit's `mint-harness-token.ts`: a fresh hash in both
// `auth.users.recovery_token` and a matching `auth.one_time_tokens` row, the
// only pair GoTrue's `verifyOtp` accepts for `type=magiclink`.
async function landRecoveryToken(userId: string, email: string): Promise<string> {
  const hash = randomBytes(32).toString("hex");

  await sql`
    update auth.users
    set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
    where id = ${userId}`;

  await sql`
    insert into auth.one_time_tokens
      (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    values
      (${randomUUID()}, ${userId}, 'recovery_token', ${hash}, ${email}, now(), now())`;

  return hash;
}

type MintedCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

// One `Set-Cookie` line, parsed into the shape Playwright's own storage state
// wants — attributes and all, not just the name/value pair `seed-goal.ts`
// alone would need. This is what lets module 23's browser suite load the same
// file later and skip `/entrar` entirely.
function parseSetCookie(line: string, requestHost: string): MintedCookie {
  const parts = line.split(";").map((part) => part.trim());
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf("=");
  const name = nameValue.slice(0, eq);
  const value = nameValue.slice(eq + 1);

  let domain = requestHost;
  let path = "/";
  let expires = -1;
  let httpOnly = false;
  let secure = false;
  let sameSite: MintedCookie["sameSite"] = "Lax";

  for (const attr of attrs) {
    const [rawKey, rawVal] = attr.split("=");
    const key = rawKey.toLowerCase();
    if (key === "domain" && rawVal) domain = rawVal.replace(/^\./, "");
    else if (key === "path" && rawVal) path = rawVal;
    else if (key === "max-age" && rawVal) expires = Math.floor(Date.now() / 1000) + Number(rawVal);
    else if (key === "expires" && rawVal) expires = Math.floor(new Date(rawVal).getTime() / 1000);
    else if (key === "httponly") httpOnly = true;
    else if (key === "secure") secure = true;
    else if (key === "samesite" && rawVal) {
      const normalized = rawVal.toLowerCase();
      sameSite = normalized === "strict" ? "Strict" : normalized === "none" ? "None" : "Lax";
    }
  }

  return { name, value, domain, path, expires, httpOnly, secure, sameSite };
}

/**
 * The real route, by HTTP: `GET /auth/confirm?token_hash=…&type=magiclink`.
 * `redirect: "manual"` reads the redirect's own headers instead of following
 * it, which is what lets this see `Set-Cookie` before a followed redirect
 * would consume it.
 */
async function redeemToken(hash: string): Promise<MintedCookie[]> {
  const url = baseUrl();
  const response = await fetch(
    `${url}/auth/confirm?token_hash=${hash}&type=magiclink`,
    { redirect: "manual" },
  );

  const location = response.headers.get("location");
  if (!location || location.includes("error=")) {
    throw new Error(`GET /auth/confirm redirected to ${location} — link was refused`);
  }

  const raw = response.headers.getSetCookie();
  if (raw.length === 0) {
    throw new Error(`GET /auth/confirm answered ${response.status} with no Set-Cookie header`);
  }

  const host = new URL(url).hostname;
  return raw.map((line) => parseSetCookie(line, host));
}

function writeStorageState(url: string, cookies: MintedCookie[]): void {
  const file = sessionFile();
  mkdirSync(dirname(file), { recursive: true });
  const state = { cookies, origins: [] };
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`wrote ${file} (${cookies.length} cookie(s), origin ${url})`);
}

async function main(): Promise<void> {
  const runId = await openRun("seed", sql);
  const identity = await createIdentity(runId);

  const hash = await landRecoveryToken(identity.id, identity.email);
  const cookies = await redeemToken(hash);
  writeStorageState(baseUrl(), cookies);

  console.log(`minted a session for ${identity.email} (${identity.id}), lane ${lane}`);
  // Deliberately not closed: the identity has to outlive this process for
  // `seed-goal.ts` to sign in as it, so the run stays open. Its heartbeat
  // stops the moment this process exits, and once it is 30 minutes stale
  // `apps/orbit/scripts/harness/reap.ts` — the one place that owns tearing a
  // run down — takes both the run and the identity it named.
}

void (async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(`FAILED  ${(error as Error).message}`);
    process.exit(1);
  } finally {
    await sql.end();
  }
})();
