import { Page, Skeleton } from "@/components/ui";

// `HoyCargando.dc.html`: plain blocks in the line colour, no shimmer — a log
// that is still arriving says so by standing still.
export default function Loading() {
  return (
    <Page>
      <Skeleton shape="title" width="half" />
      <Skeleton shape="label" width="short" />
      <Skeleton shape="name" />
      <Skeleton shape="name" />
      <Skeleton shape="name" />
    </Page>
  );
}
