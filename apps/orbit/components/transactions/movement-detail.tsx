"use client";

import { CheckIcon, ChevronLeftIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { markMovementReviewedAction } from "@/app/actions/recurring-rules";
import { deleteTransactionAction } from "@/app/actions/transactions";
import { MovementDetailDesktop } from "@/components/transactions/movement-detail-desktop";
import {
  MovementForm,
  movementFormDialogWidth,
} from "@/components/transactions/movement-form";
import {
  Badge,
  Box,
  Button,
  Card,
  CategoryTile,
  ConfirmDialog,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Money,
  MovementRow,
  Separator,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import type { MoneyTone } from "@/components/ui";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import type { TransactionListRow } from "@/db/queries/transactions";
import { Link as LocaleLink, useRouter } from "@/i18n/navigation";
import type { CurrencyCode } from "@/lib/currency";
import { civilDateToDate } from "@/lib/dates";
import { deriveRate } from "@/lib/money";
import { foreignSettlementCurrency } from "@/lib/validation/transaction";
import { useActionErrorToast } from "@/lib/use-action-toast";

// A rate is read, not counted with: enough figures to recognise it, whichever
// way round the two currencies are.
const RATE_FORMAT = { maximumSignificantDigits: 6 } as const;

/**
 * One movement's detail (RF-25): the signed amount over its category tile, the
 * account, the date and who recorded it, then its labels and note. Editing
 * reopens the full form so any kind stays reachable, the type still derived from
 * the accounts (RF-18, RF-24); deleting confirms first, since only quick entry
 * carries the undo toast. Money stays integer cents; the sign and the format are
 * display only.
 *
 * What the movement caused rides beside it (RF-132): the charges it produced,
 * each with its own figure, and its cause when it is itself a charge. One hop
 * either way — a cause's own cause is never drawn.
 *
 * From `md` up the two panes of `MovementDetailDesktop` are displayed instead of
 * this column, off the same props and with no read of their own.
 */
export function MovementDetail({
  movement,
  options,
  creatorName,
  cause = null,
  causedCharges = [],
}: {
  movement: TransactionListRow;
  options: TransactionFormOptions;
  creatorName: string | null;
  // The movement this one was caused by, already read by the caller; the picker
  // in the edit form seeds from it too.
  cause?: TransactionListRow | null;
  // The charges this movement caused, newest first, as the caller ordered them.
  causedCharges?: TransactionListRow[];
}) {
  const t = useTranslations("transactions");
  const tKey = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const onActionError = useActionErrorToast();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const remove = useAction(deleteTransactionAction, {
    onSuccess: () => router.push("/movements"),
    onError: onActionError,
  });

  // Confirming stamps `reviewed_at`, dropping the movement from the count, banner
  // and badge (RF-31); the action's refresh re-reads this detail, so the affordance
  // then disappears on its own.
  const confirm = useAction(markMovementReviewedAction, {
    onSuccess: () => toast.success(t("confirmedToast")),
    onError: onActionError,
  });

  // Only a generated movement still awaiting review offers Confirmar; a manual or
  // already-reviewed one shows none.
  const isUnreviewedGenerated =
    movement.recurringRuleId !== null && movement.reviewedAt === null;

  // A name and colour per account and per category id — children included — so
  // the detail reads its subtitle, account and tile without a second lookup.
  const accountNames = new Map(options.accounts.map((a) => [a.id, a.name]));
  const categoryNames = new Map<string, string>();
  const categoryColors = new Map<string, string | null>();
  for (const category of options.categories) {
    categoryNames.set(category.id, category.name);
    categoryColors.set(category.id, category.color);
    for (const child of category.children) {
      categoryNames.set(child.id, child.name);
      categoryColors.set(child.id, child.color);
    }
  }

  const kind = movement.kind;
  const firstSplit = movement.splits[0]?.categoryId;

  const tone: MoneyTone =
    kind === "income" ? "income" : kind === "transfer" ? "transfer" : "expense";

  // The other side of a movement whose account settles elsewhere: the figure it
  // is expected to cost there while a statement is still to come, and the rate
  // the two figures make (RF-122, RF-123).
  const foreign = foreignSettlementCurrency(movement.currency, {
    from: movement.fromSettlementCurrency,
    to: movement.toSettlementCurrency,
  });
  const counterAmountCents = foreign === null ? null : movement.counterAmountCents;
  const rate =
    counterAmountCents === null || foreign === null || movement.amountCents === 0
      ? null
      : deriveRate(
          movement.amountCents,
          movement.currency,
          counterAmountCents,
          foreign,
        );

  // A transfer names no category, so its heading subtitle is the kind word; an
  // income or expense reads its first split's category (RF-19).
  const caption =
    kind === "transfer"
      ? t("kindTransfer")
      : (firstSplit && categoryNames.get(firstSplit)) ||
        (kind === "income" ? t("kindIncome") : t("kindExpense"));
  const tileColor = kind === "transfer" ? null : (firstSplit && categoryColors.get(firstSplit)) ?? null;

  // A transfer reads "origin → destination"; an income names its destination, an
  // expense its source.
  const account =
    kind === "transfer"
      ? `${(movement.fromAccountId && accountNames.get(movement.fromAccountId)) ?? ""} → ${(movement.toAccountId && accountNames.get(movement.toAccountId)) ?? ""}`
      : kind === "income"
        ? (movement.toAccountId && accountNames.get(movement.toAccountId)) ?? ""
        : (movement.fromAccountId && accountNames.get(movement.fromAccountId)) ?? "";

  const date = format.dateTime(civilDateToDate(movement.occurredAt), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // What the movement really cost: itself plus the charges it caused, and only
  // those in its own currency — a charge in another one is listed and totalled
  // on a line of its own, since no figure sums two currencies (RF-124).
  const combinedTotalCents =
    movement.amountCents +
    causedCharges.reduce(
      (sum, charge) =>
        charge.currency === movement.currency ? sum + charge.amountCents : sum,
      0,
    );

  const otherCurrencyTotals = new Map<CurrencyCode, number>();
  for (const charge of causedCharges) {
    if (charge.currency === movement.currency) continue;
    otherCurrencyTotals.set(
      charge.currency,
      (otherCurrencyTotals.get(charge.currency) ?? 0) + charge.amountCents,
    );
  }

  // A row's own words, off the maps this detail already built: what a person
  // wrote, or the category the split names, or the kind.
  function rowTitle(row: TransactionListRow): string {
    if (row.description) return row.description;
    if (row.kind === "transfer") return t("kindTransfer");
    const first = row.splits[0]?.categoryId;
    return (
      (first && categoryNames.get(first)) ||
      (row.kind === "income" ? t("kindIncome") : t("kindExpense"))
    );
  }

  // The union `Money` and `MovementRow` both accept, so one derivation of the
  // kind serves the figure and the row it sits on (RF-18).
  function rowTone(row: TransactionListRow): "income" | "transfer" | "expense" {
    if (row.kind === "income") return "income";
    if (row.kind === "transfer") return "transfer";
    return "expense";
  }

  function rowTile(row: TransactionListRow) {
    const first = row.kind === "transfer" ? null : row.splits[0]?.categoryId;
    return <CategoryTile color={(first && categoryColors.get(first)) ?? null} />;
  }

  function rowDate(row: TransactionListRow): string {
    return format.dateTime(civilDateToDate(row.occurredAt), {
      day: "numeric",
      month: "short",
    });
  }

  return (
    <>
      {/* One movement, two shapes: the panes of the DetalleMovimiento artboard
          from `md` up, where the shell already turns into the sidebar, and this
          single column below. Exactly one is displayed at any width. */}
      <Box display={{ initial: "none", md: "block" }}>
        <MovementDetailDesktop
          movement={movement}
          options={options}
          creatorName={creatorName}
          cause={cause}
          causedCharges={causedCharges}
        />
      </Box>

      <Flex direction="column" gap="4" display={{ initial: "flex", md: "none" }}>
        <Flex align="center" gap="3">
          <IconButton asChild tap variant="ghost" color="gray" aria-label={t("listTitle")}>
            <LocaleLink href="/movements">
              <ChevronLeftIcon size={18} />
            </LocaleLink>
          </IconButton>
          <Heading size="5" style={{ flex: 1 }}>
            {t("detailTitle")}
          </Heading>
        </Flex>

        <Flex direction="column" align="center" gap="2" py="4">
          <CategoryTile color={tileColor} size={60} />
          <Money
            minor={movement.amountCents}
            currency={movement.currency}
            tone={tone}
            size="hero"
          />
          <Text size="3" color="gray">
            {caption}
          </Text>
        </Flex>

        <Card>
          <Flex direction="column">
            <DetailRow label={t("accountLabel")} value={account} />
            {/* Both figures, never one standing for the other, and the rate
                they make between them (RF-122, RF-124). */}
            {counterAmountCents !== null && foreign !== null && (
              <>
                <Separator size="4" my="3" />
                <DetailRow
                  label={t("counterAmountLabel")}
                  value={
                    <Money
                      minor={counterAmountCents}
                      currency={foreign}
                      signed={false}
                      estimate={movement.counterIsEstimate}
                    />
                  }
                />
                {rate !== null && (
                  <>
                    <Separator size="4" my="3" />
                    <DetailRow
                      label={t("rateLabel")}
                      value={`1 ${movement.currency} = ${format.number(rate, RATE_FORMAT)} ${foreign}`}
                    />
                  </>
                )}
              </>
            )}
            <Separator size="4" my="3" />
            <DetailRow label={t("dateLabel")} value={date} />
            {creatorName && (
              <>
                <Separator size="4" my="3" />
                <DetailRow label={t("createdBy")} value={creatorName} />
              </>
            )}
            {movement.labels.length > 0 && (
              <>
                <Separator size="4" my="3" />
                <DetailRow
                  label={t("labels")}
                  value={
                    <Flex gap="2" wrap="wrap" justify="end">
                      {movement.labels.map((label) => (
                        <Badge key={label.id} color="gray" variant="soft" radius="full">
                          {label.name}
                        </Badge>
                      ))}
                    </Flex>
                  }
                />
              </>
            )}
            {movement.description && (
              <>
                <Separator size="4" my="3" />
                <Flex direction="column" gap="1">
                  <Text size="2" color="gray">
                    {t("note")}
                  </Text>
                  <Text size="3">{movement.description}</Text>
                </Flex>
              </>
            )}
          </Flex>
        </Card>

        {/* The movement that produced this one, one hop back and no further
            (RF-132): the card is the link. */}
        {cause && (
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              {t("causeLabel")}
            </Text>
            <Card asChild>
              <LocaleLink href={`/movements/${cause.id}`}>
                <MovementRow
                  tile={rowTile(cause)}
                  title={rowTitle(cause)}
                  subtitle={rowDate(cause)}
                  amount={
                    <Money
                      minor={cause.amountCents}
                      currency={cause.currency}
                      tone={rowTone(cause)}
                    />
                  }
                  tone={rowTone(cause)}
                />
              </LocaleLink>
            </Card>
          </Flex>
        )}

        {/* What this movement cost beyond itself (RF-132), each charge with its
            own figure and the total the same currency makes with it. */}
        {causedCharges.length > 0 && (
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              {t("causedTitle")}
            </Text>
            {causedCharges.map((charge) => (
              <Card key={charge.id} asChild>
                <LocaleLink href={`/movements/${charge.id}`}>
                  <MovementRow
                    tile={rowTile(charge)}
                    title={rowTitle(charge)}
                    subtitle={rowDate(charge)}
                    amount={
                      <Money
                        minor={charge.amountCents}
                        currency={charge.currency}
                        tone={rowTone(charge)}
                      />
                    }
                    tone={rowTone(charge)}
                  />
                </LocaleLink>
              </Card>
            ))}
            <Card>
              <Flex direction="column">
                <DetailRow
                  label={t("causedTotal")}
                  value={
                    <Money
                      minor={combinedTotalCents}
                      currency={movement.currency}
                      tone={tone}
                    />
                  }
                />
                {[...otherCurrencyTotals].map(([code, cents]) => (
                  <Fragment key={code}>
                    <Separator size="4" my="3" />
                    <DetailRow
                      label={t("causedTotalOther", { currency: code })}
                      value={
                        <Money minor={cents} currency={code} signed={false} />
                      }
                    />
                  </Fragment>
                ))}
              </Flex>
            </Card>
          </Flex>
        )}

        {isUnreviewedGenerated && (
          <Button
            type="button"
            size="3"
            disabled={confirm.isPending}
            onClick={() => confirm.execute({ transactionId: movement.id })}
          >
            <CheckIcon size={16} />
            {t("confirm")}
          </Button>
        )}

        <Flex gap="3">
          <Button
            type="button"
            size="3"
            variant="soft"
            color="gray"
            style={{ flex: 1 }}
            onClick={() => setEditOpen(true)}
          >
            <PencilIcon size={16} />
            {t("edit")}
          </Button>
          <Button
            type="button"
            size="3"
            variant="soft"
            color="red"
            style={{ flex: 1 }}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon size={16} />
            {t("delete")}
          </Button>
        </Flex>

        <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
          <Dialog.Content maxWidth={movementFormDialogWidth}>
            {/* The form carries its own heading; the title stays for the a11y tree. */}
            <VisuallyHidden>
              <Dialog.Title>{t("editTitle")}</Dialog.Title>
            </VisuallyHidden>
            {/* Closing unmounts the content, so the form reseeds on each open. */}
            {editOpen && (
              <MovementForm
                mode="edit"
                options={options}
                movement={movement}
                causedByTransactionId={cause?.id ?? null}
                causeOptions={cause ? [cause] : []}
                onDone={() => setEditOpen(false)}
              />
            )}
          </Dialog.Content>
        </Dialog.Root>

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={t("delete")}
          cancelLabel={tKey("common.cancel")}
          pending={remove.isPending}
          onConfirm={() => remove.execute({ transactionId: movement.id })}
        />
      </Flex>
    </>
  );
}

// One label-over-or-beside-value line of the detail card; the value may be text
// or a run of chips.
function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <Flex align="center" justify="between" gap="3">
      <Text size="2" color="gray">
        {label}
      </Text>
      {typeof value === "string" ? (
        <Text size="3" weight="medium" align="right">
          {value}
        </Text>
      ) : (
        value
      )}
    </Flex>
  );
}
