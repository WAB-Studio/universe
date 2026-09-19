import { isAuthRetryableFetchError } from "@supabase/supabase-js";

// RL-49: `linkTimeout` is the gateway not answering — `verifyOtp` ran but
// never completed, so the token's fate is unknown. `linkInvalid` covers a
// malformed query string and a rejection that did complete: both are
// failures the design attributes to the link, not to us.
export type FailureReason = "linkTimeout" | "linkInvalid";

export type VerifyMagicLinkResult<TUser> =
  | { ok: true; user: TUser }
  | { ok: false; reason: FailureReason };

// No `@repo/supabase-auth` import here, on purpose: that package pulls in
// `server-only` and `next/headers`, so a module that imports it cannot load
// outside a running Next server and a spec can only grep its source, never
// drive it. `verifyOtp` is passed in instead, so the spec below can hand it
// a spy and count real invocations.
type VerifyOtp<TParams, TUser> = (
  params: TParams,
) => Promise<{ data: { user: TUser | null }; error: unknown }>;

/**
 * Calls `verifyOtp` exactly once — there is no loop and no branch that
 * calls it again — and maps its answer to a reason instead of retrying to
 * find out. `verifyOtp` is not idempotent and a retryable fetch error says
 * nothing about whether the token was spent (docs/TRAPS.md).
 */
export async function verifyMagicLink<TParams, TUser>(
  verifyOtp: VerifyOtp<TParams, TUser>,
  params: TParams,
): Promise<VerifyMagicLinkResult<TUser>> {
  const { data, error } = await verifyOtp(params);
  if (error || !data.user) {
    return { ok: false, reason: isAuthRetryableFetchError(error) ? "linkTimeout" : "linkInvalid" };
  }
  return { ok: true, user: data.user };
}
