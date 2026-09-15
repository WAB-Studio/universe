"use client";

import { useEffect } from "react";

// RL-36 dropped `lib/word/credits-store.ts`, but every device that ever
// resolved a photo still carries the IndexedDB database it wrote. Nothing
// reads that database again, so nothing but this component will ever delete
// it. The name is a literal on purpose: the store it named is already gone.
const DATABASE_NAME = "reading-credits";
const FORGOTTEN_FLAG = "reading-credits-forgotten";

// Renders nothing. Runs once per device, never opens the database it
// deletes — `deleteDatabase` on a name that does not exist succeeds and
// creates nothing, while `indexedDB.open` would resurrect it. Every failure
// here is swallowed: a browser that refuses to delete leaves the app
// exactly as it was.
export function ForgetPhotoCredits() {
  useEffect(() => {
    try {
      if (typeof indexedDB === "undefined") return;
      // A device-level flag about a retired database, not app payload: the
      // repo's `lib/` stores hold state a screen reads back, and nothing
      // ever reads this one again.
      // eslint-disable-next-line no-restricted-globals
      if (typeof localStorage === "undefined") return;
      // eslint-disable-next-line no-restricted-globals
      if (localStorage.getItem(FORGOTTEN_FLAG)) return;

      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => {
        try {
          // eslint-disable-next-line no-restricted-globals
          localStorage.setItem(FORGOTTEN_FLAG, "1");
        } catch {
          // Storage refused the write; the next open retries the delete.
        }
      };
      // A delete that never happened must be retried on the next open, so
      // the flag stays unset here.
      request.onerror = () => {};
      request.onblocked = () => {};
    } catch {
      // Swallowed by design; see above.
    }
  }, []);

  return null;
}
