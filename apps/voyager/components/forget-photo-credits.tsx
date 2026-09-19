"use client";

import { useEffect } from "react";

import { forgetPhotoCredits } from "@/lib/word/forgotten-credits";

// Renders nothing: the whole of it is one device-level cleanup, run once
// per open.
export function ForgetPhotoCredits() {
  useEffect(() => {
    forgetPhotoCredits();
  }, []);

  return null;
}
