# Reading dictionary — specification

> **For the implementing agent:** section 1 is the contract and section 4 fixes
> the stack. If something is not in section 1, it does not get built. This
> document makes no implementation decisions: how each requirement is satisfied
> is decided at implementation time, as long as the non-functional requirements
> hold.

---

## 1. Specification

### Context

A person reads English on paper and hits a word they do not know. The phone is
already in the other hand. The app is a dictionary that remembers: it is opened
mid-sentence, typed into, read, and closed, dozens of times in one sitting, on a
bus or in a bed, often with no connection.

The central unit is the **headword**: an English entry with its senses, its part
of speech, its IPA and its Spanish translations. The dictionary is shipped with
the app and installed onto the device, so that looking a word up is a local
lookup and not a request.

A whole sentence is a second, rarer path. It is translated by the device when
the device can, and over the network when it cannot.

Interface language: Spanish. Source language of the dictionary: English.

### Scope

This slice is the box and the answer: look a word up, look a sentence up, and
have the dictionary on the device.

**Out of scope:** books, reading sessions, spaced repetition and notes. None of
this gets built, and no schema, table or column is "prepared for" it.

### Functional requirements

#### The box

- [ ] **RL-01** — The app opens on one search box. It has focus, it sits in the thumb's reach, and it answers as the person types.
- [x] **RL-02** — The box takes a word or a whole sentence. The person never picks a mode and never sees one.
- [x] **RL-03** — The typed string is looked up whole in the local dictionary first, so a multi-word entry such as `give up` answers as a word. It is treated as a sentence only when that lookup misses **and** the string has more than one token.

#### The word

- [ ] **RL-04** — A headword's answer shows every sense the dictionary carries for it, grouped by part of speech, each with its IPA when one exists and all of its Spanish translations.
- [x] **RL-43** — Those groups are ordered by how often the word is really used in each part of
  speech, not by a rank fixed in advance. `grudge` answers as «rencor» before its rare verb, and
  `leave` still answers as «dejar» before «permiso» — an order no single rank can give both. The
  frequency is a table built once, read on the device, and never a request: the answer stays whole
  and offline (RL-35). A headword the table has no row for keeps the rank it has today.

  **The table is derived from SUBTLEX-US with part-of-speech information, which is CC BY-NC-SA 4.0.**
  Taken by the user 2026-09-11, knowing what it binds: the credit is shown on `/cuenta` beside the
  dictionary's own, the derived table carries the same licence, and the app stays non-commercial
  while it ships. Measured that day: 4,650 of 58,946 headwords carry more than one part of speech,
  SUBTLEX covers 3,888 of them, 2,681 can be ordered, and **1,797 of those 2,681 — 67.0% — are in
  the wrong order today**. That figure is the generator's own, printed by `npm run pos:build`; a
  prototype run the day the decision was taken said 1,808, and the eleven-row gap is headwords whose
  two parts of speech are used equally often, where nothing defines which wins. The shipped table is
  54.4 KB, 11.6 KB compressed, against a 8.2 MB dictionary.

  **Driven, not asserted, 2026-09-12** against the running app with the decoration routes stubbed:
  `grudge` draws SUSTANTIVO «rencor, manía, ojeriza» before VERBO, and `leave` draws VERBO «dejar,
  abandonar…» before SUSTANTIVO «permiso, excedencia…» — the two opposite orders this code's own
  text claims, out of one table. The table was already wired through `groupFor`
  (`lib/dictionary/index-build.ts:101`) and credited at `/cuenta`; only the tick was missing.

  **What it cannot do, measured the same day.** The order is a corpus's, so it is wrong wherever the
  reader's book disagrees with film subtitles. `creep` is scored `"nv"` and draws its noun group —
  «deformación por fluencia lenta, fatiga, alimaña, degenerado» — above «reptar, hormiguear», to a
  reader in *Animal Farm*. Four more did the same: `shriek`, `frost`, `toil` and `stern`. **RL-47's
  suffix clause is what answers those**, from the device and with no table at all, because an `-ing`
  can only be a verb and an `-ly` can only come from an adjective. See `DESIGN.md`, "Pruning the
  dictionary was measured and refused".
- [x] **RL-47** *(successor of RL-40)* — The form the reader typed leads the answer with its own
  translation and one example sentence, resolved over the network when the dictionary has no row for
  the form itself. The headword it inflects from sits **underneath**, named as such, with its own
  sense groups: `swishing` answers «silbando» and offers `swish` under it. An exact entry the reader
  typed on purpose still wins the top of the screen: `bed` answers as `bed` and offers nothing.
  **When the form's suffix pins a part of speech — only a verb takes `-ing` or `-ed`, only an
  adjective takes `-ly` — that group leads the headword's own, ahead of any frequency order.** It is
  answered from the device and touches the network on no keystroke.
  - Measured 2026-09-10 by `apps/voyager/scripts/check-dictionary.ts`: **D7 back to 53/53** from the
    34 that `#128` left, and **D12 new — 27 candidates carried a defect before the filter, 0 after**.
    The filter is two rules, both driven against the shipped asset: a one-letter lemma is not a lemma
    (`bed` → `b`), and a regular suffix rule loses to `IRREGULAR_FORMS` where the table governs that
    category (`bed` → `be`, whose real past is `was`/`were`). Matched by rule family, not blindly:
    `running` → `run` survives, because `-ing` has no irregular family to lose to even though `run`
    is in the table for `ran`.
  - Driven, not asserted: `bed` answers with its own entry and offers nothing; `left` offers `leave`,
    `faster` offers `fast`, `gone` offers `go`, `women` offers `woman`, `people` offers `person`.
    `word` offers nothing, so an answered query gains no clutter.

- [ ] **RL-48** — A search that found nothing is recorded like any other the reader settled on, so the
  record holds what the dictionary could not answer and not only what it could. The same settling rule
  governs it: a word half-typed is never a row.
- [ ] **RL-07** — Autocomplete appears only while the string is being treated as a word. A sentence never raises it.
- [x] **RL-26** — A headword's answer can be heard. The device speaks it with the voice the browser
  already carries, so a headword with no IPA is spoken exactly like one that has it. Decided by the
  user 2026-09-08: **27,899 of the 64,258 entries carry no IPA at all** (36,359 do), and written
  transcription therefore answers barely half of them. Nothing is downloaded and nothing is
  recorded — no audio file ships with the dictionary and none is fetched.
- [x] **RL-18** — While the string is being treated as a word and the typing has not settled, up to
  ten headwords that begin with it are offered. Choosing one answers it. The offer withdraws once
  the typing settles: the answer is already on screen and the list has nothing left to add.
- [ ] **RL-35** *(successor of RL-14)* — The answer to a word comes whole from the device and never
  waits on the network: with a connection or without one, the same text appears at the same speed,
  and no keystroke ever leaves the device. What the network can add afterwards is decoration: it
  arrives late, arrives only sometimes, and its absence never changes the answer or delays it.
- [ ] **RL-41** — A word whose dictionary entry carries **no definition at all** can be given one
  over the network: one English sentence, in the dictionary's own register. **12,670 of the 64,258
  entries (19.7%) carry none** — 6,989 nouns, 2,664 verbs, 2,098 adjectives — and today those words
  answer with translations alone. It is **decoration under RL-35**: it is resolved the first time
  someone looks that word up, never in a pass over the dictionary, it is cached so a word costs once
  for every reader ever, and with no connection the answer is exactly the one the device already
  draws. A word that already has a definition never asks for one.

- [ ] **RL-42** — A word can carry **one example sentence using it**, with its Spanish translation,
  resolved and cached the same way and under the same decoration clause. This is not RL-08's path:
  RL-08 translates a sentence the reader typed, this shows the word in use.

  **The daily cap is the on-switch, not just a limit.** `WORD_TEXT_DAILY_CALL_CAP` is optional, and
  left unset the route answers `204` to every cold word: generated text is off until a number is set.
  **That number is 500, raised from 50 by the user 2026-09-11.** Measured against a real reading
  session: ~76 calls in 43 minutes, so 50 emptied mid-chapter. It bounds distinct new words per day, not
  words lacking a definition — the example generates for every word looked up, so a word that already
  has a definition still costs one call. A cap that bites costs nothing: the reader gets the screen
  RL-35 already draws. `WORD_PHOTO_DAILY_CAP` is the opposite by design — left unset it means no
  limit, which is right because Openverse is free.

- [ ] **RL-36** — The answer to a concrete noun can carry an image, requested as the answer draws and
  only with a connection. The image never blocks or delays the answer; offline, with no result, or on
  failure, the answer draws just the same, with no gap left for it. The image comes from Openverse, a
  search over permissively licensed photos, and the request no longer goes straight from the device to
  a party of its own: it passes through a route handler of this app's own, the shape RL-09 already
  uses for the sentence path, and the bytes it returns are re-served from storage this app owns. The
  price moves with it: the image's original host stops seeing which word a reader looked up or from
  which address, and this app's own server starts — once per word, because the result is cached for
  every reader after the first. Each image's author, licence, licence link and source stay attached to
  it and are credited by file in `/cuenta`, next to RL-33's own credit.

  **«Concrete noun» is a test the code runs, not a phrase in this line.** Written 2026-09-11, after
  the reader hit `grudge` and got a photograph of someone underwater. The headword must carry a noun
  sense **and** score at least 3.0 for concreteness; a headword with no concreteness score is asked
  for no image at all. Absence is already a screen this app draws, so a word with no photo costs the
  reader nothing. Measured that day against the live Openverse and the built index: of 36 headwords
  probed, concrete nouns came back relevant **12 of 12**, abstract nouns **2 of 12**, non-nouns
  **6 of 12** — 55.6% overall. A noun-only filter buys almost nothing, because **12 of the 12
  abstract headwords probed carry a noun sense too**; concreteness separates them cleanly, every
  concrete probe scoring 4.58 or above and every abstract one 2.37 or below. The scores come from
  Brysbaert, Warriner and Kuperman's 40,000-lemma norms, which cover 14,533 of the dictionary's
  37,429 noun headwords, so at the 3.0 threshold an image is possible for **9,942 headwords — 16.9%
  of the dictionary** rather than all of it. **That source states no licence**, unlike SUBTLEX-US in
  RL-43; the user took it knowingly on 2026-09-11 and it is credited in `/cuenta` all the same.

#### The sentence

- [ ] **RL-08** — A sentence is translated by the device's own translator when the browser offers one and it is ready. Whether it does is asked of the browser at runtime, on every open, and never inferred from the browser's name or version.
- [x] **RL-09** — When the device offers no translator, the sentence is translated over the network, and the answer says the translation came from the network. *This is a server surface and the sentence path's own exception to "no backend": one route handler that holds the provider's identity and any key it needs off the client and makes the provider a one-file change. Nothing on the word path passes through it, ever.*
- [ ] **RL-10** — While the device's translator is downloading what it needs, the interface says so and the box stays usable.
- [x] **RL-11** — When the device has a translator that is not yet installed, that sentence is translated over the network and a single control offers to install the translator. Activating that control is what starts the download; every sentence after it is translated on the device. A person who never activates it keeps getting network translations and is never blocked.

#### The payload

- [ ] **RL-12** — The dictionary is fetched once, as a static asset, and installed onto the device. Its progress is shown and the box stays typeable throughout.
- [x] **RL-13** — An interrupted install leaves no partial dictionary. The next open finds the dictionary whole or absent, never in between, and starts it again from zero.
- [x] **RL-33** — The dictionary's source, its edition and its CC BY-SA 3.0 licence are named in an
  information tab inside `/cuenta`, linking to the source and to the licence text, and stating that
  what the app ships is a reformatted extract distributed under the same licence. CC BY-SA 3.0
  conditions the credit on it staying reachable by whoever uses the work, so the tab reads without
  signing in — `/cuenta` already renders with no session, and that is what keeps it reachable.

#### The shell

- [ ] **RL-16** — The app opens with no connection and shows its box, and it can be launched from the phone's home screen without a browser around it. This holds from the second time it is opened onwards: the first open needs the network to deliver the app itself.
- [x] **RL-39** *(successor of RL-38)* — A lookup a reader settles on is recorded on the device,
  from the app's first day, only when it found something: what was typed, whether it was answered as
  a word or a sentence, the headword it actually reached when an inflected form was typed, and when.
  A word that matched nothing and a sentence that could not be translated leave no row — neither had
  an answer to record. The record gains rows on its own and nothing edits one, but the reader can
  empty it whole: on this device alone, or in the copy their account holds as well. Emptying this
  device alone leaves the account's copy standing, and a device that signs in afterwards sees it
  again. No screen on the read path shows the record. It is read to take it off the device — to a
  file, or to the copy held by the reader's account — and to bring back what the same reader's other
  devices recorded; never on the path that answers a lookup. Decided by the user 2026-09-10.
- [x] **RL-22** — A reader can keep their record in an account of their own: they sign in through a
  link sent to their address and, from then on, what this device records is copied to that account
  and what their other devices recorded comes down to this one **and stays in its local record,
  beside its own**. It is a copy: a lookup is still answered from the device, with an account or
  without one, online or offline.
- [x] **RL-24** — The copy never edits a row. A row names the device that recorded it and the number
  it carried there, so copying it twice does not duplicate it, going up or coming down, and what one
  device copies never overwrites what another wrote. An interrupted merge leaves the record whole in
  every sense that matters: what came down is valid, what did not comes down next time.

  The only thing it deletes is retiring a device, and it deletes exactly this: the searches that
  device had copied leave the copy, and that device stops syncing. **What had already come down to
  another device stays on that device**, and leaves it by clearing the app's data in that browser.
  The app says this before confirming and promises no more.
- [x] **RL-25** — The reader sees the list of devices that have copied to their account: which one is
  in their hand, when each was last seen, and how many searches it has copied. They can retire any of
  them, their own included.
- [ ] **RL-30** — With an account open on the device, the copy starts on its own and is never asked
  about: it sends up what this device already had and brings down what the others recorded, with no
  act from the reader and no switch that turns it off. Signing out is the only way to stop it. With
  no account, nothing leaves the device.
- [x] **RL-32** — The reader reads their record grouped by word: one row per word, with how many
  times it was searched, ordered by frequency, case-insensitive; and tapping a word opens every one
  of its searches with its date. This replaces the chronological list.
- [x] **RL-34** — The record keeps, for every lookup, the word, its translation cut to 120
  characters and at most 3 senses, and how the answer was reached; and the reader reads it inside
  the app.
- [x] **RL-20** — The log can be exported from the app as a single file the reader saves onto their
  device: every recorded search, with its date and the headword it reached, in a documented and
  versioned shape. The export is deliberate: it is reached from outside the search screen and
  nothing triggers it on its own.
- [ ] **RL-27** — A local server, which the reader starts on their own machine, offers the exported
  file to an MCP client: the most looked-up words, the most recent ones, and the full history of one
  word. It only ever reads the file; no tool modifies it. The server is not part of the deployed app.
- [ ] **RL-28** — When a search finds nothing and the word looks like a typo of one the dictionary
  has, the answer offers the words it might have been, and reaching one of them is a tap. The
  suggestion is computed on the device and touches the network on no keystroke.
- [x] **RL-44** *(successor of RL-29)* — When a search finds nothing, the word is answered over the
  network on its own, and the reader asks for nothing. A suggestion RL-28 finds is offered above it
  and never instead of it: `whereat` offers `whereas` and still answers `whereat`. The answer carries the
  word's translation, its definition and one example sentence with its Spanish translation. It says
  it did not come from the dictionary, and says plainly when it could not be produced. A hyphenated
  string the dictionary has no entry for reaches this answer like any other word.
- [x] **RL-45** — A dictionary answer that is thin — at most four translations, and either more than
  one sense or no definition at all — is completed over the network. What arrives is
  added underneath what the dictionary said and marked as coming from the network; it never replaces
  it. What counts as thin is measured over the shipped index, not asserted.
- [x] **RL-46** — A sentence answered by translation also names the terms in it that are not obvious
  and says what they are. The app picks which terms earn a note; a note on every word is RL-31's
  answer, not this one.
- [ ] **RL-31** — A string of more than one word that the dictionary has no entry for, and that is
  not treated as a sentence, never gets silence: the app names what it did not find and offers,
  underneath, the dictionary's own answer for each of its words. It answers from the device, and
  touches the network on no keystroke.
- [x] **RL-37** — A sentence the app cannot translate gets the same answer a string it never tried
  to translate gets: the app names what it could not answer and offers, underneath, the dictionary's
  own answer for each of its words. This replaces the notice that only said the translation failed —
  a reader who typed a sentence and got nothing back now gets the dictionary's own words instead.
  It answers from the device, so it holds with no network at all.

### Non-functional requirements

- [x] **RNL-01** — A word lookup answers in under 10 ms with the dictionary installed.
  - **What the 10 ms measures, settled 2026-09-07 before module 22 was written:** the lookup itself —
    the worker round trip, from the message posted to the answer received. Measured that way against
    the live app: p50 0,10 ms, p95 0,30 ms, max 1,30 ms over 200 sequential lookups.
  - Keystroke to painted answer is a **different and larger** number — p50 17 ms, p95 41 ms measured
    through Playwright — because it also carries React's render and commit and the driver's own
    dispatch. It is recorded here so nobody reads one number and cites the other. This requirement
    governs the first; no assertion anywhere enforces the second.
- [ ] **RNL-02** — Every string a person reads comes from the message catalogue. The interface is Spanish.
- [ ] **RNL-03** — The app holds at a 360 px viewport: no horizontal overflow, no overlapping control, no tap target under 32 px on its shorter side. It is used one-handed, standing, holding a book. It also holds at a wide viewport: the reading column keeps a maximum measure and centres, so at 1440 px the box and the answer read as a column rather than stretching the full width. The phone is the case the app is designed for; the desktop is the case it must not look neglected in.
  - Widened 2026-09-07 from the 360 px case alone. The code was unticked and nothing had been verified against it, so no tick is invalidated; the alternative was retiring it for a successor, which buys nothing here.
- [x] **RNL-04** — The dictionary asset is built from its source by a script kept in the repository, and the build records the source URL, the edition, the licence and the entry counts beside the asset.
- [x] **RNL-05** — The sentence path never fires on a keystroke: it waits for the typing to settle, does not fire below a minimum number of tokens, never fires twice for the same text, and cancels a request already in flight when the text changes. The word path is never throttled and never delayed.
- [x] **RNL-06** — Recording a lookup never delays, blocks or fails a lookup. The write is never awaited on the path that produces an answer, a failure to write is swallowed, and the log's storage is a separate database from the dictionary's, so a write can never contend with a read of the payload.
- [ ] **RNL-07** — The reader chooses light or dark, and the choice is remembered on the device. The app opens in the system's mode until a choice is made. Dark is the design's primary look; light is the same design inverted, and both carry the palettes in `docs/voyager/DESIGN.md`.
- [x] **RNL-08** — Exporting never touches the read path: building the file happens on a screen that
  is not the box, mounts no dictionary Worker, and with the export never opened the app behaves
  exactly as before.
- [ ] **RNL-09** — The copy is never on the read path: **with no account turned on the app opens not
  one connection, and the box still opens, focuses and answers the same**; with the box in view not
  one request leaves while typing; the copy fires only when the tab is hidden or when the reader asks
  for it; and a lookup answers in the same time with a ten-thousand-row merge in flight as without
  one.
- [x] **RNL-10** — A reader's record is read and written by that reader alone. The access policies in
  the database decide it, not the query, and they are proved by driving them. No service path evades
  them.

### Retired

Dead codes. The number stays burned and the tick stays as it was.

- [x] **RL-40** — An inflected form resolves to its headword, and the answer names both the form
  typed and the headword reached: `went` finds `go`, `children` finds `child`, `studies` finds
  `study`. When the form typed is itself a headword, its own entry answers first and the headword it
  also inflects from is **offered below it, never instead of it**: `left` answers as «izquierda» and
  offers `leave` under it. Board: `PalabraConFlexion`.
  - Measured 2026-09-10 by `apps/voyager/scripts/check-dictionary.ts`: **D7 back to 53/53** from the
    34 that `#128` left, and **D12 new — 27 candidates carried a defect before the filter, 0 after**.
    The filter is two rules, both driven against the shipped asset: a one-letter lemma is not a lemma
    (`bed` → `b`), and a regular suffix rule loses to `IRREGULAR_FORMS` where the table governs that
    category (`bed` → `be`, whose real past is `was`/`were`). Matched by rule family, not blindly:
    `running` → `run` survives, because `-ing` has no irregular family to lose to even though `run`
    is in the table for `ran`.
  - Driven, not asserted: `bed` answers with its own entry and offers nothing; `left` offers `leave`,
    `faster` offers `fast`, `gone` offers `go`, `women` offers `woman`, `people` offers `person`.
    `word` offers nothing, so an answered query gains no clutter.
  _Retired 2026-09-11. Successor: RL-47. Its lemma resolution and its one-letter and irregular-family
  filters all survive; what changed is the order. Measured in production that night: `swishing`
  answered `swish` · ADJETIVO · «sofisticado, refinado», and `sternly` answered `stern` ·
  SUSTANTIVO · «popa». The exact entry winning the top is right for `bed` and wrong for a form that
  is only a form, and RL-40 could not tell the two apart. The `bed` half is written into RL-47._

- [ ] **RL-29** — When a search finds nothing and no suggestion fits, the reader can ask for the word
  to be answered over the network, and only by asking: nothing is sent until they do. The answer says
  it did not come from the dictionary, and says plainly when it could not be produced.
  _Retired 2026-09-11. Successor: RL-44. Never built. The reader measured the dead end in production
  the night of the deploy — `whereat`, `coccidiosis`, `mangels` and `milk-pails`, four real words,
  none of them a typo — and took the control out: the answer comes on its own. The half that says
  the answer did not come from the dictionary, and says plainly when it failed, survives in RL-44._

- [x] **RL-06** — An inflected form resolves to its headword, and the answer names both the form typed and the headword reached: `left` finds `leave`, `went` finds `go`, `children` finds `child`, `studies` finds `study`.
  - Measured 2026-09-07 by `apps/voyager/scripts/check-dictionary.ts` (D9), over a sample of 2,345 regular surface forms generated from 301 stride-sampled single-word letter headwords by applying the regular suffix rules, plus all 386 `IRREGULAR_FORMS` surfaces: the real coverage figure is the **irregular-only rate, 367/386 = 95.1%**, the only non-circular signal since those surfaces come from a hand-written table no rule can reach. The generated forms resolve at 2345/2345 = 100.0%, a closed loop that proves the resolver inverts its own suffix rules, not real coverage. Blended (generated + irregular together, the number that includes the closed loop): 2712/2731 = 99.3%.
  _Retired 2026-09-10. Successor: RL-40. `#128` stopped guessing at a word the dictionary already
  carries, which was right for `bed` — it was drawing «"bed" es una forma de "b"» — and wrong for
  every surface form that is also a headword. Measured that day: **19 of the 53 `INFLECTION_FIXTURE`
  pairs stopped resolving** and `check:dict`'s D7 sat red on `integracion` for a day, unseen because
  `check:dict` was not in CI. The reader of «he ran faster» was answered «ayunador»; of «he has
  gone», «ido, ha muerto»; of `women`, «Femenil». RL-40 keeps the exact entry first and puts the
  inflection back underneath it._
  _Its D9 numbers above are what 2026-09-07 measured and are kept as that. Read today they differ —
  generated 1881/2345 = 80.2%, blended 2248/2731 = 82.3%, irregular unchanged at 95.1% — and **that
  drift is not `#128`'s**: the three figures come out identical with and without its line. Whatever
  moved them is older and unfound. RL-40 takes no number from here; it measures its own._

- [x] **RL-38** — A lookup a reader settles on is recorded on the device, from the app's first day,
  only when it found something: what was typed, whether it was answered as a word or a sentence, the
  headword it actually reached when an inflected form was typed, and when. A word that matched
  nothing and a sentence that could not be translated leave no row — neither had an answer to record.
  The record only ever gains rows: nothing edits or deletes one. No screen on the read path shows it.
  It is read to take it off the device — to a file, or to the copy held by the reader's account — and
  to bring back what the same reader's other devices recorded; never on the path that answers a
  lookup.
  _Retired 2026-09-10. Successor: RL-39. The reader's own way to empty the record, decided the same
  day, is the reason "nothing edits or deletes one" stopped being true._

- [x] **RL-14** — Once installed, looking a word up touches the network in no way, on no keystroke.
  _Retired 2026-09-08. Successor: RL-35. The word's image (RL-36), decided the same day, is the
  reason this stopped being true: it reaches the network as the answer draws._
- [x] **RL-19** — Every lookup a reader settles on is recorded on the device, from the app's first
  day: what was typed, whether it was answered as a word or a sentence, the headword it actually
  reached when an inflected form was typed, whether it found anything at all, and when. The record
  is append-only. It is read back only where the reader asks for it — to carry the words they looked
  up into practice, or to take them off the device — and never on the path that answers a lookup. _Retired 2026-09-08. Successor: RL-21._
- [ ] **RL-05** — While the string is being treated as a word, up to ten headwords that begin with
  it are offered. Choosing one answers it. _Retired 2026-09-07. Successor: RL-18._
- [x] **RL-17** — Every lookup a reader settles on is recorded on the device, from the app's first
  day: what was typed, whether it was answered as a word or a sentence, the headword it actually
  reached when an inflected form was typed, whether it found anything at all, and when. The record
  is append-only and nothing in the interface shows it. _Retired 2026-09-07. Successor: RL-19._
- [ ] **RL-23** — Turning the copy on in a device sends up the record already there and brings down
  what the reader's other devices recorded. The reader knows both figures before anything happens:
  they are told how many searches will go up and how many will come down, and turning it on is what
  authorises it. _Retired 2026-09-08. Successor: RL-30._
- [x] **RL-15** — The dictionary's source, its edition and its CC BY-SA 3.0 licence are named in the interface, one tap from the box, linking to the source and to the licence text, and stating that what the app ships is a reformatted extract distributed under the same licence. _Retired 2026-09-08. Successor: RL-33._
- [x] **RL-21** — Every lookup a reader settles on is recorded on the device, from the app's first
  day: what was typed, whether it was answered as a word or a sentence, the headword it actually
  reached when an inflected form was typed, whether it found anything at all, and when. The record
  only ever gains rows: nothing edits or deletes one. No screen on the read path shows it. It is read
  to take it off the device — to a file, or to the copy held by the reader's account — and to bring
  back what the same reader's other devices recorded; never on the path that answers a lookup.
  _Retired 2026-09-09. Successor: RL-38._

---

## 2. Model and invariants

### The source

The dictionary is one published edition of one published file. These are
measurements taken from it, not estimates:

| Fact | Value |
|---|---|
| Source | `https://download.freedict.org/dictionaries/eng-spa/2025.11.23/freedict-eng-spa-2025.11.23.src.tar.xz` |
| Format | TEI XML |
| Edition | 2025.11.23 |
| Licence | CC BY-SA 3.0 |
| Entries carrying a Spanish translation | 64,258 |
| Distinct normalised headwords | 58,944 |
| Entries carrying IPA | 36,359 |
| Multi-word entries | 16,112 |
| Extracted payload | 8,389,666 bytes = 8.0 MiB raw, 2.9 MiB gzipped |

Every figure in this table is read from `apps/voyager/public/dictionary/manifest.json`, which the
build writes beside the asset. Re-read it after a rebuild; do not carry a number forward. Corrected
2026-09-09, when four of them had drifted from the shipped asset: headwords 58,946 → **58,944**,
entries with IPA 36,320 → **36,359**, entries without 27,938 → **27,899**, and a payload written as
«8.2 MB» that is neither 8.39 MB nor 8.00 MiB.

The 16,112 multi-word entries are why RL-03 looks the whole string up before it
counts tokens: `give up` is a headword, not a sentence.

### Invariants

Rules the model must always guarantee, regardless of how they are implemented:

- The dictionary is data, never state. Nothing the reader does mutates it.
- A headword is a group of senses, never a row. Its senses, its parts of speech,
  its pronunciations and its translations answer together or not at all.
- A word's answer never touches the network (RL-35). Its image, its definition and its example
  (RL-36, RL-41, RL-42) do, and only with a connection: decoration, never a condition of the answer.
  That request goes to a route handler of this app's own, never straight to a party of its own.
- The payload is installed whole or not at all. There is no partial dictionary
  a lookup could read from.
- The interface never asserts a browser capability it has not asked for at
  runtime.
- The device holds exactly one copy of the payload.
- The record only ever gains rows, on the device and in the copy alike. A row is identified by the
  device that wrote it and the number it carried there.

---

## 3. Architecture

A Next.js application whose data lives on the device.

Principles, not recipes:

- **The read path has no backend for its text.** The dictionary ships as a static asset and is read
  locally; a word's answer touches the network on no keystroke (RL-35). The app has three server
  surfaces and none of them is on that path: the sentence translation (RL-09); the copy of the
  reader's record — its sync, its wipe and the devices that hold it (RL-22, RL-25) — which runs on the
  same Supabase as `apps/orbit`, in a schema of its own, and only once the reader opened an account on
  purpose; and the word's decoration (RL-36, RL-41, RL-42), which reaches the network only after the
  text is already drawn and never changes or delays it. With no account, nothing of the reader's
  record leaves the device (RNL-09); the decoration reaches the network with or without one, because
  it is not the reader's record.
- **A word's image, its definition and its example are the things on that path that do reach the
  network** (RL-36, RL-41, RL-42), and each now goes through a route handler of the app's own, not
  straight to a party of its own. Decided by the user 2026-09-10, reversing the direct-to-a-third-party
  design this file carried until then: hiding the request behind a route of the app's own is exactly
  what RL-09 already does for the sentence path, and it is what keeps a third party from learning
  which word a reader is looking up. Both requests reach the network only as the answer draws and only
  with a connection, and neither blocks or delays the text.
- **The server surface is five route handlers and one page, and nothing else.** It becomes seven
  when RL-36, RL-41 and RL-42 land: those three are unticked, and the two handlers they need are
  **not written yet** — do not read the list below as though they were. Rewritten 2026-09-10, when
  the decoration slice claimed two more and the count turned out to have been short one all along:
  `app/api/log/clear/route.ts` existed and had never been listed.
  - `app/api/translate/route.ts` — the sentence path (RL-09). Justified by two things a client
    cannot do: keep the provider's identity and key off the client, and make swapping the provider a
    one-file change.
  - `app/api/log/sync/route.ts`, `app/api/log/clear/route.ts` and `app/api/devices/route.ts` — the
    copy of the reader's record, its wipe, and the devices that hold it (RL-22, RL-25). They answer
    **only** a request that carries a session the reader opened on purpose; with no account they
    answer 401 without opening a connection.
  - `app/auth/confirm/route.ts` — landing the sign-in link (RL-22).
  - `app/api/word/photo/route.ts` and `app/api/word/text/route.ts` — the word's decoration (RL-36,
    RL-41, RL-42): an image, a definition for the entries that carry none, and an example sentence.
    Neither answers with a session, both cache what they resolve, and both answer with nothing rather
    than a provider's own error on any failure.
  - `app/cuenta/page.tsx` — a server component that reads the session and queries nothing.
- **The word's text never passes through any of them.** That is the claim "no backend" actually
  protects, and it is the one to check before adding an eighth: not how many handlers exist, but
  whether the answer's text still touches none of them (RL-35, RNL-09). The word's decoration — its
  image, its definition and its example (RL-36, RL-41, RL-42) — does touch two of them, but only once
  the text already stands on its own: it arrives late, arrives only sometimes, and its absence never
  changes or delays the text it decorates.
- **A local MCP server (RL-27) is not part of the deployed app.** It is a
  script the reader runs on their own machine, over the file `/registro`
  exported (RL-20), never over the deployed app's network. It does not
  contradict "there is no backend": nothing about it ships, runs on Vercel,
  or answers a request from a browser.
- **IndexedDB is the durable payload cache.** It is the only store with the
  volume for 8.0 MiB and the transaction boundary RL-13 needs to make the install
  whole-or-nothing.
- **A Worker is the query engine.** The dictionary is parsed and searched off
  the main thread, so that RNL-01 and RL-01 hold on the same keystroke.
- **A service worker caches the shell**, and only the shell: everything except
  the payload and the translate route. The payload has its own store and its own
  progress; the route must never answer from a cache.

---

## 4. Stack

| Need | Choice | What it saves |
|---|---|---|
| Framework | **Next 16.3.3** | Routing, the static export of the payload, and the one route handler the sentence path needs. |
| UI | **React 19.2.8** | The version Next 16.3.3 pairs with. |
| Language | **next-intl 4** | The Spanish catalogue RNL-02 requires, with date and number formatting. |
| Validation | **Zod 4** | One schema serves the translate route's input and its types. |
| Components | **Radix Themes 3** | Layout, typography, controls and theming as components with props, one stylesheet, no build step. |
| Icons | **lucide-react** | An icon set, chosen independently of the component library. |
| Types | **TypeScript**, with **@typescript/native-preview** | `tsgo` checks the project in seconds. |
| Lint | **eslint**, with **eslint-config-next** | The rules the framework's own conventions need. |
| Browser verification | **Playwright** | Drives a real browser for the facts no server-side check reaches: the offline open, the install progress, the 360 px viewport and the tap targets. |
| Postgres | **postgres 3 + drizzle-orm 0.45** | The copy of the record over the Supabase orbit already has, with the same client and the same ORM. |
| Migrations | **drizzle-kit 0.31** (dev) | The `reading` schema versioned in the repository, with a migration journal of its own. |
| Auth | **@supabase/ssr 0.12** | The cookie session and the magic link, with the same claim verification orbit uses. |
| TEI parse | **fast-xml-parser** | Streams the source TEI into the payload; the build script's only dependency. |

Playwright and `fast-xml-parser` are development dependencies. `fast-xml-parser`
is build-time only: it runs in the script RNL-04 names and never reaches the
bundle.

### Do not install

| Library | Use instead |
|---|---|
| Any client-side database or ORM | IndexedDB directly: the payload is one store, read-only after install. |
| Tailwind, shadcn/ui | Radix Themes is the system. |
| Zustand / Redux | State is one worker and one hook. |
| `localStorage` for the payload | IndexedDB: 8.0 MiB does not fit and would not survive. |
| A wrapper library around IndexedDB | The store is 80 lines. |
| Workbox, or any service-worker framework | The worker is 80 lines, and caching a hashed build output needs no library. |
| Any NLP or stemming package | The inflection module is 200 lines and a table. |
