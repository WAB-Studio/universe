import { redirect } from "next/navigation";

import { DayScreen } from "@/components/day/day-screen";
import { getPerson } from "@/lib/session";

// RP-01: `/` opens on today. `getPerson` is the verified JWT alone, zero
// round trips, so the gate costs nothing before the day itself is fetched.
export default async function HomePage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  return <DayScreen />;
}
