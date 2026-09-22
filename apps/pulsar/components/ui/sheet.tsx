"use client";

import type { ReactNode } from "react";
import { Dialog } from "@radix-ui/themes";

import styles from "./sheet.module.css";

// The surface a fact is written on: it rises from the foot of the screen with
// 16px on its top corners (docs/pulsar/DESIGN.md "The marks"). Controlled, so
// the screen that opens it owns when it closes.
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  // Radix points every dialog at a description; with none rendered the
  // attribute would name an element that is not there, so it is dropped.
  const described = description ? {} : { "aria-describedby": undefined };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className={styles.sheet} {...described}>
        <div className={styles.grabber} aria-hidden />
        <Dialog.Title className={styles.title}>{title}</Dialog.Title>
        {description ? (
          <Dialog.Description className={styles.description}>{description}</Dialog.Description>
        ) : null}
        <div className={styles.body}>{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
