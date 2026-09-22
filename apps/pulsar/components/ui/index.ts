// The one door: every screen imports its primitives, and the Radix Themes
// components it composes them with, from here and nowhere else.
//
// The door exports nothing the design has not dressed. What is missing, and why:
// no `Card` and no `Box` — a group is ruled with a hairline, never a card and
// never a border box; no `Callout` and no `Badge` — this design has no colour
// for failure and no badge anywhere; no `SegmentedControl` — a cadence is
// chosen with chips; no `Table` — the review's wide table has its own board,
// and an undressed export is the one a screen in a hurry uses undressed; no
// `Heading` — `Text` already carries the whole type scale and a second way to
// set a heading is a second scale, at a size (24px) the token table does not
// hold; no `Skeleton` — Radix paints its own from its own theme, and the
// dressed one below draws the line colour instead; no `Spinner` — no board in
// this app draws one, the loading state is the skeleton.
//
// These three stay because they decide no colour and no size: `Flex` and `Grid`
// place what a screen gives them and paint nothing, and `VisuallyHidden` moves
// a name out of sight for a reader that is not looking.
export { Flex, Grid, VisuallyHidden } from "@radix-ui/themes";

export { Page } from "./page";

export { Row } from "./row";

export { Mark, type MarkState } from "./mark";

export { SectionLabel } from "./section-label";

export { Figure } from "./figure";

export { Sheet } from "./sheet";

export { Field } from "./field";

export { Chip } from "./chip";

export { Skeleton } from "./skeleton";

export { Button, IconButton } from "./button";

export { Text } from "./text";

export { Separator } from "./separator";

export { ThemeToggle } from "./theme-toggle";
