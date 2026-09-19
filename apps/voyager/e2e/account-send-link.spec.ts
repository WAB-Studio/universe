import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import { isDomainDeliverable } from "../app/actions/account";
import messages from "../messages/es.json";

// `sendSignInLink` (app/actions/account.ts) is a Server Action: the browser
// calls it over a POST to the current page with a `next-action` header, and
// gets back a Flight-encoded return value — not a plain fetch a route handler
// answers. Faking that second line is what lets this suite drive a 429 (and
// a generic failure) without ever asking Supabase for a real one, which
// would spend the address's real send quota (RL-22's own action already
// logs and classifies the real thing; this proves what the reader sees for
// each of the three outcomes `SignedOutForm` can render).
async function mockSendSignInLinkResult(page: Page, result: { ok: true } | { ok: false; error: string }): Promise<void> {
  await page.route("**/cuenta", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const body = [
      '0:{"a":"$@1","f":"","q":"","i":false,"b":"e2e0000000000000000"}',
      `1:${JSON.stringify(result)}`,
      "",
    ].join("\n");
    await route.fulfill({ status: 200, contentType: "text/x-component", body });
  });
}

async function submit(page: Page, email: string): Promise<void> {
  await page.goto("/cuenta");
  await page.getByRole("textbox", { name: messages.account.emailLabel }).fill(email);
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();
}

test("a 429 asking for the link says to wait, not the generic failure", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "rateLimited" });
  await submit(page, "reader@example.com");

  await expect(page.getByText(messages.account.errors.rateLimited)).toBeVisible();
  await expect(page.getByText(messages.account.errors.sendFailed)).toHaveCount(0);
});

test("a non-429 failure still says the generic 'could not send', not the rate-limit copy", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "sendFailed" });
  await submit(page, "reader@example.com");

  await expect(page.getByText(messages.account.errors.sendFailed)).toBeVisible();
  await expect(page.getByText(messages.account.errors.rateLimited)).toHaveCount(0);
});

test("an invalid email keeps its own copy, no mock involved", async ({ page }) => {
  // No route mock here: `sendSignInLink`'s zod check rejects before any
  // Supabase call, so this exercises the real action.
  await submit(page, "not-an-email");

  await expect(page.getByText(messages.account.errors.emailInvalid)).toBeVisible();
  await expect(page.getByText(messages.account.errors.rateLimited)).toHaveCount(0);
});

// Driven on a production build, `context.setOffline(true)` does not hang
// this POST — it rejects it at once, `TypeError: Failed to fetch`, which
// `route.abort("internetdisconnected")` reproduces exactly (same Chromium
// network error) with no request ever reaching the real network.
async function abortSendSignInLink(page: Page): Promise<void> {
  await page.route("**/cuenta", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.abort("internetdisconnected");
  });
}

test("no network: the button gives up, names the connection, keeps the email, and a retry sends", async ({
  page,
  context,
}) => {
  // Loaded and filled while still online: the defect this proves is the
  // send itself failing, never the page load.
  const email = "reader@example.com";
  await page.goto("/cuenta");
  const emailField = page.getByRole("textbox", { name: messages.account.emailLabel });
  await emailField.fill(email);

  await abortSendSignInLink(page);
  // Belt and braces: the route above already keeps the request from
  // leaving the browser, and this names the real defect it stands in for.
  await context.setOffline(true);

  const tappedAt = Date.now();
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();

  await expect(page.getByText(messages.account.errors.offline, { exact: true })).toBeVisible({ timeout: 15_000 });
  console.log(`account-send-link offline: failure line after ${Date.now() - tappedAt}ms`);

  // Three states, not two: neither of the other two lines shows instead.
  // Exact match: the offline line's own text contains `sendFailed`'s whole
  // string, so a substring search would find it inside the right line.
  await expect(page.getByText(messages.account.errors.sendFailed, { exact: true })).toHaveCount(0);
  await expect(page.getByText(messages.account.errors.rateLimited, { exact: true })).toHaveCount(0);

  // Nobody retypes it, and the button is pulsable again under its own name.
  await expect(emailField).toHaveValue(email);
  const retryButton = page.getByRole("button", { name: messages.account.retry });
  await expect(retryButton).toBeEnabled();

  // The rejected first request already settled Next's own action queue
  // (RL-22 dispatches Server Actions one at a time per client) — the most
  // recently registered route wins from here (Playwright's own rule), so
  // the retry's fresh POST answers `ok: true` clean.
  await mockSendSignInLinkResult(page, { ok: true });
  await context.setOffline(false);
  await retryButton.click();

  await expect(page.getByText(messages.account.sent)).toBeVisible();
});

// The clock in `SEND_LINK_TIMEOUT_MS` is the second line of defence, for a
// request that truly never settles rather than failing fast — a shape
// `route.abort` above cannot produce. This proves only that the failure
// line still shows up in that case; a request genuinely stuck forever also
// stalls Next's own action queue behind it, so this does not claim retry.
test("a request that never settles still gives up, on the clock rather than the rejection", async ({ page }) => {
  await page.route("**/cuenta", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await new Promise(() => {});
  });

  const email = "reader@example.com";
  await page.goto("/cuenta");
  await page.getByRole("textbox", { name: messages.account.emailLabel }).fill(email);

  const tappedAt = Date.now();
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();

  await expect(page.getByText(messages.account.errors.offline, { exact: true })).toBeVisible({ timeout: 15_000 });
  console.log(`account-send-link never-settles: failure line after ${Date.now() - tappedAt}ms`);
});

test("on a real connection the happy path is unchanged: no wait for the offline clock", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: true });
  await submit(page, "reader@example.com");

  // Well inside `SEND_LINK_TIMEOUT_MS`: a working request must never wait on
  // the offline clock to answer.
  await expect(page.getByText(messages.account.sent)).toBeVisible({ timeout: 2_000 });
});

// From here down: `example.com` (RFC 7505 §6 gives it as the null-MX
// example, and a live lookup confirms it: `[{"exchange":"","priority":0}]`)
// and a domain guaranteed never to exist. No `page.route` mock on either —
// the real action has to reject them itself, before it ever reaches
// Supabase. `sendFailed`/`rateLimited` only come back from a Supabase error,
// so seeing neither, alongside the new copy, is the proof the call never
// went out — the only branch that returns `domainUndeliverable` is the one
// before `signInWithOtp`.
//
// NEVER disable that guard while these two run. They submit the real form to
// the real Supabase, and the guard is the only thing standing between them
// and a live send: it mints an `auth.users` row and mails the user's own
// Gmail, which bounces back to their inbox. It happened on 2026-09-10 —
// these exact two addresses, mutated to prove the guard bites. Prove it by
// calling `isDomainDeliverable` directly, the way the tests below already do.
test("a domain with a null MX (RFC 7505) is rejected on-screen, never reaching Supabase", async ({ page }) => {
  await submit(page, "lector.prueba@example.com");

  await expect(page.getByText(messages.account.errors.domainUndeliverable)).toBeVisible();
  await expect(page.getByText(messages.account.errors.sendFailed)).toHaveCount(0);
  await expect(page.getByText(messages.account.errors.rateLimited)).toHaveCount(0);
});

test("a domain with no DNS records at all is rejected the same way", async ({ page }) => {
  await submit(page, "reader@asdkjhqwe-no-existe-1234.com");

  await expect(page.getByText(messages.account.errors.domainUndeliverable)).toBeVisible();
  await expect(page.getByText(messages.account.errors.sendFailed)).toHaveCount(0);
});

// The acceptance path is proved against `isDomainDeliverable` directly, not
// through `submit`: calling the action for a domain the check lets through
// would ask Supabase for a real send, spending the project's send quota and
// (for an address Supabase has never seen) leaving a row in `auth.users`.
test("a domain with no MX but an A record is deliverable (RFC 5321 §5.1's implicit MX)", async () => {
  // GitHub's raw-content host: publishes A/AAAA, no MX (confirmed live,
  // 2026-09-10 — `dns.resolveMx` answers `ENODATA`).
  await expect(isDomainDeliverable("raw.githubusercontent.com")).resolves.toBe(true);
});

test("an ordinary domain with a real MX is deliverable", async () => {
  await expect(isDomainDeliverable("gmail.com")).resolves.toBe(true);
});

test("a resolver error that is not 'no such record' fails open", async () => {
  const brokenResolvers = {
    resolveMx: () => Promise.reject(Object.assign(new Error("queryMx ESERVFAIL"), { code: "ESERVFAIL" })),
    resolve4: () => Promise.reject(Object.assign(new Error("queryA ESERVFAIL"), { code: "ESERVFAIL" })),
    resolve6: () => Promise.reject(Object.assign(new Error("queryAaaa ESERVFAIL"), { code: "ESERVFAIL" })),
  };

  await expect(isDomainDeliverable("broken-resolver.invalid", brokenResolvers)).resolves.toBe(true);
});

test("a resolver that never answers still gives an answer, on its own clock", async () => {
  const hangingResolvers = {
    resolveMx: () => new Promise<never>(() => {}),
    resolve4: () => new Promise<never>(() => {}),
    resolve6: () => new Promise<never>(() => {}),
  };

  const startedAt = Date.now();
  const result = await isDomainDeliverable("never-answers.invalid", hangingResolvers);
  const elapsedMs = Date.now() - startedAt;
  console.log(`isDomainDeliverable hanging resolver: answered after ${elapsedMs}ms`);

  expect(result).toBe(true);
  // Bounded by its own timeout, not by the resolver's silence, and still
  // under `SEND_LINK_TIMEOUT_MS` (8s). The margin over `DNS_TIMEOUT_MS`
  // (2.5s) is event-loop delay, not the check waiting: with three suites on
  // this machine the same call answered after 5290ms (2026-09-14).
  expect(elapsedMs).toBeLessThan(7_000);
});
