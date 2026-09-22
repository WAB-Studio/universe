"use client";

import { themeScript } from "@/lib/theme";

// A Client Component so `typeof window` differs between the SSR pass, where the
// script must stay executable to beat first paint, and any later client render,
// where React would otherwise warn about mounting a live script tag.
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: themeScript }}
    />
  );
}
