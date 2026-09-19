// RL-36 dropped `lib/word/credits-store.ts`, but every device that ever
// resolved a photo still carries the IndexedDB database it wrote. Nothing
// reads that database again, so nothing but this will ever delete it.
const DATABASE_NAME = "reading-credits";
const FORGOTTEN_FLAG = "reading-credits-forgotten";

// A device-level flag about a retired database, not reader payload: the
// stores next door hold what a screen reads back, and nothing ever reads
// this one again.
function alreadyForgotten(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(FORGOTTEN_FLAG) !== null;
}

function rememberForgotten(): void {
  try {
    localStorage.setItem(FORGOTTEN_FLAG, "1");
  } catch {
    // Storage refused the write; the next open retries the delete.
  }
}

/**
 * Deletes the orphaned credits database once per device. Never opens it —
 * `deleteDatabase` on a name that does not exist succeeds and creates
 * nothing, while `indexedDB.open` would resurrect it. Every failure is
 * swallowed: a browser that refuses to delete leaves the app as it was.
 */
export function forgetPhotoCredits(): void {
  try {
    if (typeof indexedDB === "undefined") return;
    if (alreadyForgotten()) return;

    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => rememberForgotten();
    // A delete that never happened must be retried on the next open, so
    // the flag stays unset here.
    request.onerror = () => {};
    request.onblocked = () => {};
  } catch {
    // Swallowed by design; see above.
  }
}
