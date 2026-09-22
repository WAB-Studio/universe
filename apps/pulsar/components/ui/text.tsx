import { Text as ThemesText, type TextProps } from "@radix-ui/themes";

import styles from "./text.module.css";

// The type scale of docs/pulsar/DESIGN.md "Type", one class per role, so no
// screen names a size. `body` inherits the base step and only takes a tone.
type Variant = "title" | "name" | "meta" | "body";

// docs/pulsar/DESIGN.md "Tokens": `quiet` never carries a word a person must
// read, so a screen reaching for it is asking for decoration, not a sentence.
type Tone = "ink" | "secondary" | "muted" | "quiet" | "accent";

type PulsarTextProps = {
  variant?: Variant;
  tone?: Tone;
};

const variants: Record<Variant, string | undefined> = {
  title: styles.title,
  name: styles.name,
  meta: styles.meta,
  body: undefined,
};

const tones: Record<Tone, string> = {
  ink: styles.ink,
  secondary: styles.secondary,
  muted: styles.muted,
  quiet: styles.quiet,
  accent: styles.accent,
};

// `color` and `highContrast` name a hue from Radix's scale and `size` a step
// from its type scale: the tone comes from the token table and the size from
// `variant`, so neither is reachable. Distributive, because `TextProps` is a
// union over the element it renders and a plain `Omit` would collapse it to one.
type Narrowed<T> = T extends unknown ? Omit<T, "color" | "highContrast" | "size"> : never;

export function Text({ variant = "body", tone, className, ...props }: Narrowed<TextProps> & PulsarTextProps) {
  const merged = [variants[variant], tone ? tones[tone] : undefined, className]
    .filter(Boolean)
    .join(" ");
  return <ThemesText {...props} className={merged || undefined} />;
}
