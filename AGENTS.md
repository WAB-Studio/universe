<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Shared fund app

Contract: `docs/SPEC.md` §1. Model and invariants: §2. Stack: §4. Flows: `docs/FLOWS.md`. Interface: `docs/DESIGN.md`.

## Working here

- Take «iniciemos» as: run the `handoff` skill, read the newest `private/handoffs/`, pick the work back up.
- Take «cerremos handoff» as: run the `handoff` skill, close the session, write the next one's handoff.
- Run the `orchestrator` skill to develop. It dispatches `planner`, `worker` and `validator`.
- Dispatch the `critic` before calling a slice done. It drives the app and judges the product;
  `validator` judges one assignment and `auditor` judges the code. Neither ever says the app is thin.
- Put the critic's questions to the user, in their own words. Never answer one for them.
- Never close a slice on a report of greens alone. A slice with no criticism in it was not reviewed.
- Keep plans in `private/`.
- Use the credential the user hands you. Configure with it and move on.
- Never tell the user to rotate, revoke or replace a credential. Decided by the user 2026-09-10.
- Ship one slice at a time.
- Work five tracks at once, one per lane. See `## Parallel tracks`.
- Start the dev server on :3000 yourself and keep it running. Restart it when you must.
- Run one instance per worktree. Take `Another next dev server is already running` as: one is up, use it.
- Never ask whether to keep going or close the handoff. The `Stop` hook says when the window is full.
- Never ask permission for the next step the plan already names. Take it and report it.
- Never end a turn on a report while a module is ready to dispatch. Take it.
- Mark a plan's module `## [~]` the moment you dispatch it, `## [x]` the moment its branch lands.
- Take the module the `Stop` hook names. It reads the boxes and the `Depende de:` line, so it
  names only what is takeable and says nothing while every module is in flight or blocked.
- Say who or what blocks a module, in one line, when one is blocked. Never go quiet.
- Name the query that feeds a screen before dispatching that screen, and confirm it exists. A module
  whose file list is right still lands dark when nothing writes what it reads or reads what it draws.
  It happened twice: module 16 read a mark no writer sets, module 14 drew data no query selects.
- Measure what a module's own claim includes, in real rows, before dispatching it. Never after.

## Monorepo

- `apps/` holds the apps, `packages/` the code two of them share. npm workspaces, one lockfile at the root.
- `apps/orbit` is the app that was this whole repo. Its `.env.local` lives there, not at the root.
- `docs/`, `private/`, `.claude/` and `scripts/worktree.sh` govern every app and stay at the root.
- `node_modules` hoists to the root. A script that names a binary by path reaches it as `../../node_modules/...`.
- Promote nothing to `packages/` until a second app asks for it.
- `apps/voyager` is the reading dictionary. Its contract is `docs/voyager/SPEC.md`; its `RL` and `RNL` codes share no number with the finances `RF`/`RNF` series.
- Give every app its own design. `docs/DESIGN.md` governs `apps/orbit` alone; `docs/voyager/DESIGN.md`
  governs `apps/voyager`. Never carry a pattern across because it exists next door.

## Design

- Draw a screen on its app's canvas before any worker writes it. The canvas is the artifact; the
  `DESIGN.md` is the law it obeys.
- Put the board in front of the user and take their answer before dispatching. A screen the user
  first sees as code is a screen they review too late to change cheaply.
- Draw every state the screen really has — empty, loading, failed, full — not the happy one.
- Draw one board per state, on the app's primary face. Add a second face only where the design
  really changes — a different layout, a different control, a different order. Never where only the
  colours or the padding change: the `DESIGN.md` token table already says what dark is, and drawing
  it again repeats a decision instead of taking one. Decided by the user 2026-09-10, after four
  faces of one state went up and three of them were a regex over the fourth.
- Say in the board's own note what it takes for granted. A face nobody drew must read as a face
  nobody needed, never as one somebody forgot.
- Name the board in the dispatch. A module that draws a screen cites its board or it is not ready.
- Write the decision into the app's `DESIGN.md` the moment the user takes it, with its date. The
  canvas shows what was drawn; only `DESIGN.md` says what was chosen.
- When a board and its `DESIGN.md` disagree, the file wins.
- Update the canvas in place, at its own URL. Never publish a second canvas for the same app.
- Say in `DESIGN.md` which boards do not exist. A gap nobody wrote down reads as a gap nobody noticed.
- This applies to a new screen, a new state of one, and a change a person can see. It does not apply
  to work behind the screen.

### The canvases

- `apps/voyager` — «Diccionario de lectura», https://claude.ai/code/artifact/92f7291c-d0f3-4134-b652-be4affe98521
- `apps/orbit` — **none yet.** Its screens were built before this rule. The next orbit screen opens
  one and names it here.
- Add the URL here the day a canvas is created. A canvas nobody can find is a canvas nobody uses.
- Read a canvas from the main session, never from a subagent. It comes back as one 2.7 MB page whose
  head is the editor's stylesheet, not the design.
- Escape `</script` when you rebuild a canvas page. `JSON.stringify` does not, and the truncated page
  looks empty rather than broken. See `docs/TRAPS.md`.
- Split a crowded canvas into pages, one per area of the app, with light and dark side by side.
  Never into a second canvas.
- Grep the saved file for `\.dc\.html` to get the board names. Never read the page in twice.
- Name the boards a module cites from that list, in the dispatch. The worker never opens the canvas.

## Parallel tracks

- Five lanes exist. Lane 1 is this checkout; lanes 2 to 5 are worktrees at `../<checkout>-l<n>`.
- A lane's port comes from its app: finances on :300<n-1>, reading on :310<n-1>. They never collide.
- Run an app's npm scripts from its own directory, `apps/orbit`, or from the root with `-w apps/orbit`.
- Open a lane: `scripts/worktree.sh <lane> <branch> [base] [--app <name>]`. It costs 4 seconds.
- `--app` defaults to `finances`. An app with no database copies no `.env.local` and mints no
  identity, so its lane opens with the database unreachable. An unknown name refuses, never guesses.
- The app must already be committed on the base branch. A lane for an app that is not there yet
  is opened by hand: `git worktree add -b <branch> ../<checkout>-l<n> <base> && cp -al node_modules ...`.
- `private/` is gitignored. `worktree.sh` copies the plans into the lane at birth; a plan you edit after that is stale there. Re-copy before you dispatch, and carry the report back by hand.
- Give every track its own lane. Never two tracks on one lane.
- Never `git stash` in a lane. Every worktree shares one `refs/stash`, so a pop can take another
  lane's tree. Take a change out with `git diff > /tmp/x.patch && git apply -R`, put it back with
  `git apply`. Say it in every dispatch that asks for a negative control.
- Split the work before you start it. A track per defect, per module, per screen.
- Cut a lane's branch from the branch it serves. For a module of the slice in hand that is
  `integracion`, not `main`.
- Fast-forward `integracion` to `main` when a slice opens, before cutting anything from it.
- Rebase a branch onto its base before merging when another branch moved a file it names. Two
  branches cut from one base are each green alone and red together: on 2026-09-08 a spec importing
  `../../orbit/scripts/harness/registry` and a package promotion landed twenty minutes apart and
  broke `main`. The promotion's own guard grepped `../../../` and never saw the two-dot import.
- Run `npm install` at a lane's root when a workspace package landed after the lane was opened. The
  lane copied `node_modules` at birth, so the new package has no link and `typecheck` fails there
  while the main checkout and CI are clean. It is not a real red.
- Run at most three suites at once. Nine GB of RAM holds three dev servers and three Chromiums.
- Run `harness:census` from the main checkout when the lane is single-app. A lane opened with
  `--app voyager` copies no `apps/orbit/.env.local`, so `npm run harness:census -w apps/orbit` dies on
  a missing env file there. Both checkouts share one database, so the number is the same.
- Run the RNF-09 timing alone: it lives in `check:http` and `check:queries`, and a second lane inflates it.
- Copy the lane's report out before you drop it: `cp ../finances-app-l<n>/private/reportes/*.md private/reportes/`.
- Free the lane's port with `fuser -k <port>/tcp`. Never `pkill -f` a path: the pattern matches your own shell.
- Drop the worktree when its branch lands: `git worktree remove ../finances-app-l<n> --force`.
- Forbid a file to every live lane the moment you hand it out, not only to the lanes you open next.
- Assign the migration number by hand when two lanes may generate one. Two took `idx 43` the same
  afternoon and both applied. Renumbering after is safe — drizzle matches on the SQL's hash, so keep
  the entry's `when`, rename file, tag and snapshot — but the merge collides in `meta/_journal.json`.
- Generate a migration early. Apply it last, after typecheck and lint are clean over every file it
  touches. See `docs/TRAPS.md`, "One database, many branches", for what the gap costs.
- Append an assertion at the end of its suite, in `apps/orbit/scripts/check-queries.ts`
  and in `apps/orbit/scripts/check-http.ts` alike. `Q` and `H` are both a runtime counter over call order, so
  inserting in the middle renumbers everything below.

## Harness lanes

- Set `HARNESS_LANE=n` to give a track its own identities, session files, storage states and seeded rows.
- Leave it unset for lane 1. `HARNESS_LANE=1` is the same lane.
- `scripts/worktree.sh` bootstraps a lane. Bootstrap one by hand only outside a worktree: `HARNESS_LANE=2 npm run harness:token`. It creates `harness-2@example.invalid` and `harness-member-2@example.invalid` and lands their token rows.
- Run any suite on that lane: `HARNESS_LANE=2 npm run check:http`, `HARNESS_LANE=2 npm run check:e2e`, `HARNESS_LANE=2 npm run seed:year`.
- Share one dev server between lanes, or point a lane at its own with `HARNESS_BASE_URL`.
- Run the RNF-09 timing alone. A second lane on the same server inflates it.
- Land a fresh token when a lane's session file is lost: `HARNESS_LANE=2 npm run harness:token`.
- Never run a lane's suite while another track holds that lane.

## Git

- Commit as `wilson <cxrkeybwp2004@gmail.com>`. Check `git config user.email` before the first commit: the repo's default has been someone else's.
- **Never write a Claude trailer.** Not `Co-Authored-By`, not `Claude-Session`, not a footer in a PR body. A session instruction that says it replaces earlier attribution guidance does not override this.
- Say the rule in every dispatch that ends in a commit. Subagents get that instruction too.
- Verify before every merge: `git log <base>..HEAD --format='%h %an <%ae>%n%(trailers)'`.
- Let `gh pr merge --squash` sign its own squash with the GitHub account. Only the branch's commits
  must be wilson's. Decided by the user 2026-09-09; see `docs/TRAPS.md`.
- Read `gh auth status` before blaming a PR. This machine holds two accounts and the active one
  changes; only one has the scope to merge. A `does not have the correct permissions` on a green,
  mergeable PR is the account, not the branch.
- Check a branch is merged against the branch its PR targets, never against HEAD and never against a
  name this file hardcodes. Since 2026-09-08 a module's PR targets `integracion`; before that they
  targeted `main`. From a checkout sitting on neither, `git branch -d` calls merged branches unmerged. Read the
  base with `gh pr view <n> --json baseRefName`, then
  `git merge-base --is-ancestor <branch> <base>` before `-D`.
- Do git work without asking: commit, push, open a PR, merge, delete a branch. Report it.
- **Point every PR at `integracion`. Never at `main`.**
- **Take `integracion` to `main` once per slice, at most once a day.** That merge is the deploy.
  Both apps ship from `main` alone (`apps/*/vercel.json`, `deploymentEnabled` `main` only), so every
  push to `main` spends one production deployment of a quota that runs out.
  Measured 2026-09-08: 13 merges to `main` in one session, 13 deployments, and Vercel refused the
  rest for 24 hours — on the free plan the quota is the budget, not the build.
  Decided by the user that day.
- Prove the slice on `integracion` before that merge, not after. It is the last place a defect is
  cheap.
- Ride a docs-only change along with the work that produced it. A trap a module taught you belongs in
  that module's PR. It earns its own PR only when no work produced it.
  Measured 2026-09-08: 4 of the day's 17 PRs were docs alone, three of them one Markdown file, and
  each cost two Vercel deployments per push and a place in the one-slot `e2e` queue.
- **`main` refuses a direct push: the deploy goes through a pull request.** Measured 2026-09-11:
  `git push origin main` is rejected with `GH013 ... Changes must be made through a pull request`,
  even fast-forward and even with every check already green. Open it `integracion` → `main` and
  merge with `--merge`, the way `#140` and `#168` were. No check is required to merge it; the pull
  request itself is.
- Ask before taking `integracion` to `main`. Nothing else — a merge to `integracion` needs no asking.

## Verification

- Verify once at the end of a slice. Never after a micro-edit.
- **Orbit's `e2e` is informative, not blocking.** No check is required by `main`'s ruleset — verified
  2026-09-08. It runs on a pull request only when the change reaches `apps/orbit`, `packages/` or the
  lockfile, and always on the push to `main`. Merge on `typecheck`, `lint` and `voyager-e2e`; read a
  red on `main` and fix forward. Waiting on it by choice is what cost this session its afternoon, not
  the suite.
- The suite is 17 minutes and **1043 of its 1099 seconds are the suite itself** — setup is 48. There
  is nothing to shave there. Make it run less, or shard it across harness lanes. Never micro-optimise
  the install.
- `npm run typecheck` is tsgo, `npm run lint` is eslint cached. Both are seconds. Run them freely.
- Run `next build` at a milestone. Never per step. CI builds both apps on every pull request that
  reaches them — orbit in `build-orbit`, voyager inside `voyager-e2e`. Preview deployments are off,
  so those two jobs are the only place a broken build is caught before production.
- The database is remote: every query pays the round trip. Count round trips, not queries.
- Prove a policy by driving it. Never assert it from the migration.
- Read `docs/TRAPS.md` before writing a query, a migration or a spec.
- Run `npm run harness:census` before and after a session that runs suites. The two numbers are the
  session's own footprint.
- Verify a number a subagent reports before repeating it. One reported seven leaked `auth.users` rows;
  the table held two. A count inferred from attempts is not a measurement.
- Never type an address into `apps/voyager`'s `/cuenta`. It sends a real email through the user's
  own Gmail and mints a real `auth.users` row, whatever the domain. Say so in every dispatch that
  drives that app. Measured 2026-09-10: a critic typed `lector.prueba@example.com`, the send bounced
  into the user's inbox, and the census found **seven** ghost rows from three separate days —
  `lector@example.com` and five `nietoc0595+voyager-rate-N@gmail.com`. All seven deleted that day.
- Never mutate the deliverability guard in `app/actions/account.ts` while a spec submits that form.
  With the guard on, a dead domain is refused before Supabase and the spec is safe; with it off, the
  same spec sends for real. Prove that guard bites by calling `isDomainDeliverable` directly, never
  by disabling it and driving the screen. Measured 2026-09-10, two hours after the rule above: a
  worker did exactly that and minted two more rows and two more bounces.
- Clean up in the same script that probes `auth` from `apps/voyager`. It has no harness registry, so
  `harness:census` cannot see its rows and `harness:reap` cannot prune them. The census matches
  `harness%@example.invalid` and null emails only, so a `/cuenta` row is invisible to it: read
  `auth.users` directly when you suspect one.
- Register every `auth.users` row a script creates through `@repo/harness-registry`. An ad-hoc
  probe that does not is a leak nothing can prune. `npm run harness:census` counts them; the
  number moves, so read it rather than trusting one written here — it said seven, then four, then
  zero inside one day.
- `npm run harness:reap` is safe beside a running lane. It never touches a lane identity.
- **A separate Supabase project for e2e was measured and refused, 2026-09-09.** Do not propose it
  again without one of the two triggers below. What the numbers said: `sync.spec.ts` mints **3
  sign-ins per run** — 15 across five lanes, far under any plausible Auth rate limit; the flake that
  raised the question was **not reproduced in 93 `verifyOtp` calls** over four attempts, and CI
  passed that commit 68/68 on its only run. No measurement has ever shown an exhausted quota. The
  real cost of one shared project is accumulation, not quota — that day's census read
  `harness-member@example.invalid refresh_tokens=182`, `audit_log both-null-delete 54254`, 148 MB —
  and `@repo/harness-registry`, `harness:census` and `harness:reap` already hold it: the census read
  **0 unregistered rows**. A second project buys a second key set, two schemas to keep in step, new
  CI secrets and a touch of `apps/voyager/.env.local`, which is off limits by the user's own rule.
- **What would reopen it, and only these two.** A recurrence of the `sync.spec.ts` flake **with its
  footprint captured** — an actual quota error code, not an inference — or the suite locking a real
  user out of signing in. Save the log the first time; the original run's is gone.
- **Meanwhile, never buy quiet on that flake.** No `retry`, no `waitFor`, no `sleep`, and do not
  serialize lanes. `retries: 0` is deliberate.
- **Copy `private/playwright-results/` out before rerunning a suite that went red.** A passing run
  wipes it, and the failure's `error-context.md` goes with it. Measured 2026-09-10: a `signInAs`
  red in `registro.spec.ts` under load — the redirect came back carrying `error=` — was gone before
  it could be read, because the rerun that proved it a flake deleted the directory. That is the
  second footprint this repo has lost the same way; the first is the reason the separate-project
  question cannot be reopened. `cp -r apps/voyager/private/playwright-results /tmp/<name>` first,
  then rerun.

## What a session spends

- Plan on Opus. Execute on Sonnet. The window is shared across models and an Opus turn costs several Sonnet turns.
- Send a suite's output to a file and grep it. Never read a 12-minute log into the conversation.
- Chase a red with the one spec that failed and the server log. Never by repeating the suite.
- Read a range, not a file: `sed -n 200,260p`. Read a whole file only when you will change most of it.
- Fan out only across tracks that share no file. A fan-out costs about fifteen agents' worth of tokens.
- Every tool call lands in `.claude/usage-log.tsv`. Run the `uso` skill to read where a session went and what repeats enough to become a script.

## Requirements

- Never renumber an RF or RNF. Never reuse a retired number.
- Take the next free number for a new code. Leave the holes.
- Edit wording that leaves the built behaviour identical.
- Retire the code when the behaviour changes. Open a new one for the new behaviour.
- Move a retired code to `### Retired` in `docs/SPEC.md` §1, with its text, its date and its successor.
- Keep a retired code's tick.
- Ask the user before retiring. Never retire on your own.

## Code

- Store money as integer cents. Floating point is forbidden.
- Derive balances from movements. Never store them in a column.
- Derive the transaction type from the accounts involved.
- Revoke ALL from `anon`, `authenticated` and `service_role` in every migration that creates a table. Supabase grants them at `CREATE TABLE`.
- Prove a policy fires. Never assert it from the migration.
- Count round trips to Postgres, not queries. Every one pays the full latency to the pooler.
- Settle the session in one statement. Never one statement per `set_config`.
- Fan a screen's queries out with `Promise.all`, the fund guard included. Never chain the awaits.
- Validate on the server with the same Zod schema that validates the form.
- Move every interface string into next-intl. Hardcoding is forbidden.
- Compose a screen from `components/ui` and its props. Never write a utility class outside it.
- Add a prop to the primitive when a screen needs a variant. Never patch one from outside.
- Write interface text a person acts on. Cut text that only explains.
- Install only from §4. Discard the do-not-install list.
- Leave `apps/voyager/.env.local` alone. It is gitignored, it never ships, and its keys are not
  rotated on an agent's initiative. Decided by the user 2026-09-08. Do not raise it again.
- Write code and identifiers in English. Write user-facing copy in the user's language.

## Comments

- Say what the code does not. Skip the rest.
- Keep them to one idea. A wrapped line is still one.
- Never restate the line below.
- Never log a change, a date, an author or a ticket.

## Writing skills, agents and this file

- Command in verbs. Cut the rationale.
- Cut every sentence that does not change what someone does.
- List. Never paragraph.
- State the rule. Avoid the conditional.
- Keep it short enough to read once.
