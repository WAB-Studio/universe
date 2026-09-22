import Link from "next/link";

import { Button, Text } from "@/components/ui";

// A day with no goal open yet (`HoyVacio.dc.html`). `/metas/nueva` is module
// 16's own screen and does not exist in this slice; the link is written
// anyway, exactly as the contract asks, and resolves once that module lands.
export function EmptyDay({ title, action }: { title: string; action: string }) {
  return (
    <>
      <Text as="p">{title}</Text>
      <Button asChild>
        <Link href="/metas/nueva">{action}</Link>
      </Button>
    </>
  );
}
