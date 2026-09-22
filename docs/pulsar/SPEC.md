# Goal log — specification

> **For the implementing agent:** section 1 is the contract and section 4 fixes
> the stack. If something is not in section 1, it does not get built. This
> document makes no implementation decisions: how each requirement is satisfied
> is decided at implementation time, as long as the non-functional requirements
> hold.

> The app's name is `pulsar` throughout. It is the user's to change; nothing but
> a directory name and this word depends on it.

---

## 1. Specification

### Context

A person keeps goals that are won over weeks and lost in single days. The plan
says what counts and how often. Only the day says what actually happened.

Every tool for this asks the person to do the thing and then to say they did it.
The day saying it costs more than doing it, they stop saying it; a week later
they stop doing it. So the app's first duty is to cost nothing: what another app
already knows is never asked for again.

The central unit is the **fact**: something that happened, at a moment, from a
source. A fact is **declared** — the person says so, in one tap — or **derived**
— another app already recorded it and this one reads it where it lies.

Nothing is ever stored as done. What today asks for, what it got and what it is
still missing are derived from the facts against the goal's commitments, the way
`apps/orbit` derives a balance from movements and never holds one in a column.

Interface language: Spanish. A person reads only their own log.

### Scope

A generic engine from the first slice: a person defines any goal, with any
cadence, and satisfies it by tapping or by evidence another app leaves. Taken by
the user 2026-09-22 over a version written for one plan alone.

The engine holds a plan of three phases and a plain errand with the same four nouns; a model that
needs a second shape for «call the bank» is not generic, it is one plan with a hobby.

`plan-ingles-dev.md` is the goal the engine must hold whole — a fixed daily
block of four commitments, a different commitment per weekday, three phases and
a measure reviewed every four weeks. A model that cannot express that plan is
not generic.

**Out of scope:** reminders and notifications, streaks and scores, sharing a goal
with another person, offline use, and any write into another app's tables. None
of this gets built, and no schema, table or column is "prepared for" it.

### Functional requirements

#### The day

- [ ] **RP-01** — The app opens on today: what today asks for, what is already satisfied, and what is not. No tap, no choice, no screen before it.
- [ ] **RP-02** — A commitment is satisfied in one tap. No form, no field, no confirmation.
- [ ] **RP-03** — A commitment that measures something takes its number in the same gesture, offered with the number the plan expects, and is satisfied by accepting it. **The number carries its unit** — minutes, pages, kilometres, repetitions, cards — named once on the commitment and never typed again.
  - Widened 2026-09-22, the day it was written, when the user asked whether the app served anything beyond one plan. A quantity with no unit cannot be summed into a goal's measure and cannot be drawn. The code was unticked and nothing had been verified against it, so no tick is invalidated.
- [ ] **RP-04** — A fact can carry one line the person writes — the two mistakes from today's monologue, what the conversation cost. It is offered, never required, and the day shows it.
- [ ] **RP-05** — A declared fact can be undone. A derived one cannot: it belongs to the app that recorded it.
- [ ] **RP-06** — A fact can be written for a day already past. It keeps the day it happened and the moment it was written, and the two are never shown as one.

#### The evidence another app leaves

- [ ] **RP-07** — A commitment can be satisfied by evidence another app already records, with no act from the person. **A source is declared, never built in**: it names where the rows live, what one row means and what the person sees it called. The reading app's searches are the first one; the app names no source in its schema, its screens or its types.
  - Widened 2026-09-22, same day and same question. Written as "the reading app's searches", a second source — a movement in `apps/orbit`, a commit, an import — cost a migration instead of a reader.
- [ ] **RP-08** — A commitment satisfied by evidence says **how much** of it satisfies the day, in the source's own unit, and the person sets it. **The reading app's source is offered at one search**: opening the dictionary and looking something up is reading. Taken by the user 2026-09-22, over ten and over forty, on the ground that the copy does not yet start on its own (RL-30) and a high threshold would make a working feature read as a broken one. A source that only ever happens once satisfies at one and offers no choice.
- [ ] **RP-09** — Evidence names its source wherever it is drawn. A day marked by the reading app never reads as a day the person said they did.
- [ ] **RP-10** — Evidence is read where it already lives and is never copied into this app. Emptying the record in the reading app empties the evidence here too: there is one truth and it has one home. Decided by the user 2026-09-22.

#### The goal and its plan

- [ ] **RP-11** — A person creates a goal with a name and a horizon, and the app holds more than one at a time.
- [ ] **RP-12** — A goal holds commitments. A commitment names what counts and how often: every day, named weekdays, a number of times a week, every N days, or a number of times a month.
  - Widened 2026-09-22 from the three cadences one plan needed. A habit measured by the month — a haircut, a deep clean, a call home — had nowhere to live.
- [ ] **RP-13** — A commitment is retired, never deleted. The facts it explains stay explained and the weeks it governed keep reading as they did.
- [ ] **RP-14** — A goal names **one** measure that predicts its progress — minutes spoken, pages read — and every fact that carries a quantity **in that measure's unit** feeds it. A quantity in any other unit satisfies its commitment and is not summed: a goal measured in minutes is not advanced by forty searches.
  - Settled 2026-09-22, when the engine asked whether evidence feeds the measure. It does, when it shares the unit, and by the same rule as any other quantity — the measure never knows which app a quantity came from. Written before any screen read it, so no tick is invalidated.
- [ ] **RP-15** — A goal holds phases: a span of weeks with its own single aim. The day says which phase it is in.

#### The thing that happens once

- [ ] **RP-19** — A person writes down something that happens **once** — call the bank, renew the passport, finish chapter three — with no cadence, no goal and no plan behind it. It takes a day when it has one and sits in the day's list beside the commitments; done, it leaves the list and stays in the log as the fact it produced. Asked for by the user 2026-09-22: a log of goals that cannot hold a plain errand is not the app they asked for.
- [ ] **RP-20** — A one-off can belong to a goal or to nothing at all. Belonging to one, it counts toward that goal's week; belonging to nothing, it is still a fact with a day, and the week still shows it.
- [ ] **RP-22** — A one-off written by mistake can be deleted, and nothing survives it: it never happened, so there is no fact to keep. The act says, where it is offered, how it differs from marking the thing done — done leaves a record, deleted leaves nothing. Asked for by the user 2026-09-22, after the grant layer was measured refusing it: «llamar al banko» with a typo is a first-week problem and today it stays forever.
- [ ] **RP-21** — A one-off with no day is not lost. It waits in a list of its own, off the day's screen, and is given a day whenever the person wants one.

#### The week and the review

- [ ] **RP-16** — The week is drawn as it was: the days with facts and the days without. No streak, no score, no praise and no reproach. A deliberate rest day is a plan's instruction, not a failure. Decided by the user 2026-09-22.
- [ ] **RP-17** — A goal's measure is read week by week, as the one table its review needs, from the first week to the current one.

#### The account

- [ ] **RP-18** — A person signs in with a link sent to their address, with the session and the claim verification `apps/voyager` already uses. The log is theirs and reaches every device they sign in on.

### Non-functional requirements

- [ ] **RNP-01** — Every string a person reads comes from the message catalogue. The interface is Spanish.
- [ ] **RNP-02** — A declared fact costs one tap and lands in under five seconds from the app being open. This is the requirement the product lives or dies by; when it conflicts with another, it wins.
- [ ] **RNP-03** — The day's screen pays a bounded number of round trips to Postgres, every one of them fanned out together, the evidence query included. Never a chain of awaits.
- [ ] **RNP-04** — The evidence is never a condition of the day. When the reading app's rows cannot be read, the day draws its declared facts and says that one source could not be read. Never a blank day, never an error page.
- [ ] **RNP-05** — A person reads and writes only their own facts. The access policies in the database decide it, not the query, and they are proved by driving them. No service path evades them.
- [ ] **RNP-06** — The day is the person's day, in their own zone, never UTC. A fact at 23:40 belongs to that day; the same fact read from another zone still belongs to it.
- [ ] **RNP-07** — The app holds at a 360 px viewport: no horizontal overflow, no overlapping control, no tap target under 32 px on its shorter side. It is used with one thumb, in the minute the thing was finished.
- [ ] **RNP-08** — The person chooses light or dark and the choice is remembered on the device. The app opens in the system's mode until a choice is made.
- [ ] **RNP-10** — A second evidence source costs a reader and a row of configuration, never a migration and never a screen. The shape a source answers in is fixed — a day, a quantity, a unit, a name for the person — and nothing downstream of it knows which app it came from.
- [ ] **RNP-09** — Every `auth.users` row a script of this app creates is registered through `@repo/harness-registry`. No automated check ever submits the sign-in form with a typed address: it sends a real email from the user's own account and mints a real row.

---

## 2. Model and invariants

### The four nouns

| Noun | What it is |
|---|---|
| **Goal** | A name, a horizon, one measure, and the phases it passes through. |
| **Commitment** | What counts, how often, and what satisfies it — a tap, a quantity, or evidence over a threshold. |
| **Fact** | Something that happened: its day, the moment it was written, its source, an optional quantity, an optional line. |
| **One-off** | Something to do once: a name, a day when it has one, and a goal when it belongs to one. |
| **Evidence** | Rows another app owns, read under the person's own identity and never copied. A source declares where they live and what one row is worth. |

### Invariants

- **Nothing stores "done".** A day's state is derived from facts against commitments, every time it is drawn.
- A fact is never edited. It is written once, and removed whole or not at all.
- A fact keeps the day it happened and the moment it was written. The two are never conflated and never collapsed into one column.
- Derived evidence lives in its own app's tables. This app reads it and never writes it.
- A commitment is retired, never deleted. A week already lived never changes shape because a plan changed today.
- A goal's measure is a sum over facts, never a column.
- The day boundary is the person's, not the server's.
- A quantity without a unit is not a quantity. The unit belongs to the commitment, never to the fact that repeats it.
- Nothing in the schema, the types or the screens names a particular evidence source. A source is configuration.
- A goal is optional. A fact with no goal is a whole fact.

---

## 3. Architecture

A Next.js application whose data lives in the Supabase the other two apps already
use, in a schema of its own.

Principles, not recipes:

- One schema, `goals`, with its own migration journal, beside `finances` and `reading`.
- Evidence is a query across schemas under the reader's own session, so the reading app's
  own row policies are what allow it. **Confirmed 2026-09-22, before any module was written:**
  `apps/voyager/db/migrations/0000_shallow_hammerhead.sql` grants `USAGE ON SCHEMA reading`
  (:8) and `SELECT ON reading.lookups` (:71) to `authenticated`, and the policy
  `lookups_select_self` narrows it to `auth.uid() = user_id`. Nothing in `apps/voyager`
  changes for this app to read its evidence.
- **What that evidence holds today, measured the same day: 55 rows, one reader, one single
  day — 2026-09-11 in Bogotá, eleven days ago.** The path works; the habit has not reached it.
  RL-30 — the copy starting on its own — is still unticked in `docs/voyager/SPEC.md`, so a
  day here reads empty until the device syncs. A screen built on this source is correct and
  quiet at once. Build it knowing that; do not read the quiet as a defect.
- The identity is one `auth.users` row across the three apps. A person signed into the
  reading app and into this one is the same person, or no evidence can be read at all.
- `@repo/supabase-auth` serves the session and the claim verification. Nothing about
  auth is written twice.

---

## 4. Stack

| Need | Choice | What it saves |
|---|---|---|
| Framework | **Next 16.3.3** | The version both apps run. Routing and server actions. |
| UI | **React 19.2.8** | The version Next 16.3.3 pairs with. |
| Language | **next-intl 4** | The Spanish catalogue RNP-01 requires, with date and number formatting. |
| Validation | **Zod 4** | One schema validates the form and the server action alike. |
| Components | **Radix Themes 3** | Layout, typography, controls and theming as components with props. |
| Icons | **lucide-react** | An icon set, chosen independently of the component library. |
| Types | **TypeScript**, with **@typescript/native-preview** | `tsgo` checks the project in seconds. |
| Lint | **eslint**, with **eslint-config-next** | The rules the framework's own conventions need. |
| Browser verification | **Playwright** | The facts no server-side check reaches: the 360 px viewport, the tap target, the five seconds of RNP-02. |
| Postgres | **postgres 3 + drizzle-orm 0.45** | The same client and ORM the other two apps use, over the same pooler. |
| Migrations | **drizzle-kit 0.31** (dev) | The `goals` schema versioned in the repository, with a journal of its own. |
| Auth | **@repo/supabase-auth** | The cookie session and the magic link, already written and already proved. |

### Do not install

| Library | Use instead |
|---|---|
| Tailwind, shadcn/ui | Radix Themes is the system. |
| Zustand / Redux | The day is server state; a form is a form. |
| A date library (moment, luxon, date-fns) | `next-intl`'s formatting and one function that names the person's day. |
| A cron or scheduler package | A cadence is a rule read at draw time, never a job that writes rows. |
| A charting library | The review is a table (RP-17), not a chart. |
| A notification or push package | Out of scope, and it is what turns this app into one more thing to ignore. |
