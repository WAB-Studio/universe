import { readReadingLookups } from "./reading-lookups";
import type { EvidenceReader } from "./types";

/**
 * Every source a commitment can point at, keyed by `goals.evidence_sources
 * .key` (RP-07). A second source is one entry here plus one seeded row in
 * that table, never a migration and never a screen (RNP-10).
 */
const READERS: Record<string, EvidenceReader> = {
  reading_lookups: readReadingLookups,
};

export function readerFor(key: string): EvidenceReader | null {
  return READERS[key] ?? null;
}
