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

// docs/pulsar/DESIGN.md "The controls" dresses these three and no more. A
// variant the design has not dressed is not reachable: Radix's own `soft`,
// `surface` and `classic` paint from its scales, so they are typed away rather
// than left one keystroke behind a legal prop. `color` and `highContrast` go
// with them — both name a hue this design does not have.
type Variant = "solid" | "outline" | "ghost";

type PulsarControlProps = {
  tap?: TapSize;
  // Runs the control to the row's full width, for a sheet's own commit button.
  block?: boolean;
  variant?: Variant;
};

type Narrowed<P> = Omit<P, "variant" | "color" | "highContrast" | "radius">;

const variants: Record<Variant, string | undefined> = {
  solid: styles.solid,
  outline: styles.outline,
  ghost: styles.ghost,
};

function classes(
  { tap, block, variant = "solid" }: PulsarControlProps,
  className: string | undefined,
): string {
  return [
    styles.control,
    tap === 44 ? styles.tap44 : styles.tap48,
    variants[variant],
    block ? styles.block : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export const Button = forwardRef<HTMLButtonElement, Narrowed<ButtonProps> & PulsarControlProps>(
  function Button({ tap, block, variant = "solid", className, ...props }, ref) {
    return (
      <ThemesButton
        ref={ref}
        {...props}
        variant={variant}
        className={classes({ tap, block, variant }, className)}
      />
    );
  },
);

export const IconButton = forwardRef<
  HTMLButtonElement,
  Narrowed<IconButtonProps> & PulsarControlProps
>(function IconButton({ tap, block, variant = "solid", className, ...props }, ref) {
  return (
    <ThemesIconButton
      ref={ref}
      {...props}
      variant={variant}
      className={classes({ tap, block, variant }, className)}
    />
  );
});
