"use client";

import { forwardRef } from "react";
import {
  Button as ThemesButton,
  IconButton as ThemesIconButton,
  type ButtonProps,
  type IconButtonProps,
} from "@radix-ui/themes";

import styles from "./button.module.css";

// docs/pulsar/DESIGN.md "The marks": every control is at least 48px on its
// shorter side. 44 is the one exception the design names, the light/dark
// control in the day's header, and it is asked for by name.
type TapSize = 44 | 48;

type PulsarButtonProps = {
  tap?: TapSize;
  // Runs the control to the row's full width, for a sheet's own commit button.
  block?: boolean;
};

function classes(
  tap: TapSize | undefined,
  block: boolean | undefined,
  className: string | undefined,
): string {
  return [
    styles.control,
    tap === 44 ? styles.tap44 : styles.tap48,
    block ? styles.block : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps & PulsarButtonProps>(
  function Button({ tap, block, className, ...props }, ref) {
    return <ThemesButton ref={ref} {...props} className={classes(tap, block, className)} />;
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps & PulsarButtonProps>(
  function IconButton({ tap, block, className, ...props }, ref) {
    return <ThemesIconButton ref={ref} {...props} className={classes(tap, block, className)} />;
  },
);
