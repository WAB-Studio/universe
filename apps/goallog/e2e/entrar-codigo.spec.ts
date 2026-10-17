import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Browser, Page } from "@playwright/test";
import { registerOAuthClient } from "@repo/harness-registry";
import postgres from "postgres";

import { test, expect, settled, visit } from "./fixtures";
import { boxOf } from "./box";

// RP-136: after the send, the one sign-in form asks for the six-digit code the mail carries and
// signs the person in with it, on `/entrar` and on the consent signed out. The words are the
// board «EntrarCódigo» (private/tableros/EntrarCodigo*.dc.html), written here as literals: a spec
// that read them from messages/es would agree with whatever the messages say. Every send goes to
// the local inbox (mailpit, :54324) and the code typed is the one read from the mail.

const MAILBOX = "http://127.0.0.1:54324";
const REDIRECT = "http://localhost:6274/oauth/callback";
const signedOut = { cookies: [], origins: [] };
const from = `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::2`;

const W = {
  sentTitle: "Revisa tu correo",
  sentBody: (email: string) => `Te mandamos un código de seis números a ${email}. Vence en una hora.`,
  codeLabel: "Código del correo",
  enter: "Entrar",
  checking: "Comprobando…",
  other: "Usar otro correo",
  link: "También puedes abrir el enlace del correo en este navegador.",
  short: "Escribe los seis números del correo.",
  refused: "Ese código no vale o ya venció.",
  timeout: "No se pudo comprobar el código. Escríbelo otra vez; si no entra, pide otro.",
  rate: "Demasiados intentos. Prueba de nuevo en unos minutos.",
  emailLabel: "Correo electrónico",
  send: "Enviar código",
  lead: "Te mandamos un código a tu correo. Lo escribes aquí y entras; no hay contraseña.",
  consentLead: "Entra primero. Te mandamos un código a tu correo, lo escribes aquí y decides.",
  oldSend: "Enviar enlace",
  oldSentBody: "Te mandamos el enlace a",
};

function invitee(): string {
  return `harness-inv-${randomUUID()}@gmail.com`;
}

// Short enough to fit a 360 column, so an overflow is the layout's, not the address's.
function shortInvitee(): string {
  return `harness-inv-${randomUUID().slice(0, 6)}@gmail.com`;
}

async function listAddress(db: postgres.Sql, email: string) {
  await db`insert into goals.allowed_emails (email) values (${email}) on conflict do nothing`;
}

// The send creates the `auth.users` row: registered under the suite's run so a crash leaves it to
// the teardown, and dropped by exact address here.
async function register(db: postgres.Sql, email: string) {
  const runId = process.env.HARNESS_RUN_ID!;
  await db`
    insert into harness.identities (user_id, run_id, email, disposition)
    select id, ${runId}, email, 'ephemeral' from auth.users where email = ${email}
    on conflict do nothing`;
}

async function forget(db: postgres.Sql, email: string) {
  const ids = await db<{ id: string }[]>`select id from auth.users where email = ${email}`;
  for (const { id } of ids) {
    await db`delete from harness.identities where user_id = ${id}`;
    await db`delete from auth.users where id = ${id}`;
  }
  await db`delete from goals.allowed_emails where email = ${email}`;
}

async function sessionsOf(db: postgres.Sql, email: string): Promise<number> {
  const [{ n }] = await db<{ n: number }[]>`
    select count(*)::int as n from auth.sessions s join auth.users u on u.id = s.user_id where u.email = ${email}`;
  return n;
}

// The six digits as the person reads them in the mail's text part.
async function mailedCode(email: string): Promise<string> {
  let id = "";
  await expect
    .poll(async () => {
      const found = await (await fetch(`${MAILBOX}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      id = found.messages?.[0]?.ID ?? "";
      return id;
    })
    .not.toBe("");
  const message = await (await fetch(`${MAILBOX}/api/v1/message/${id}`)).json();
  // The code stands alone on its line; the link below may hold other digit runs (a client id).
  const alone = /^\s*(\d{6})\s*$/m.exec(`${message.Text}`)?.[1];
  expect(alone, "the mail's text carries the code alone on a line").toBeTruthy();
  expect(message.Subject).toBe(`Tu código para entrar: ${alone}`);
  return alone!;
}

// A Server Action answered by hand, so a timeout or a 429 is drawn without asking Auth for one.
async function answerActions(page: Page, result: { ok: false; error: string }, calls: string[]): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    calls.push(request.url());
    const body = [
      '0:{"a":"$@1","f":"","q":"","i":false,"b":"e2e0000000000000000"}',
      `1:${JSON.stringify(result)}`,
      "",
    ].join("\n");
    await route.fulfill({ status: 200, contentType: "text/x-component", body });
  });
}

async function open(browser: Browser, baseURL: string, viewport = { width: 360, height: 740 }) {
  const context = await browser.newContext({
    baseURL,
    storageState: signedOut,
    viewport,
    hasTouch: viewport.width < 1024,
    extraHTTPHeaders: { "x-forwarded-for": from },
  });
  return { context, page: await context.newPage() };
}

// Types the address and sends; stops at the code step.
async function askForCode(page: Page, db: postgres.Sql, email: string, path = "/entrar", button = W.send) {
  await visit(page, path);
  await page.getByLabel(W.emailLabel).fill(email);
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByRole("heading", { name: W.sentTitle, exact: true })).toBeVisible();
  await register(db, email);
}

// Kills: a landed code that leaves the pending address on the device, so a later sign-out reopens the code step.
async function expectNoPending(page: Page) {
  await expect.poll(() => page.evaluate(() => localStorage.getItem("goallog.pending-sign-in"))).toBeNull();
}

const codeField = (page: Page) => page.getByLabel(W.codeLabel);

let consentPath = "";
test.beforeAll(async ({ baseURL }) => {
  const meta = await fetch(`${baseURL}/.well-known/oauth-protected-resource`);
  const { resource } = (await meta.json()) as { resource: string };
  const registered = await fetch(`${baseURL}/oauth/registro`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify({ client_name: `Claude ${randomBytes(3).toString("hex")}`, redirect_uris: [REDIRECT] }),
  });
  expect(registered.status).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  try {
    await registerOAuthClient(sql, client_id);
  } finally {
    await sql.end();
  }
  consentPath = `/oauth/autorizar?${new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url"),
    code_challenge_method: "S256",
    state: "estado-m7",
    resource,
  }).toString()}`;
});

test("before the send, /entrar and the consent read the code words and «Enviar código»", async ({ browser, baseURL }) => {
  // Kills: the old lead or button («Enviar enlace») left in account.json or oauth.json.
  const { context, page } = await open(browser, baseURL!);
  try {
    await visit(page, "/entrar");
    await expect(page.getByText(W.lead, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: W.send, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: W.oldSend })).toHaveCount(0);

    await visit(page, consentPath);
    await expect(page.getByText(W.consentLead, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: W.send, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: W.oldSend })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Sent: the code step names the address and asks for the code, with the escape and the link line, at 360 without overflow and 44 px controls", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the old sent header kept («Te mandamos el enlace a»), the field missing its numeric /
  // one-time-code / six-character attributes, a control under 44 px, a column that scrolls sideways.
  const email = shortInvitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    await expect(page.getByText(W.sentBody(email), { exact: true })).toBeVisible();
    await expect(page.getByText(W.oldSentBody)).toHaveCount(0);
    await expect(page.getByText(W.link, { exact: true })).toBeVisible();
    const field = codeField(page);
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await expect(field).toHaveAttribute("maxlength", "6");
    await expect(field).toBeFocused();
    const enter = page.getByRole("button", { name: W.enter, exact: true });
    const other = page.getByRole("button", { name: W.other, exact: true });
    await expect(enter).toBeVisible();
    await expect(other).toBeVisible();
    for (const control of [field, enter, other]) {
      expect((await boxOf(control)).height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Incomplete: five digits read the hint on the field, mark it invalid, and no action is posted", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the client parse skipped (the five digits reach Auth), or the hint without aria-invalid.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  const posts: string[] = [];
  try {
    await askForCode(page, db, email);
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) posts.push(request.url());
    });
    await codeField(page).fill("12345");
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page.getByText(W.short, { exact: true })).toBeVisible();
    await expect(codeField(page)).toHaveAttribute("aria-invalid", "true");
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Pending: while the code is checked the button reads «Comprobando…» and is disabled", async ({ browser, baseURL, db }) => {
  // Kills: the pending label dropped, or the button left enabled while the action runs.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => (release = resolveGate));
  try {
    await askForCode(page, db, email);
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        await gate;
        // Never reaches Auth: the held call is answered by hand once released.
        await route.fulfill({
          status: 200,
          contentType: "text/x-component",
          body: [
            '0:{"a":"$@1","f":"","q":"","i":false,"b":"e2e0000000000000000"}',
            `1:${JSON.stringify({ ok: false, error: "codeInvalid" })}`,
            "",
          ].join("\n"),
        });
        return;
      }
      await route.continue();
    });
    await codeField(page).fill("123456");
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    const pending = page.getByRole("button", { name: W.checking, exact: true });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
    release();
    await expect(page.getByText(W.refused, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: W.enter, exact: true })).toBeEnabled();
  } finally {
    release();
    await context.close();
    await forget(db, email);
  }
});

test("Refused: a wrong code reads «Ese código no vale o ya venció.» on the field, keeps what was typed, and signs nobody in", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the field cleared after a refusal, the refusal drawn elsewhere than the field's hint,
  // or the action not asking Auth (a session appears or the real answer is lost).
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    const real = await mailedCode(email);
    const wrong = real === "000000" ? "000001" : "000000";
    await codeField(page).fill(wrong);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page.getByText(W.refused, { exact: true })).toBeVisible();
    await expect(codeField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(codeField(page)).toHaveValue(wrong);
    expect(await sessionsOf(db, email)).toBe(0);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

for (const [name, error, words, other] of [
  ["Timeout", "codeTimeout", W.timeout, W.refused],
  ["Too many", "rateLimited", W.rate, W.refused],
] as const) {
  test(`${name}: a simulated ${error} reads its own words on the field, never the wrong-code ones`, async ({
    browser,
    baseURL,
    db,
  }) => {
    // Kills: ${error} mapped to codeInvalid (or any one message for every refusal).
    const email = invitee();
    await listAddress(db, email);
    const { context, page } = await open(browser, baseURL!);
    try {
      await askForCode(page, db, email);
      const calls: string[] = [];
      await answerActions(page, { ok: false, error }, calls);
      await codeField(page).fill("123456");
      await page.getByRole("button", { name: W.enter, exact: true }).click();
      await expect(page.getByText(words, { exact: true })).toBeVisible();
      await expect(page.getByText(other, { exact: true })).toHaveCount(0);
      await expect(codeField(page)).toHaveAttribute("aria-invalid", "true");
      await expect(codeField(page)).toHaveValue("123456");
      expect(calls).toHaveLength(1);
    } finally {
      await context.close();
      await forget(db, email);
    }
  });
}

test("Done · /entrar: the mailed code, typed, lands on / with a session; the mail is the one the form asked for", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the action not called, called with another code or address, or a landing other than /.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    const code = await mailedCode(email);
    expect(await sessionsOf(db, email)).toBe(0);
    await codeField(page).fill(code);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/$`));
    expect(await sessionsOf(db, email)).toBe(1);
    await expectNoPending(page);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Done · consent: a code typed on the signed-out consent lands back on that consent, query and all", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: `next` dropped from the verify call (the person lands on / instead of the consent).
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  try {
    await askForCode(page, db, email, consentPath, W.send);
    const code = await mailedCode(email);
    await codeField(page).fill(code);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${consentPath}`);
    await expect(page.getByRole("button", { name: "Permitir", exact: true })).toBeVisible();
    expect(await sessionsOf(db, email)).toBe(1);
    await expectNoPending(page);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Cancelled: «Usar otro correo» returns to the form, and a reload does not bring the code step back", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the pending address left on the device after the person chose another address.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    await page.getByRole("button", { name: W.other, exact: true }).click();
    await expect(page.getByLabel(W.emailLabel)).toBeVisible();
    await expect(page.getByRole("heading", { name: W.sentTitle, exact: true })).toHaveCount(0);
    await visit(page, "/entrar");
    await expect(page.getByLabel(W.emailLabel)).toBeVisible();
    await expect(codeField(page)).toHaveCount(0);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Relaunch: a reload within the code's hour reopens the code step for the same address; past the hour it shows the form", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: no pending record kept (the reload shows the form at minute 5), or no expiry check
  // (the code step still stands at minute 61).
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  // Shifts the page's clock by whatever the session says, surviving reloads.
  await context.addInitScript(() => {
    const shift = () => Number(sessionStorage.getItem("__test_clock_shift") ?? 0);
    const RealDate = Date;
    class ShiftedDate extends RealDate {
      constructor(...args: unknown[]) {
        // @ts-expect-error forwarding the spread to the real constructor
        super(...(args.length ? args : [RealDate.now() + shift()]));
      }
      static now() {
        return RealDate.now() + shift();
      }
    }
    // @ts-expect-error replacing the global
    globalThis.Date = ShiftedDate;
  });
  try {
    await askForCode(page, db, email);
    await page.evaluate(() => sessionStorage.setItem("__test_clock_shift", String(5 * 60 * 1000)));
    await page.reload();
    await settled(page);
    await expect(page.getByRole("heading", { name: W.sentTitle, exact: true })).toBeVisible();
    await expect(page.getByText(W.sentBody(email), { exact: true })).toBeVisible();
    await expect(codeField(page)).toBeVisible();

    await page.evaluate(() => sessionStorage.setItem("__test_clock_shift", String(61 * 60 * 1000)));
    await page.reload();
    await settled(page);
    await expect(page.getByLabel(W.emailLabel)).toBeVisible();
    await expect(codeField(page)).toHaveCount(0);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

// RP-136, «EntrarCódigoOtro»: another code to the same address, after a countdown. The words are the
// board's, written as literals.
const R = {
  resend: "Pedir otro código",
  waiting: (seconds: number) => `Pedir otro en ${seconds} s`,
  anyWait: /^Pedir otro en \d+ s$/,
  sending: "Enviando…",
  resent: (email: string) => `Te mandamos otro código a ${email}. Usa el del último correo.`,
};

const RESEND_MS = 60_000;

const resendButton = (page: Page) => page.getByRole("button", { name: /^Pedir otro (código|en \d+ s)$/ });

// Codes of the address, newest first, once at least `count` mails have landed.
async function mailedCodes(email: string, count: number): Promise<string[]> {
  let ids: string[] = [];
  await expect
    .poll(async () => {
      const found = await (await fetch(`${MAILBOX}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      ids = (found.messages ?? []).map((m: { ID: string }) => m.ID);
      return ids.length;
    })
    .toBeGreaterThanOrEqual(count);
  const codes: string[] = [];
  for (const id of ids) {
    const message = await (await fetch(`${MAILBOX}/api/v1/message/${id}`)).json();
    codes.push(/^\s*(\d{6})\s*$/m.exec(`${message.Text}`)?.[1] ?? "");
  }
  return codes;
}

// Fakes the page's clock before any script runs, so the countdown is walked, not waited.
async function openWithClock(browser: Browser, baseURL: string) {
  const opened = await open(browser, baseURL);
  await opened.page.clock.install({ time: Date.now() });
  return opened;
}

function sendPosts(page: Page): { url: string; body: string }[] {
  const posts: { url: string; body: string }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) {
      posts.push({ url: request.url(), body: request.postData() ?? "" });
    }
  });
  return posts;
}

test("Countdown: the button waits 60 s from the send, is ready at +60 s, and a reload at +30 s reads the time left", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the countdown counted from mount (the reload would read 60 again), a wait other than 60 s,
  // or a button enabled before the wait is up.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    const button = resendButton(page);
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(/^Pedir otro en (59|60) s$/);

    await page.clock.fastForward(30_000);
    await page.reload();
    await settled(page);
    await expect(page.getByRole("heading", { name: W.sentTitle, exact: true })).toBeVisible();
    await expect(resendButton(page)).toBeDisabled();
    await expect(resendButton(page)).toHaveText(/^Pedir otro en (29|30) s$/);

    await page.clock.fastForward(29_000);
    await expect(resendButton(page)).toBeDisabled();
    await page.clock.fastForward(2_000);
    await expect(page.getByRole("button", { name: R.resend, exact: true })).toBeEnabled();
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Layout: the resend button sits between the link sentence and «Usar otro correo», at 360 with a 44 px target", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the button drawn above the sentence or below the escape, or a target under 44 px.
  const email = shortInvitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    const sentence = await boxOf(page.getByText(W.link, { exact: true }));
    const resend = await boxOf(resendButton(page));
    const other = await boxOf(page.getByRole("button", { name: W.other, exact: true }));
    expect(resend.y).toBeGreaterThanOrEqual(sentence.y + sentence.height);
    expect(other.y).toBeGreaterThanOrEqual(resend.y + resend.height);
    expect(resend.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Pending: a tap sends once to the stored address; the button reads «Enviando…» and the field, «Entrar» and «Usar otro correo» are disabled", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the button left enabled while the send runs (a second tap posts again), a send to another
  // address, or the other controls left live.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => (release = resolveGate));
  try {
    await askForCode(page, db, email);
    await page.clock.fastForward(RESEND_MS + 1_000);
    const posts = sendPosts(page);
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) await gate;
      await route.continue();
    });
    const ready = page.getByRole("button", { name: R.resend, exact: true });
    await ready.click();
    const pending = page.getByRole("button", { name: R.sending, exact: true });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
    await expect(codeField(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: W.enter, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: W.other, exact: true })).toBeDisabled();
    await pending.click({ force: true }).catch(() => undefined);
    release();
    await expect(page.getByText(R.resent(email), { exact: true })).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toContain(email);
  } finally {
    release();
    await context.close();
    await forget(db, email);
  }
});

test("Done · /entrar: «Te mandamos otro código…», the field emptied and focused, the wait back at 60 s, and the newest mail's code lands on /", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the old code kept in the field, focus lost, no confirmation line, the wait not restarted,
  // or a resend that did not mail a new code.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    const [first] = await mailedCodes(email, 1);
    await codeField(page).fill(first);
    await page.clock.fastForward(RESEND_MS + 1_000);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByText(R.resent(email), { exact: true })).toBeVisible();
    await expect(codeField(page)).toHaveValue("");
    await expect(codeField(page)).toBeFocused();
    await expect(resendButton(page)).toBeDisabled();
    await expect(resendButton(page)).toHaveText(/^Pedir otro en (59|60) s$/);

    const [newest] = await mailedCodes(email, 2);
    await codeField(page).fill(newest);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/$`));
    expect(await sessionsOf(db, email)).toBe(1);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Done · consent: a resend from the signed-out consent keeps `next`; the newest code lands back on the consent", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: `next` dropped from the resend (the newest mail's link or the landing leaves the consent).
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email, consentPath, W.send);
    await page.clock.fastForward(RESEND_MS + 1_000);
    const posts = sendPosts(page);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByText(R.resent(email), { exact: true })).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toContain(email);
    expect(posts[0].body).toContain("estado-m7");
    const [newest] = await mailedCodes(email, 2);
    await codeField(page).fill(newest);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${consentPath}`);
    await expect(page.getByRole("button", { name: "Permitir", exact: true })).toBeVisible();
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Refused: a resend Auth refuses reads «Demasiados intentos…» as an alert under the button, and the button stays ready", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: the countdown restarted on an error, the refusal drawn on the field or not as an alert,
  // or the confirmation line shown for a send that did not happen. The refusal is answered by hand:
  // Auth's own window is not the suite's to wait for.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    await page.clock.fastForward(RESEND_MS + 1_000);
    const calls: string[] = [];
    await answerActions(page, { ok: false, error: "rateLimited" }, calls);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: W.rate })).toBeVisible();
    await expect(page.getByRole("button", { name: R.resend, exact: true })).toBeEnabled();
    await expect(page.getByText(R.resent(email))).toHaveCount(0);
    expect(calls).toHaveLength(1);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Link landing: a marker at or after the record's moment clears it, and /entrar shows the address form", async ({
  browser,
  baseURL,
}) => {
  // Kills: the marker ignored (the code step reopens for an address whose code a landed link spent).
  const { context, page } = await open(browser, baseURL!);
  try {
    await visit(page, "/entrar");
    const at = Date.now();
    await page.evaluate(
      (record) => localStorage.setItem("goallog.pending-sign-in", JSON.stringify(record)),
      { email: "landed@correo.test", at },
    );
    await context.addCookies([{ name: "goallog-signed-in-at", value: String(at + 1_000), url: baseURL! }]);
    await visit(page, "/entrar");
    await expect(page.getByLabel(W.emailLabel)).toBeVisible();
    await expect(codeField(page)).toHaveCount(0);
    await expectNoPending(page);
  } finally {
    await context.close();
  }
});

test("Older marker: a marker before the record's moment leaves the code step standing", async ({ browser, baseURL }) => {
  // Kills: any marker clearing the record, whatever its time.
  const { context, page } = await open(browser, baseURL!);
  try {
    await visit(page, "/entrar");
    const at = Date.now();
    await page.evaluate(
      (record) => localStorage.setItem("goallog.pending-sign-in", JSON.stringify(record)),
      { email: "waiting@correo.test", at },
    );
    await context.addCookies([{ name: "goallog-signed-in-at", value: String(at - 1_000), url: baseURL! }]);
    await visit(page, "/entrar");
    await expect(page.getByRole("heading", { name: W.sentTitle, exact: true })).toBeVisible();
    await expect(page.getByText(W.sentBody("waiting@correo.test"), { exact: true })).toBeVisible();
    await expect(codeField(page)).toBeVisible();
  } finally {
    await context.close();
  }
});

// RP-137, «EntrarSinConexión»: a send, a resend or a check that never reaches the server ends in
// words and leaves every control usable. The words are the board's, written as literals.
const OFFLINE = {
  send: "Sin conexión. No se pudo enviar el código.",
  check: "Sin conexión. No se pudo comprobar el código.",
};

const PENDING_KEY = "goallog.pending-sign-in";
const pendingRaw = (page: Page) => page.evaluate((key) => localStorage.getItem(key), PENDING_KEY);

async function expectCodeStepUsable(page: Page) {
  await expect(codeField(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: W.enter, exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: W.other, exact: true })).toBeEnabled();
}

test("Resend offline: the tap ends in an alert under the button, every control enabled, the button back to «Pedir otro código»", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: no catch in handleResend (the button sticks on «Enviando…» with the controls disabled).
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    await page.clock.fastForward(RESEND_MS + 1_000);
    await context.setOffline(true);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: OFFLINE.send })).toBeVisible();
    await expect(page.getByRole("button", { name: R.sending, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: R.resend, exact: true })).toBeEnabled();
    await expectCodeStepUsable(page);
    await expect(page.getByText(R.resent(email))).toHaveCount(0);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Resend recovers: back online the same button sends, confirms and mails a new code", async ({ browser, baseURL, db }) => {
  // Kills: the failure leaving the resend stuck at sending, so the second tap does nothing.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    await page.clock.fastForward(RESEND_MS + 1_000);
    await context.setOffline(true);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: OFFLINE.send })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByText(R.resent(email), { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: OFFLINE.send })).toHaveCount(0);
    const codes = await mailedCodes(email, 2);
    expect(codes).toHaveLength(2);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Resend failure keeps the wait clock: the pending record and the countdown stay the first send's", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: savePending (or a new `at`) in the failure path, which restarts the 60 s wait for a send that did not happen.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    const before = await pendingRaw(page);
    expect(before).not.toBeNull();
    await page.clock.fastForward(RESEND_MS + 1_000);
    await context.setOffline(true);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: OFFLINE.send })).toBeVisible();
    expect(await pendingRaw(page)).toBe(before);
    await expect(resendButton(page)).toHaveText(R.resend);
    await expect(resendButton(page)).toBeEnabled();
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Resend offline keeps the typed code", async ({ browser, baseURL, db }) => {
  // Kills: the failure path emptying the field as a done resend does.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    await codeField(page).fill("123456");
    await page.clock.fastForward(RESEND_MS + 1_000);
    await context.setOffline(true);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: OFFLINE.send })).toBeVisible();
    await expect(codeField(page)).toHaveValue("123456");
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Send offline: «Enviar código» ends in the field's hint, the button enabled, the address kept", async ({
  browser,
  baseURL,
}) => {
  // Kills: no catch in handleSend (the button sticks on «Enviando…»), or the address cleared.
  const email = invitee();
  const { context, page } = await open(browser, baseURL!);
  try {
    await visit(page, "/entrar");
    await page.getByLabel(W.emailLabel).fill(email);
    await context.setOffline(true);
    await page.getByRole("button", { name: W.send, exact: true }).click();
    await expect(page.getByText(OFFLINE.send, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: W.send, exact: true })).toBeEnabled();
    await expect(page.getByLabel(W.emailLabel)).toHaveValue(email);
    await expect(page.getByRole("heading", { name: W.sentTitle, exact: true })).toHaveCount(0);
    expect(await pendingRaw(page)).toBeNull();
  } finally {
    await context.close();
  }
});

test("Verify offline: «Entrar» ends in the field's hint, the code kept, every control enabled", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: checking left true after the rejection («Comprobando…» for good), or the code cleared.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    await codeField(page).fill("123456");
    await context.setOffline(true);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page.getByText(OFFLINE.check, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: W.checking, exact: true })).toHaveCount(0);
    await expect(codeField(page)).toHaveValue("123456");
    await expectCodeStepUsable(page);
    await expect(page.getByRole("heading", { name: W.sentTitle, exact: true })).toBeVisible();
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Verify offline then online: the same code, sent again, lands on /", async ({ browser, baseURL, db }) => {
  // Kills: the catch swallowing or mis-flagging the landing, or clearing the pending address on a rejection.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await open(browser, baseURL!);
  try {
    await askForCode(page, db, email);
    const code = await mailedCode(email);
    await codeField(page).fill(code);
    await context.setOffline(true);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page.getByText(OFFLINE.check, { exact: true })).toBeVisible();
    expect(await pendingRaw(page)).not.toBeNull();
    await context.setOffline(false);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/$`));
    expect(await sessionsOf(db, email)).toBe(1);
  } finally {
    await context.close();
    await forget(db, email);
  }
});

test("Consent too: a resend offline on the signed-out consent ends in the alert, and the retry online keeps `next`", async ({
  browser,
  baseURL,
  db,
}) => {
  // Kills: `next` dropped from the retry after a failure.
  const email = invitee();
  await listAddress(db, email);
  const { context, page } = await openWithClock(browser, baseURL!);
  try {
    await askForCode(page, db, email, consentPath, W.send);
    await page.clock.fastForward(RESEND_MS + 1_000);
    await context.setOffline(true);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: OFFLINE.send })).toBeVisible();
    await expectCodeStepUsable(page);
    await context.setOffline(false);
    const posts = sendPosts(page);
    await page.getByRole("button", { name: R.resend, exact: true }).click();
    await expect(page.getByText(R.resent(email), { exact: true })).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toContain("estado-m7");
    const [newest] = await mailedCodes(email, 2);
    await codeField(page).fill(newest);
    await page.getByRole("button", { name: W.enter, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${consentPath}`);
  } finally {
    await context.close();
    await forget(db, email);
  }
});
