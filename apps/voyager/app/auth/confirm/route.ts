import { createSupabaseServerClient } from "@repo/supabase-auth";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";

const supabaseConfig = {
  url: env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

// `magiclink` and `signup` are what `signInWithOtp` sends depending on
// whether the address already had an account; `email` covers a custom
// template that names the OTP type directly.
const confirmSchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["magiclink", "signup", "email"]),
});

// RL-49: `linkTimeout` is the gateway not answering — `verifyOtp` ran but
// never completed, so the token's fate is unknown. `linkInvalid` covers a
// malformed query string and a rejection that did complete: both are
// failures the design attributes to the link, not to us.
type FailureReason = "linkTimeout" | "linkInvalid";

// `isAuthRetryableFetchError` is the one thing this asks of the error: a
// real 504 cannot be summoned on demand, and nothing here retries
// `verifyOtp` to find out whether the token survived.
function resolveFailureReason(error: unknown): FailureReason {
  return isAuthRetryableFetchError(error) ? "linkTimeout" : "linkInvalid";
}

function failure(request: NextRequest, headers: Headers, reason: FailureReason): NextResponse {
  const url = new URL("/cuenta", request.url);
  url.searchParams.set("error", reason);

  const response = NextResponse.redirect(url);
  headers.forEach((value, name) => response.headers.set(name, value));
  return response;
}

/**
 * Lands the magic link (RL-22). No row to seed: there is no `app_users` here
 * and `reading.lookups` has no header row for a fresh reader to own.
 */
export async function GET(request: NextRequest) {
  const query = confirmSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  // The no-store directives `setAll` hands back have to ride on the redirect.
  const authHeaders = new Headers();
  // A parse failure never reached `verifyOtp`, so it is not a timeout.
  if (!query.success) return failure(request, authHeaders, "linkInvalid");

  const supabase = await createSupabaseServerClient(supabaseConfig, authHeaders);
  const { data, error } = await supabase.auth.verifyOtp({
    type: query.data.type,
    token_hash: query.data.token_hash,
  });

  if (error || !data.user) {
    console.error("magic link verification failed", error);
    return failure(request, authHeaders, resolveFailureReason(error));
  }

  const response = NextResponse.redirect(new URL("/cuenta", request.url));
  authHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}
