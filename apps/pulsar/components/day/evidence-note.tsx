import { Text } from "@/components/ui";

// RNP-04: the day one source could not be read, said in one muted line —
// never a red, never an error page, never a blank day.
export function EvidenceNote({ text }: { text: string }) {
  return (
    <Text as="p" tone="muted" variant="meta">
      {text}
    </Text>
  );
}
