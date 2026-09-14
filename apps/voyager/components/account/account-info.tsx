"use client";

import { useTranslations } from "next-intl";

import manifestJson from "@/public/dictionary/manifest.json";
import { manifestSchema } from "@/lib/dictionary/format";
import { POS_FREQUENCY_LICENCE_URL, POS_FREQUENCY_SOURCE_URL } from "@/lib/dictionary/pos-frequency-source";
import packageJson from "@/package.json";
import { Flex, Link, MetaLabel, Separator, Text } from "@/components/ui";

// Imported, not fetched: the manifest is on disk at build time (RNL-04),
// so this tab pays no request.
const manifest = manifestSchema.parse(manifestJson);

// `docs/voyager/SPEC.md`'s own model table reads the payload in MiB, so the
// figure here is 1024^2, not the decimal megabyte.
const BYTES_PER_MIB = 1024 * 1024;

/**
 * `CuentaInformacion` (`docs/voyager/DESIGN.md` "Settled"): the dictionary's
 * source, its edition and its CC BY-SA 3.0 licence, plus SUBTLEX-US's own
 * CC BY-NC-SA 4.0 credit for the sense order it feeds RL-43 — reachable
 * with no session because `/cuenta` already renders without one (RL-33),
 * which is what keeps every credit reachable by whoever uses the app, not
 * only the reader who happens to be signed in.
 */
export function AccountInfo() {
  const t = useTranslations("account.info");
  const { source, counts, asset } = manifest;
  const sizeMib = `${(asset.bytes / BYTES_PER_MIB).toFixed(1)} MiB`;

  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="1">
        <MetaLabel>{t("dictionaryLabel")}</MetaLabel>
        {/* The name doubles as the source link RL-33 asks for: FreeDict is
            what is named, and what is linked. */}
        <Link href={source.url} target="_blank" rel="noreferrer">
          <Text size="5" serif>
            {t("dictionaryName")}
          </Text>
        </Link>
        <Text size="2" muted>
          {t("dictionaryStats", { entries: counts.entries, edition: source.edition, size: sizeMib })}
        </Text>
      </Flex>

      <Separator size="4" />

      <Flex direction="column" gap="1">
        <MetaLabel>{t("licenceLabel")}</MetaLabel>
        <Text size="2" as="p">
          {t.rich("licenceCredit", {
            cc: (chunks) => (
              <Link href={source.licenceUrl} target="_blank" rel="noreferrer">
                {chunks}
              </Link>
            ),
          })}
        </Text>
      </Flex>

      <Separator size="4" />

      <Flex direction="column" gap="1">
        <MetaLabel>{t("frequencyLabel")}</MetaLabel>
        <Text size="2" as="p">
          {t.rich("frequencyCredit", {
            source: (chunks) => (
              <Link href={POS_FREQUENCY_SOURCE_URL} target="_blank" rel="noreferrer">
                {chunks}
              </Link>
            ),
            cc: (chunks) => (
              <Link href={POS_FREQUENCY_LICENCE_URL} target="_blank" rel="noreferrer">
                {chunks}
              </Link>
            ),
          })}
        </Text>
      </Flex>

      <Separator size="4" />

      <Flex direction="column" gap="1">
        <MetaLabel>{t("appLabel")}</MetaLabel>
        <Text size="2" muted>
          {t("appVersion", { version: packageJson.version })}
        </Text>
      </Flex>
    </Flex>
  );
}
