/**
 * The read half of RF-132 (module 20): module 14 drew the badge and the two
 * sections, but nothing selected `caused_by_transaction_id` or read the other
 * side, so every one of them stood empty in a real browser. This spec seeds a
 * transfer and a charge caused by it, then drives the ledger and both detail
 * panes rather than trusting the migration or a fixture.
 *
 * It also drives the data-loss risk the module named directly: editing the
 * charge from the ledger's row menu and from its own desktop pane, in each
 * case through a field that never touches the cause, must leave it standing.
 */
import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";

import messages from "@/messages/es.json";
import { TIME_ZONE } from "@/lib/locales";

import { fixtureSql } from "../scripts/harness/fixtures";
import { asHarnessUser, clearLedger, readScope, test } from "./global-setup";

const transactions = messages.transactions;
const common = messages.common;
const scope = readScope();

const chargeCategoryId = randomUUID();
const chargeCategoryName = `Cobro ${randomUUID().slice(0, 8)}`;
const secondAccountId = randomUUID();

// COP shows no decimals (per the dollar-conversion spec's own convention), so
// both figures stay whole pesos — a charge that carried centavos would round
// away from under the digit-stripped comparison below.
const TRANSFER_CENTS = 29_866_400;
const CHARGE_CENTS = 119_400;
const COMBINED_CENTS = TRANSFER_CENTS + CHARGE_CENTS;

const TRANSFER_DESCRIPTION = `Harness transferencia ${randomUUID().slice(0, 8)}`;
const CHARGE_DESCRIPTION = `Harness comisión ${randomUUID().slice(0, 8)}`;

let transferId = "";
let chargeId = "";

test.beforeEach(async () => {
  await clearLedger();

  await asHarnessUser(async (tx) => {
    await tx`
      insert into categories (id, owner_user_id, name, kind, color)
      values (${chargeCategoryId}, ${scope.userId}, ${chargeCategoryName}, 'expense', '#B54708')`;

    await tx`
      insert into accounts (
        id, owner_user_id, name, kind, subtype, initial_balance_cents, initial_balance_on)
      values (
        ${secondAccountId}, ${scope.userId}, 'Harness cuenta destino', 'asset', 'bancaria',
        0, (now() at time zone ${TIME_ZONE})::date)`;

    const [transfer] = await tx<{ id: string }[]>`
      insert into transactions (from_account_id, to_account_id, amount_cents, occurred_at, description)
      values (
        ${scope.accountId}, ${secondAccountId}, ${TRANSFER_CENTS},
        (now() at time zone ${TIME_ZONE})::date, ${TRANSFER_DESCRIPTION})
      returning id`;
    transferId = transfer.id;

    const [charge] = await tx<{ id: string }[]>`
      insert into transactions (
        from_account_id, amount_cents, occurred_at, description, caused_by_transaction_id)
      values (
        ${scope.accountId}, ${CHARGE_CENTS},
        (now() at time zone ${TIME_ZONE})::date, ${CHARGE_DESCRIPTION}, ${transferId})
      returning id`;
    chargeId = charge.id;
    await tx`
      insert into transaction_splits (transaction_id, category_id, amount_cents)
      values (${chargeId}, ${chargeCategoryId}, ${CHARGE_CENTS})`;
  });
});

test.afterEach(async () => {
  await clearLedger();
  await fixtureSql`delete from accounts where id = ${secondAccountId}`;
  await fixtureSql`delete from categories where id = ${chargeCategoryId}`;
});

test("the charge marks the ledger and both details link the two, with the combined total", async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === "desktop";

  await page.goto("/es/movements");

  // The badge is a ledger-card marker (RF-132): module 14 drew it into
  // `MovementRow`, which only the phone/tablet cards render, never the dense
  // table — so this half of the assertion is the phone's alone. A phone card
  // is titled by its category (or the kind word, for a transfer), never by
  // the description the desktop column reads.
  if (!desktop) {
    const chargeCard = page.getByRole("link", { name: chargeCategoryName });
    await expect(chargeCard).toContainText(transactions.causedBadge);
    const transferCard = page.getByRole("link", { name: transactions.kindTransfer });
    await expect(transferCard).not.toContainText(transactions.causedBadge);
  }

  // The transfer's detail lists what it caused and the total the two make
  // together — `getByRole` alone already picks the width this project draws,
  // since the other shape's subtree carries `display: none` (RF-132).
  await page.goto(`/es/movements/${transferId}`);
  await expect(page.getByRole("link", { name: CHARGE_DESCRIPTION })).toBeVisible();
  const causedTotalRow = page
    .getByText(transactions.causedTotal, { exact: true })
    .locator("..")
    .filter({ visible: true });
  await expect(causedTotalRow).toHaveCount(1);
  expect((await causedTotalRow.innerText()).replace(/\D/g, "")).toBe(
    String(COMBINED_CENTS / 100),
  );

  // The charge's own detail names its cause, one hop back (RF-132).
  await page.goto(`/es/movements/${chargeId}`);
  await expect(page.getByRole("link", { name: TRANSFER_DESCRIPTION })).toBeVisible();
});

test("editing the charge from the ledger's row menu leaves its cause intact (D12, RF-132)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the row menu is the laptop's");

  await page.goto("/es/movements");
  await page
    .getByRole("button", {
      name: common.actionsFor.replace("{name}", CHARGE_DESCRIPTION),
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: transactions.edit, exact: true }).click();

  // The picker seeds from what the movement already names — an edit that never
  // opens it must still resend the value, but the form only offers to touch it
  // at all if it can show what is already chosen.
  const causePicker = page.getByLabel(transactions.causeField);
  await expect(causePicker).toContainText(TRANSFER_DESCRIPTION);

  // A field the picker has nothing to do with: proof the cause survives an
  // edit that never mentions it.
  await page.getByLabel(transactions.amountLabel, { exact: true }).fill("50000");
  await page
    .locator("form")
    .getByRole("button", { name: transactions.saveMovement, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto(`/es/movements/${chargeId}`);
  await expect(page.getByRole("link", { name: TRANSFER_DESCRIPTION })).toBeVisible();
});

test("editing the charge from its own desktop pane leaves its cause intact (RF-132)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "MovementDetailDesktop is the laptop's pane");

  await page.goto(`/es/movements/${chargeId}`);
  await page.getByRole("button", { name: transactions.edit, exact: true }).click();

  const causePicker = page.getByLabel(transactions.causeField);
  await expect(causePicker).toContainText(TRANSFER_DESCRIPTION);

  await page.getByLabel(transactions.amountLabel, { exact: true }).fill("60000");
  await page
    .locator("form")
    .getByRole("button", { name: transactions.saveMovement, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("link", { name: TRANSFER_DESCRIPTION })).toBeVisible();
});
