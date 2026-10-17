import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

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

// «Revisa tu correo…» now names the address the code went to (RL-73, Board «CuentaCódigo»).
const SENT_TO_READER = "Revisa tu correo y escribe aquí el código que te mandamos a reader@example.com";

// THE RULE: no test in this file may run the real `sendSignInLink`. The guard
// in `app/actions/account.ts` fails open on a DNS error, so a send that
// reaches it on a machine without DNS mails a real address and mints an
// `auth.users` row. Every action POST goes through the route below unless a
// test installed its own (the latest-registered route wins), and one that
// slips through is aborted before it leaves the browser and fails the test.
const RULE_MESSAGE =
  "sendSignInLink POST left the browser with no simulated answer: account-send-link.spec.ts never runs the real action";

let unsimulatedPosts: string[] = [];

test.beforeEach(async ({ page }) => {
  unsimulatedPosts = [];
  await page.route("**/cuenta", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.continue();
      return;
    }
    unsimulatedPosts.push(request.url());
    await route.abort();
  });
});

test.afterEach(() => {
  expect(unsimulatedPosts, RULE_MESSAGE).toEqual([]);
});

async function submit(page: Page, email: string): Promise<void> {
  await page.goto("/cuenta");
  await page.getByRole("textbox", { name: messages.account.emailLabel }).fill(email);
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();
}

// Waits for the browser to report the action POST as failed. A POST that
// reached a server would answer instead, so only an abort lands here.
function nextActionPostFailure(page: Page): Promise<{ hasResponse: boolean }> {
  return new Promise((resolve) => {
    page.on("requestfailed", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) {
        void request.response().then((response) => resolve({ hasResponse: response !== null }));
      }
    });
  });
}

// The abort itself, observed from the browser and apart from the guard's
// bookkeeping. The address has no `@`, so even with the abort removed the
// real action would refuse it before any DNS or Supabase call, no request
// would fail, and this test would time out red.
test("the guard aborts an action POST that has no simulated answer", async ({ page }) => {
  const failure = nextActionPostFailure(page);
  await submit(page, "sentinel-no-at-sign");

  expect(await failure).toEqual({ hasResponse: false });
  expect(unsimulatedPosts).toHaveLength(1);
  // Consumed: `afterEach` would otherwise fail this test for the very POST it asserts.
  unsimulatedPosts = [];
});

// Fails by design (`test.fail`): nothing in the body asserts, so only
// `afterEach` can fail it. If that check goes, this test turns red.
test("a test that lets the action POST out unsimulated fails", async ({ page }) => {
  test.fail();
  const failure = nextActionPostFailure(page);
  await submit(page, "sentinel-no-at-sign");
  await failure;
});

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

test("an invalid-email answer keeps its own copy", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "emailInvalid" });
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

  await expect(page.getByText(SENT_TO_READER)).toBeVisible();
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
  await expect(page.getByText(SENT_TO_READER)).toBeVisible({ timeout: 2_000 });
});

// The dead-domain screen is driven with the action's answer simulated: the
// real action would resolve DNS and, where DNS fails, send for real. The
// guard itself is proved by calling `isDomainDeliverable` directly, below.
//
// NEVER disable that guard while any test here submits the form. It is the
// only thing between a send and a live Supabase: it mints an `auth.users` row
// and mails the user's own Gmail, which bounces back to their inbox. It
// happened on 2026-09-10.
test("a dead-domain answer paints its own copy, and neither of the other two", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "domainUndeliverable" });
  await submit(page, "reader@example.com");

  await expect(page.getByText(messages.account.errors.domainUndeliverable)).toBeVisible();
  await expect(page.getByText(messages.account.errors.sendFailed)).toHaveCount(0);
  await expect(page.getByText(messages.account.errors.rateLimited)).toHaveCount(0);
});

// RL-69: an address off the invitation list is refused before any email is
// sent. The answer is simulated like every send in this file.
test("a not-invited answer paints its own line under the kept address, and no other error", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "notInvited" });
  const email = "reader@example.com";
  await submit(page, email);

  await expect(page.getByText("Este correo no tiene invitación a WordBook.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: messages.account.emailLabel })).toHaveValue(email);
  for (const key of ["sendFailed", "rateLimited", "emailInvalid", "domainUndeliverable", "offline"] as const) {
    await expect(page.getByText(messages.account.errors[key], { exact: true })).toHaveCount(0);
  }
});

// RL-74, Board «CuentaTopeDiario»: WordBook's own daily cap says «mañana»;
// Auth's 429 keeps «unos minutos». Words written whole from the board.
const CAPPED = "Ya pediste varios códigos hoy. Prueba de nuevo mañana.";
const AUTH_429 = "Demasiados intentos. Prueba de nuevo en unos minutos.";

test("the daily cap says to come back tomorrow, in an alert, and never «unos minutos»", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "capped" });
  const email = "reader@example.com";
  await submit(page, email);

  const line = page.getByText(CAPPED, { exact: true });
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "alert");
  await expect(page.getByText("unos minutos")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: messages.account.emailLabel })).toHaveValue(email);
  await expect(page.getByRole("button", { name: messages.account.copy.noSessionAction })).toBeEnabled();
});

test("Auth's 429 on the form keeps «unos minutos» and never says «mañana»", async ({ page }) => {
  await mockSendSignInLinkResult(page, { ok: false, error: "rateLimited" });
  await submit(page, "reader@example.com");

  await expect(page.getByText(AUTH_429, { exact: true })).toBeVisible();
  await expect(page.getByText("mañana")).toHaveCount(0);
});

// A refusal the screen paints reads as words, never as the missing key's path.
for (const [error, words] of [
  ["capped", CAPPED],
  ["rateLimited", AUTH_429],
  ["sendFailed", messages.account.errors.sendFailed],
  ["emailInvalid", messages.account.errors.emailInvalid],
  ["domainUndeliverable", messages.account.errors.domainUndeliverable],
  ["notInvited", "Este correo no tiene invitación a WordBook."],
] as const) {
  test(`every refusal paints its own words in one alert: ${error}`, async ({ page }) => {
    await mockSendSignInLinkResult(page, { ok: false, error });
    await submit(page, "reader@example.com");

    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveText(words);
  });
}
