import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import type { Page, Request } from "@playwright/test";
import postgres from "postgres";

import { closeRun, openRun } from "@repo/harness-registry";

import messages from "../messages/es.json";
import { expect, test } from "./fixtures";

// RL-73, from Board «CuentaCódigo» and the plan's Done table, not from the
// component. Every action POST is simulated: `sendSignInLink` and
// `verifySignInCode` are told apart by their arguments (`[email]` against
// `[email, code]`). Words are the board's, written here whole.

try {
  process.loadEnvFile(path.join(__dirname, "../.env.local"));
} catch {
  // No .env.local: whatever the shell already exported.
}

const SENT = "Revisa tu correo y escribe aquí el código que te mandamos";
const FIELD = "Código del correo";
const ENTER = "Entrar";
const OTHER = "Usar otro correo";
const LINK_HINT = "También puedes abrir el enlace del correo en este navegador.";
const CHECKING = "Comprobando…";
const SHORT = "Escribe los seis números del correo";
const REFUSED = "Ese código no vale o ya venció";
const OUR_SIDE = "No se pudo comprobar el código. Escríbelo otra vez; si no entra, pide otro.";
const OFFLINE = "Sin conexión. No se pudo comprobar el código.";
const TOO_MANY = "Demasiados intentos. Prueba de nuevo en unos minutos.";

const EMAIL = "reader@example.com";
const CODE = "123456";
const MINUTE = 60_000;

// THE RULE: no test in this file may run the real action. A send that reaches
// it mails a real address and mints an `auth.users` row.
const RULE_MESSAGE =
  "a Server Action POST left the browser with no simulated answer: account-send-code.spec.ts never runs the real actions";

type Result = { ok: true } | { ok: false; error: string };
type SendAnswer = (call: { email: string }) => Promise<Result> | Result;
type VerifyAnswer = (call: { email: string; code: string; request: Request }) => Promise<Result | "abort"> | Result | "abort";

let unsimulated: string[] = [];
let verifyCalls: Array<{ email: string; code: string }> = [];
let sendCalls: string[] = [];

test.beforeEach(async ({ page }) => {
  unsimulated = [];
  verifyCalls = [];
  sendCalls = [];
  await page.route("**/cuenta", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.continue();
      return;
    }
    unsimulated.push(request.url());
    await route.abort();
  });
});

test.afterEach(() => {
  expect(unsimulated, RULE_MESSAGE).toEqual([]);
});

function flight(result: Result): string {
  return ['0:{"a":"$@1","f":"","q":"","i":false,"b":"e2e0000000000000000"}', `1:${JSON.stringify(result)}`, ""].join("\n");
}

async function simulate(
  page: Page,
  verify: VerifyAnswer,
  send: SendAnswer = () => ({ ok: true }),
): Promise<void> {
  await page.route("**/cuenta", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.continue();
      return;
    }
    let args: unknown;
    try {
      args = JSON.parse(request.postData() ?? "");
    } catch {
      args = null;
    }
    if (Array.isArray(args) && args.length === 1 && typeof args[0] === "string") {
      sendCalls.push(args[0]);
      const sent = await send({ email: args[0] });
      await route.fulfill({ status: 200, contentType: "text/x-component", body: flight(sent) });
      return;
    }
    if (Array.isArray(args) && args.length === 2 && typeof args[0] === "string" && typeof args[1] === "string") {
      const call = { email: args[0], code: args[1] };
      verifyCalls.push(call);
      const answer = await verify({ ...call, request });
      if (answer === "abort") {
        await route.abort("internetdisconnected");
        return;
      }
      await route.fulfill({ status: 200, contentType: "text/x-component", body: flight(answer) });
      return;
    }
    unsimulated.push(request.url());
    await route.abort();
  });
}

const field = (page: Page) => page.getByRole("textbox", { name: FIELD });
const emailField = (page: Page) => page.getByRole("textbox", { name: messages.account.emailLabel });

async function askForCode(page: Page, address: string = EMAIL): Promise<void> {
  await page.goto("/cuenta");
  await emailField(page).fill(address);
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();
  await expect(page.getByText(SENT)).toBeVisible();
}

async function enter(page: Page, code: string): Promise<void> {
  await field(page).fill(code);
  await page.getByRole("button", { name: ENTER }).click();
}

// The keys of `localStorage` whose value holds the address: the pending sign-in, whatever it is called.
const keptAddress = (page: Page) =>
  page.evaluate((address) => Object.keys(localStorage).filter((key) => (localStorage.getItem(key) ?? "").includes(address)), EMAIL);

test("after the send the screen asks for the code, with a way back", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await askForCode(page);

  expect(sendCalls).toEqual([EMAIL]);
  await expect(page.getByText(SENT)).toHaveAttribute("role", "status");
  await expect(field(page)).toBeVisible();
  await expect(page.getByRole("button", { name: ENTER })).toBeVisible();
  await expect(page.getByRole("button", { name: OTHER })).toBeVisible();
  // Between «Entrar» and «Usar otro correo», as the board draws it.
  const hint = page.getByText(LINK_HINT);
  await expect(hint).toBeVisible();
  const [enterBox, hintBox, otherBox] = await Promise.all([
    page.getByRole("button", { name: ENTER }).boundingBox(),
    hint.boundingBox(),
    page.getByRole("button", { name: OTHER }).boundingBox(),
  ]);
  expect(hintBox!.y).toBeGreaterThanOrEqual(enterBox!.y + enterBox!.height);
  expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(otherBox!.y);
  // The email form is gone while the code is asked.
  await expect(emailField(page)).toHaveCount(0);
  await expect(field(page)).toHaveAttribute("maxlength", "6");
  await expect(field(page)).toHaveAttribute("inputmode", "numeric");
  await expect(field(page)).toHaveAttribute("autocomplete", "one-time-code");
  await expect(field(page)).toBeFocused();
});

test("a short code is refused on the screen and never asked of the server", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await askForCode(page);

  await enter(page, "12345");

  const line = page.getByText(SHORT);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "alert");
  expect(verifyCalls).toEqual([]);
  await enter(page, "");
  await expect(line).toBeVisible();
  expect(verifyCalls).toEqual([]);
});

test("the verify call carries the address that asked for the code and the six digits", async ({ page }) => {
  await simulate(page, () => ({ ok: false, error: "codeInvalid" }));
  await askForCode(page);

  await enter(page, CODE);
  await expect(page.getByText(REFUSED)).toBeVisible();
  expect(verifyCalls).toEqual([{ email: EMAIL, code: CODE }]);
});

test("while the answer is out the field and the button are locked and say so", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await simulate(page, async () => {
    await held;
    return { ok: false, error: "codeInvalid" };
  });
  await askForCode(page);

  await enter(page, CODE);

  const button = page.getByRole("button", { name: CHECKING });
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(field(page)).toBeDisabled();
  release();
  await expect(page.getByText(REFUSED)).toBeVisible();
  await expect(field(page)).toBeEnabled();
});

test("a code that does not let in says wrong or expired, in an alert, and keeps the code", async ({ page }) => {
  await simulate(page, () => ({ ok: false, error: "codeInvalid" }));
  await askForCode(page);

  await enter(page, CODE);

  const line = page.getByText(REFUSED);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "alert");
  await expect(field(page)).toHaveValue(CODE);
  // The send's own words do not stand in for it.
  await expect(page.getByText(messages.account.errors.sendFailed)).toHaveCount(0);
  await expect(page.getByText(OUR_SIDE)).toHaveCount(0);
});

test("our side not answering says so, not that the code is wrong", async ({ page }) => {
  await simulate(page, () => ({ ok: false, error: "codeTimeout" }));
  await askForCode(page);

  await enter(page, CODE);

  const line = page.getByText(OUR_SIDE);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "alert");
  await expect(page.getByText(REFUSED)).toHaveCount(0);
  await expect(field(page)).toHaveValue(CODE);
});

test("too many tries says to wait", async ({ page }) => {
  await simulate(page, () => ({ ok: false, error: "rateLimited" }));
  await askForCode(page);

  await enter(page, CODE);

  const line = page.getByText(TOO_MANY);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "alert");
  await expect(page.getByText(REFUSED)).toHaveCount(0);
});

test("an answer the screen has no line for still paints an alert", async ({ page }) => {
  await simulate(page, () => ({ ok: false, error: "emailInvalid" }));
  await askForCode(page);

  await enter(page, CODE);

  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(1);
});

test("no network: the button gives up, names the connection, and «Reintentar» sends the same code again", async ({ page }) => {
  let attempts = 0;
  await simulate(page, () => (++attempts === 1 ? "abort" : { ok: true }));
  await askForCode(page);

  await enter(page, CODE);

  await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(REFUSED)).toHaveCount(0);
  await expect(field(page)).toHaveValue(CODE);
  const retry = page.getByRole("button", { name: messages.account.retry });
  await expect(retry).toBeEnabled();

  await retry.click();

  await expect.poll(() => verifyCalls.length).toBe(2);
  expect(verifyCalls[1]).toEqual({ email: EMAIL, code: CODE });
});

test("a request that never settles gives up on the clock", async ({ page }) => {
  await simulate(page, () => new Promise<never>(() => {}));
  await askForCode(page);

  const tappedAt = Date.now();
  await enter(page, CODE);

  await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - tappedAt).toBeGreaterThanOrEqual(7_000);
});

test("a good code refreshes the screen once and forgets the pending address", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await page.goto("/cuenta");
  expect(await keptAddress(page)).toEqual([]);
  await emailField(page).fill(EMAIL);
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();
  await expect(page.getByText(SENT)).toBeVisible();
  expect(await keptAddress(page)).toHaveLength(1);

  const refreshes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/cuenta" && request.url().includes("_rsc")) {
      refreshes.push(request.url());
    }
  });
  await enter(page, CODE);

  await expect.poll(() => refreshes.length).toBe(1);
  await page.waitForTimeout(1_500);
  expect(refreshes).toHaveLength(1);
  expect(verifyCalls).toEqual([{ email: EMAIL, code: CODE }]);
  expect(await keptAddress(page)).toEqual([]);
});

test("a refused code does not refresh the screen", async ({ page }) => {
  await simulate(page, () => ({ ok: false, error: "codeInvalid" }));
  await askForCode(page);
  const refreshes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("_rsc")) refreshes.push(request.url());
  });

  await enter(page, CODE);
  await expect(page.getByText(REFUSED)).toBeVisible();
  await page.waitForTimeout(1_000);

  expect(refreshes).toEqual([]);
});

test("«Usar otro correo» brings the email form back with the address kept and the device forgetting it", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await page.goto("/cuenta");
  expect(await keptAddress(page)).toEqual([]);
  await emailField(page).fill(EMAIL);
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();
  await expect(page.getByText(SENT)).toBeVisible();

  await page.getByRole("button", { name: OTHER }).click();

  await expect(emailField(page)).toHaveValue(EMAIL);
  await expect(field(page)).toHaveCount(0);
  expect(await keptAddress(page)).toEqual([]);
  // A reload does not reopen the step that was left.
  await page.reload();
  await expect(emailField(page)).toBeVisible();
  await expect(field(page)).toHaveCount(0);
});

test("a reload at minute 5 reopens the code step for the same address; at minute 61 it is the email form", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-17T10:00:00Z") });
  await simulate(page, () => ({ ok: false, error: "codeInvalid" }));
  await askForCode(page);

  await page.clock.fastForward(5 * MINUTE);
  await page.reload();
  await expect(page.getByText(SENT)).toBeVisible();
  await expect(field(page)).toBeVisible();
  await enter(page, CODE);
  await expect(page.getByText(REFUSED)).toBeVisible();
  expect(verifyCalls).toEqual([{ email: EMAIL, code: CODE }]);

  await page.clock.fastForward(56 * MINUTE);
  await page.reload();
  await expect(emailField(page)).toBeVisible();
  await expect(field(page)).toHaveCount(0);
});

test("the 360 face has no overflow and every control is at least 44 px tall", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await simulate(page, () => ({ ok: true }));
  await askForCode(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const control of [field(page), page.getByRole("button", { name: ENTER }), page.getByRole("button", { name: OTHER })]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
});

// ---------------------------------------------------------------------------
// RL-73, Board «CuentaCódigo»: Enter submits, the address is named, another
// code after a countdown, and a signed-in reader never sees the step.
// ---------------------------------------------------------------------------

const RESEND = "Pedir otro código";
const RESENDING = "Enviando…";
const waitLabel = (seconds: number) => `Pedir otro en ${seconds} s`;
const RESENT = `Te mandamos otro código a ${EMAIL}. Usa el del último correo.`;
const SEND_RATE_LIMITED = "Demasiados intentos. Prueba de nuevo en unos minutos.";
const SEND_OFFLINE = "Sin conexión. No se pudo enviar el enlace.";
const T0 = new Date("2026-10-17T10:00:00Z");

const resendButton = (page: Page) => page.getByRole("button", { name: /^Pedir otro/ });

// The pending record, whatever key holds it.
const pendingRecord = (page: Page) =>
  page.evaluate((address) => {
    for (const key of Object.keys(localStorage)) {
      const raw = localStorage.getItem(key) ?? "";
      if (raw.includes(address)) return JSON.parse(raw) as { email: string; at: number };
    }
    return null;
  }, EMAIL);

// The page clock is frozen before the send, so «60 s» is exact and only
// `page.clock.runFor` moves the countdown.
async function askForCodeOnFrozenClock(page: Page, send?: SendAnswer, verify?: VerifyAnswer): Promise<void> {
  await page.clock.install({ time: T0 });
  await simulate(page, verify ?? (() => ({ ok: false, error: "codeInvalid" })), send);
  await page.goto("/cuenta");
  await emailField(page).fill(EMAIL);
  await page.clock.pauseAt(new Date(T0.getTime() + 5_000));
  await page.getByRole("button", { name: messages.account.copy.noSessionAction }).click();
  await expect(page.getByText(SENT)).toBeVisible();
}

test("Enter in the code field verifies once, with the typed code", async ({ page }) => {
  await simulate(page, () => ({ ok: false, error: "codeInvalid" }));
  await askForCode(page);

  await field(page).fill(CODE);
  await field(page).press("Enter");

  await expect(page.getByText(REFUSED)).toBeVisible();
  expect(verifyCalls).toEqual([{ email: EMAIL, code: CODE }]);
});

test("Enter with a short code says so on the screen and asks the server nothing", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await askForCode(page);

  await field(page).fill("12");
  await field(page).press("Enter");

  const line = page.getByText(SHORT);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "alert");
  await page.waitForTimeout(500);
  expect(verifyCalls).toEqual([]);
});

test("Enter on «Usar otro correo» leaves the step and verifies nothing", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await askForCode(page);
  await field(page).fill(CODE);

  await page.getByRole("button", { name: OTHER }).focus();
  await page.keyboard.press("Enter");

  await expect(emailField(page)).toBeVisible();
  await expect(field(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(verifyCalls).toEqual([]);
});

test("Enter on a ready resend asks for another code and never verifies the typed one", async ({ page }) => {
  await askForCodeOnFrozenClock(page);
  await field(page).fill(CODE);
  await page.clock.runFor(60_000);
  await expect(resendButton(page)).toHaveText(RESEND);

  await resendButton(page).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText(RESENT)).toBeVisible();
  // Actions run one at a time, so a stray verify would leave after the resend's answer.
  await page.waitForTimeout(500);
  expect(sendCalls).toEqual([EMAIL, EMAIL]);
  expect(verifyCalls).toEqual([]);
});

test("the status line names the address that was typed", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await askForCode(page, "otra.persona@example.org");

  const line = page.getByText(`${SENT} a otra.persona@example.org`);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "status");
  await expect(page.getByText(`${SENT} a ${EMAIL}`)).toHaveCount(0);
});

test("the resend waits sixty seconds from the send: disabled and counting, ready at +60 s", async ({ page }) => {
  await askForCodeOnFrozenClock(page);

  await expect(resendButton(page)).toHaveText(waitLabel(60));
  await expect(resendButton(page)).toBeDisabled();
  await page.clock.runFor(1_000);
  await expect(resendButton(page)).toHaveText(waitLabel(59));
  await page.clock.runFor(58_000);
  await expect(resendButton(page)).toHaveText(waitLabel(1));
  await expect(resendButton(page)).toBeDisabled();
  await page.clock.runFor(1_000);
  await expect(resendButton(page)).toHaveText(RESEND);
  await expect(resendButton(page)).toBeEnabled();
});

test("the countdown counts from the send, not from the mount: a reload at +30 s shows what is left", async ({ page }) => {
  await askForCodeOnFrozenClock(page);

  await page.clock.runFor(30_000);
  await page.reload();

  await expect(page.getByText(SENT)).toBeVisible();
  const label = (await resendButton(page).textContent()) ?? "";
  const left = Number(/en (\d+) s/.exec(label)?.[1]);
  expect(left, label).toBeGreaterThanOrEqual(25);
  expect(left, label).toBeLessThanOrEqual(30);
  await expect(resendButton(page)).toBeDisabled();
});

test("«Usar otro correo» is untouched by the resend: same words, still below the link line", async ({ page }) => {
  await askForCodeOnFrozenClock(page);

  const [hint, resend, other] = await Promise.all([
    page.getByText(LINK_HINT).boundingBox(),
    resendButton(page).boundingBox(),
    page.getByRole("button", { name: OTHER }).boundingBox(),
  ]);
  // Under the muted link line, above «Usar otro correo».
  expect(resend!.y).toBeGreaterThanOrEqual(hint!.y + hint!.height);
  expect(resend!.y + resend!.height).toBeLessThanOrEqual(other!.y);
});

test("while the new code is on its way every control is locked, and a second tap sends nothing", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await askForCodeOnFrozenClock(page, async () => {
    if (sendCalls.length > 1) await held;
    return { ok: true };
  });
  await page.clock.runFor(60_000);

  await resendButton(page).click();

  const pending = page.getByRole("button", { name: RESENDING });
  await expect(pending).toBeVisible();
  await expect(pending).toBeDisabled();
  await expect(page.getByRole("button", { name: ENTER })).toBeDisabled();
  await expect(page.getByRole("button", { name: OTHER })).toBeDisabled();
  await pending.dispatchEvent("click");
  await pending.dispatchEvent("click");
  await page.waitForTimeout(300);
  expect(sendCalls).toEqual([EMAIL, EMAIL]);
  release();
  await expect(page.getByText(RESENT)).toBeVisible();
});

test("a new code sent: the address is named, the field is empty and focused, the wait is back at 60 s", async ({ page }) => {
  await askForCodeOnFrozenClock(page);
  const first = await pendingRecord(page);
  await field(page).fill("987");
  await page.clock.runFor(60_000);

  await resendButton(page).click();

  await expect(page.getByText(RESENT)).toBeVisible();
  expect(sendCalls).toEqual([EMAIL, EMAIL]);
  // A beat of the frozen clock, so a focus deferred to a timer still lands; the wait stays at 60 s.
  await page.clock.runFor(50);
  await expect(field(page)).toHaveValue("");
  await expect(field(page)).toBeFocused();
  await expect(resendButton(page)).toHaveText(waitLabel(60));
  await expect(resendButton(page)).toBeDisabled();
  // The device keeps the new send's moment: a reload counts from it.
  const second = await pendingRecord(page);
  expect(second?.email).toBe(EMAIL);
  expect(second!.at).toBe(first!.at + 60_000);
});

test("a send the server refuses says why in an alert, keeps the code, and does not restart the wait", async ({ page }) => {
  await askForCodeOnFrozenClock(page, ({ email }) =>
    sendCalls.length > 1 ? { ok: false, error: "rateLimited" } : { ok: true },
  );
  const first = await pendingRecord(page);
  await field(page).fill("123");
  await page.clock.runFor(60_000);

  await resendButton(page).click();

  const line = page.getByRole("alert").filter({ hasText: SEND_RATE_LIMITED });
  await expect(line).toBeVisible();
  await expect(page.getByText(RESENT)).toHaveCount(0);
  await expect(resendButton(page)).toHaveText(RESEND);
  await expect(resendButton(page)).toBeEnabled();
  await expect(field(page)).toHaveValue("123");
  expect(await pendingRecord(page)).toEqual(first);
});

const SEND_CAPPED = "Ya pediste varios códigos hoy. Prueba de nuevo mañana.";

test("a resend refused by the daily cap says to come back tomorrow, in an alert, with the button ready", async ({ page }) => {
  await askForCodeOnFrozenClock(page, () => (sendCalls.length > 1 ? { ok: false, error: "capped" } : { ok: true }));
  const first = await pendingRecord(page);
  await field(page).fill("123");
  await page.clock.runFor(60_000);

  await resendButton(page).click();

  const line = page.getByRole("alert").filter({ hasText: SEND_CAPPED });
  await expect(line).toBeVisible();
  await expect(page.getByText("unos minutos")).toHaveCount(0);
  await expect(page.getByText(RESENT)).toHaveCount(0);
  await expect(resendButton(page)).toHaveText(RESEND);
  await expect(resendButton(page)).toBeEnabled();
  await expect(field(page)).toHaveValue("123");
  expect(await pendingRecord(page)).toEqual(first);
});

test("a resend refused by Auth's 429 keeps «unos minutos» and never says «mañana»", async ({ page }) => {
  await askForCodeOnFrozenClock(page, () => (sendCalls.length > 1 ? { ok: false, error: "rateLimited" } : { ok: true }));
  await page.clock.runFor(60_000);

  await resendButton(page).click();

  await expect(page.getByRole("alert").filter({ hasText: SEND_RATE_LIMITED })).toBeVisible();
  await expect(page.getByText("mañana")).toHaveCount(0);
  await expect(resendButton(page)).toBeEnabled();
});

test("a send that never answers gives up as offline, with the glyph, and the button is ready again", async ({ page }) => {
  await askForCodeOnFrozenClock(page, () => (sendCalls.length > 1 ? new Promise<never>(() => {}) : { ok: true }));
  const first = await pendingRecord(page);
  await page.clock.runFor(60_000);

  await resendButton(page).click();
  await expect(page.getByRole("button", { name: RESENDING })).toBeVisible();
  await page.clock.runFor(9_000);

  const line = page.getByRole("alert").filter({ hasText: SEND_OFFLINE });
  await expect(line).toBeVisible();
  await expect(line.locator("xpath=..").locator("svg")).toHaveCount(1);
  await expect(resendButton(page)).toBeEnabled();
  expect(await pendingRecord(page)).toEqual(first);
});

test("a relaunch with nobody signed in reopens the code step for the same address", async ({ page }) => {
  await simulate(page, () => ({ ok: true }));
  await askForCode(page);

  await page.reload();

  await expect(page.getByText(`${SENT} a ${EMAIL}`)).toBeVisible();
  await expect(field(page)).toBeVisible();
  await expect(emailField(page)).toHaveCount(0);
});

// A reader signed in through the harness (a recovery token landed on
// /auth/confirm), never through the form: no address is typed.
async function withSignedInReader(page: Page, body: () => Promise<void>): Promise<void> {
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const id = randomUUID();
  const email = `harness-reader-${id}@example.invalid`;
  try {
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
    const hash = randomBytes(32).toString("hex");
    await sql`
      update auth.users
      set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
      where id = ${id}`;
    await sql`
      insert into auth.one_time_tokens
        (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
      values
        (${randomUUID()}, ${id}, 'recovery_token', ${hash}, ${email}, now(), now())`;
    const response = await page.request.get(`/auth/confirm?token_hash=${hash}&type=magiclink`, { maxRedirects: 0 });
    const location = response.headers()["location"];
    expect(location?.includes("error="), `redirected to ${location ?? "nowhere"}`).toBe(false);
    await body();
  } finally {
    await sql`delete from harness.identities where user_id = ${id}`;
    await sql`delete from auth.users where id = ${id}`;
    await closeRun(sql);
    await sql.end();
  }
}

test("a signed-in reader clears the pending step; after signing out /cuenta asks for the email, not the code", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await simulate(page, () => ({ ok: true }));
  await askForCode(page);
  expect(await keptAddress(page)).toHaveLength(1);
  // The sign-out action (no arguments) is the one POST allowed through.
  await page.route("**/cuenta", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] && request.postData() === "[]") {
      await route.continue();
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/devices", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ devices: [] }) }),
  );

  await withSignedInReader(page, async () => {
    await page.goto("/cuenta");
    await expect(page.getByRole("button", { name: messages.account.signOut })).toBeVisible();
    await expect.poll(() => keptAddress(page)).toEqual([]);

    await page.getByRole("button", { name: messages.account.signOut }).click();
    await expect(page).toHaveURL(/\/registro$/);
    await page.goto("/cuenta");
    await expect(emailField(page)).toBeVisible();
    await expect(field(page)).toHaveCount(0);
    await expect(page.getByText(SENT)).toHaveCount(0);
  });
});
