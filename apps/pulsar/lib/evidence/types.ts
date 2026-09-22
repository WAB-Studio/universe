import type { Transaction } from "@/lib/session";
import type { EvidenceDay } from "@/lib/day/types";

export type { EvidenceDay };

/**
 * The one door a source answers behind (RNP-10). `personId` is the person the
 * caller already verified through `withReadingDb`'s own settle — a reader
 * never re-decides who is asking, the transaction's policies already have.
 * `tx` is that settled transaction, `[from, to]` a civil-day range inclusive
 * on both ends, `zone` the person's own zone (RNP-06). Nothing that calls
 * this learns which app answered: that is `registry.ts`'s one job.
 */
export type EvidenceReader = (args: {
  personId: string;
  from: string;
  to: string;
  zone: string;
  tx: Transaction;
}) => Promise<EvidenceDay[]>;
