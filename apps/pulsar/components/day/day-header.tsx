import { Flex, Text, ThemeToggle } from "@/components/ui";

// The day's own title and, beside it, the light/dark control (RNP-08):
// docs/pulsar/DESIGN.md "Decisions taken here" puts it here and nowhere
// else in this slice — there is no `/cuenta` screen in this app.
export function DayHeader({
  title,
  toLightLabel,
  toDarkLabel,
}: {
  title: string;
  toLightLabel: string;
  toDarkLabel: string;
}) {
  return (
    <Flex justify="between" align="center">
      <Text as="p" variant="title">
        {title}
      </Text>
      <ThemeToggle toLightLabel={toLightLabel} toDarkLabel={toDarkLabel} />
    </Flex>
  );
}
