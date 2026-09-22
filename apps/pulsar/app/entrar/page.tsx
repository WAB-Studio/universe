"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { sendSignInLink, type SendSignInLinkResult } from "@/app/actions/account";
import { Button, Field, Page, Separator, Text } from "@/components/ui";

type SendError = Extract<SendSignInLinkResult, { ok: false }>["error"];

type FormState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; error: SendError };

// The two ways `/auth/confirm` sends a person back here (RP-18): a timeout
// answering the link and a link already spent or malformed. Anything else in
// `?error=` is not this contract's and is read as no error at all.
const LINK_ERRORS = ["linkTimeout", "linkInvalid"] as const;
type LinkError = (typeof LINK_ERRORS)[number];

function readLinkError(value: string | null): LinkError | null {
  return value !== null && (LINK_ERRORS as readonly string[]).includes(value) ? (value as LinkError) : null;
}

// No red anywhere in this palette (docs/pulsar/DESIGN.md): every failure —
// the link's or the send's — sets its break off with a hairline and says it
// in muted, full-weight ink, never a colour of its own.
function FailureNotice({ title, body }: { title: string; body?: string }) {
  return (
    <>
      <Separator />
      <Text as="p" weight="medium">
        {title}
      </Text>
      {body ? (
        <Text as="p" tone="muted">
          {body}
        </Text>
      ) : null}
    </>
  );
}

function EntrarForm() {
  const t = useTranslations("account");
  const linkError = readLinkError(useSearchParams().get("error"));

  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function handleSend(): Promise<void> {
    setState({ kind: "sending" });
    const result = await sendSignInLink(email);
    setState(result.ok ? { kind: "sent" } : { kind: "failed", error: result.error });
  }

  if (state.kind === "sent") {
    return (
      <Page>
        <Text as="p" variant="title">
          {t("title")}
        </Text>
        <Text as="p">{t("sent")}</Text>
      </Page>
    );
  }

  return (
    <Page>
      <Text as="p" variant="title">
        {t("title")}
      </Text>

      {/* Shown until the person's own next attempt replaces it with the
          send's own verdict — a stale link failure has nothing left to say
          once a fresh request is in flight. */}
      {linkError && state.kind === "idle" ? (
        <FailureNotice title={t(`errors.${linkError}Title`)} body={t(`errors.${linkError}Body`)} />
      ) : null}

      <Field
        label={t("emailLabel")}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />

      {state.kind === "failed" ? <FailureNotice title={t(`errors.${state.error}`)} /> : null}

      <Button onClick={() => void handleSend()} disabled={state.kind === "sending"}>
        {state.kind === "sending" ? t("sending") : t("action")}
      </Button>
    </Page>
  );
}

export default function EntrarPage() {
  return (
    <Suspense fallback={null}>
      <EntrarForm />
    </Suspense>
  );
}
