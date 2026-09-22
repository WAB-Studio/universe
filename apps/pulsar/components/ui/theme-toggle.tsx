"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { applyTheme, readStoredTheme, resolveAppearance, subscribeToTheme } from "@/lib/theme";
import { IconButton } from "./button";
import styles from "./theme-toggle.module.css";

// The face the device is drawing right now. Light on the server pass: nothing
// there has read storage yet, and the class the pre-paint script writes decides
// the first frame regardless of what React renders (RNP-08).
const readAppearance = () => resolveAppearance(readStoredTheme());
const serverAppearance = () => "light" as const;

// The light/dark control itself, and nothing about where it sits: the screen
// that owns the header places it (docs/pulsar/DESIGN.md "Decisions taken here").
export function ThemeToggle({
  toLightLabel,
  toDarkLabel,
}: {
  // What the control does next, not what it shows: a button is named by its act.
  toLightLabel: string;
  toDarkLabel: string;
}) {
  const appearance = useSyncExternalStore(subscribeToTheme, readAppearance, serverAppearance);
  const next = appearance === "dark" ? "light" : "dark";

  return (
    <IconButton
      tap={44}
      variant="ghost"
      aria-label={next === "light" ? toLightLabel : toDarkLabel}
      onClick={() => applyTheme(next)}
    >
      {next === "light" ? (
        <Sun className={styles.icon} aria-hidden />
      ) : (
        <Moon className={styles.icon} aria-hidden />
      )}
    </IconButton>
  );
}
