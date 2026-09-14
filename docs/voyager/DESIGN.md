# Reading app — design guide

Governs `apps/voyager` alone. `docs/DESIGN.md` governs `apps/orbit` and does not apply here.
Approved by the user 2026-09-07 from the canvas in `private/design-lectura/`.

## The direction: Impreso

- Dark is the primary look. Light is the same design inverted, not a second design.
- Set the ground in warm near-black, never neutral grey. It reads as ink on paper; a neutral grey
  reads as a generic dark app.
- Lead with the English headword. The entry fits at once.
- Rule between senses with a hairline. Never a card, never a border box.

## Tokens

Dark, the primary:

| role | value |
|---|---|
| ground | `#14130F` |
| raised (the box, a chip) | `#1C1B16` |
| line | `#2A2820` |
| border | `#302E25` |
| ink | `#F0EBDD` |
| ink, secondary | `#E6E0D0` |
| muted | `#9A9484` |
| muted, quietest | `#6C6759` |
| accent | `#D9805F` |

Light, the same design inverted:

| role | value |
|---|---|
| ground | `#FAF8F2` |
| raised | `#FFFFFF` |
| line | `#E4DFD2` |
| border | `#DED8C8` |
| ink | `#17160F` |
| muted | `#6B675A` |
| muted, quietest | `#A5A093` |
| accent | `#9A3B24` |

- The accent is a different hex per mode, not one colour at two opacities. `#9A3B24` has too little
  contrast on the dark ground; `#D9805F` has too little on the light one.

## Type

- Headwords, translations and definitions: **Newsreader**, fallback `Georgia, serif`.
- Labels, metadata, controls and interface copy: **IBM Plex Sans**, fallback `system-ui, sans-serif`.
- Set a part-of-speech label at 11 px, 600, `letter-spacing: 0.12em`, uppercase, in the accent.
- Set a headword at 34 px / 500 / `-0.02em`. Set a translation line at 21 px / 1.5.

## Metadata labels

- Set a metadata label — where a translation came from, what kind of answer this is — in the same
  shape as a part-of-speech label (11 px, 600, `letter-spacing: 0.12em`, uppercase) but in **muted**,
  never in the accent. The accent names a part of speech; a second accented label competes with it.
- **Never a coloured badge.** A green chip for the device and a blue one for the network import two
  hues this design does not have and read as a status pill from another app. The origin is metadata:
  it sits under the translation as a quiet line, and the reader who does not care never notices it.

## What the data forces

Measured over the built asset, 64,258 entries. Design for these, not for the rare case.

- Senses per headword: median **1**, p90 1, p99 2, max 6.
- Translations per entry: median **1**, p90 4, max 25.
- With a definition: **80.3%**. With IPA: **56.6%** — the null IPA is the common case, not the edge.
- A typical answer is four lines. Design the one-sense answer first; let six senses degrade.
- Headwords reach **85 characters with no space to break on**. Every list of headwords truncates.
  `Button` pins `flex-shrink: 0`, so a `Text truncate` inside a flex row does nothing — clamp with
  `Grid`, whose `minmax(0, 1fr)` governs the item regardless.

## Viewport

- Build the narrow viewport first. RNL-03 is the requirement.
- Hold a 32 px floor on every tap target's shorter side. `TapTarget` owns it for a link.
- Centre the reading column above ~660 px and cap its measure at **620 px**. The phone is the case
  the app is designed for; the desktop is the case it must not look neglected in.
- **A bottom bar carries the sections on the phone; a sidebar carries them on the desktop.** Buscar,
  Registro, Cuenta — three either way, and neither surface ever holds an action, a filter or a count.
  Decided by the user 2026-09-08. The earlier reading of this line — bar at every width, over a
  sidebar — was taken about the phone and is not withdrawn there; the desktop was never the case it
  answered. **The bar becomes a sidebar at 1024 px.** Decided by the user 2026-09-08; see
  `## Settled`. This is a second breakpoint, distinct from the ~660 px the reading column centres
  above: a vertical tablet stays on the bar, and only a wide tablet or a desktop gets the sidebar.
  The bar ships with two of its three first; see `## Settled` for which and why.
- **The 620 px cap is a reading measure, not a page width.** It governs the screens that are prose —
  Palabra, Frase, Flexión, Sin resultado, Inicio, Instalando, Fallo, Sugerencias, Fuente. Registro,
  Cuenta and Dispositivos are a list and a set of controls: they take the width they need. Applying
  the reading measure to them wasted half the desktop and made the list harder to read, which is
  what this line exists to prevent.
- **Fuente is not a section.** RL-15 asks for the source, the edition and the licence **one tap from
  the box** — nothing more. It rides as a quiet muted link on the screens that carry the box, never
  as a fourth item in the bar: a credits page read once does not deserve the weight of Buscar.
- **What was here before, and why it was wrong.** This line used to read «Never a sidebar. A tab bar
  carries the sections… Inside Lectura the screen is still one box and one answer.» It arrived
  2026-09-07 in the commit that renamed the two apps — a rename, not a design decision. It forbade a
  sidebar, prescribed a tab bar **nobody ever built**, and named a section «Lectura» that exists in
  neither app. It was written as the negation of orbit's `docs/DESIGN.md:32`, which is the same
  cross-app borrowing `AGENTS.md` forbids, in reverse.

## Failure

- No error colour exists in this palette, and none should be added: a red pulled in from outside
  reads as a different app's alarm, not this one's ink.
- Mark a failure with what the design already has: a hairline above it to set it off from whatever
  state came before, the failure line in full-weight **ink** (never muted, never the accent — a
  failure is not metadata), and the retry action in the ordinary accent-coloured button. The accent
  the reader already reads as "act here" carries the recovery; the weight and the hairline carry the
  break.

## The canvas, and which of its boards are stale

- The approved direction is **Impreso**, in dark as the primary look. The tokens above are its warm
  inversion, not a second design.
- **The five `Noche*.dc.html` boards are gone.** They were the losing direction — Archivo over
  Newsreader, a cool `#0E0F12` ground over the warm `#14130F`, an amber `#E0A458` accent over
  `#D9805F`, and cards this design forbids — and the canvas dropped them when it was rebuilt on
  2026-09-07. Checked 2026-09-08: the published canvas contains the string `Noche` zero times.
  Nothing on it contradicts this file any more.
- When a board and this file disagree, **this file wins**.
- **The canvas is 142 boards**, counted 2026-09-12 from **version 33**'s own `appifact-doc` block
  (143 `.dc.html` files plus `canvas.json`). The one added is RL-44's fourth state,
  `SinResultadoIASinDefinicion`, on the primary face and with no second face.
- **The canvas was 141 boards**, counted 2026-09-11 from **version 32**'s own `appifact-doc` block
  (142 `.dc.html` files, of which `Main.dc.html` is the entry, plus `canvas.json`). It was 135 at
  version 31; the seven added are RL-44's three, RL-47's two, RL-45's one and RL-46's one, all on the
  primary face and none with a second face.
- **Read the canvas by extracting it, never by reading the page in.** `action: "read"` prints a head
  that is the editor's own stylesheet and its base64 font — tens of thousands of tokens before a
  single board. **Saving to disk does not spare you that head: the tool prints it and saves the file,
  both.** Paid again 2026-09-12, with this warning already written here. There is no way to ask for
  the file alone, so budget the head once per session and never read it twice.
- **Republishing strips a wrapper.** The saved file opens with the publish-time skeleton — a
  `<!doctype html><html><head>` with a small reset — and the canvas's own document starts at the
  *second* `<!doctype html>`, at byte 356. Publish from that offset, with the trailing
  `</body></html>` of the wrapper removed, or the page is wrapped twice. It saves the whole file to disk and that file is the artifact: pull
  `content.files` out of the `appifact-doc` script block into one file per board, edit those, and
  rebuild. Verified 2026-09-11 by round-tripping 142 files back through the page's own parse.
- **The canvas was 126 boards**, counted 2026-09-10 from the published file's `appifact-doc` block.
  It was 168 that morning. **42 dark boards were deleted the same day**, on the user's decision, and
  the four-faces-per-state rule went with them (`AGENTS.md`, "Design").
- **What was deleted, and how it was chosen.** A dark board was deleted when it is an exact colour
  substitution of its light twin under this file's own token table — `#9A3B24`→`#D9805F`,
  `#17160F`→`#F0EBDD`, `#FAF8F2`→`#14130F`, `#FFFFFF`→`#1C1B16`, `#DED8C8`→`#302E25`,
  `#6B675A`→`#9A9484`, `#E4DFD2`→`#2A2820` — and nothing else. That test is exact, so the list is a
  measurement, not a judgement. **21 families of 42 were mechanical**: `CuentaDentro`, `CuentaSinRed`,
  `ErrorGlobal`, `Fallo`, `Flexion`, `Frase`, `FraseOferta`, `Fuente`, `Instalando`, `Palabra`,
  `PalabraConFlexion`, `PalabraDefinicionAbierta`, `PalabraDefinicionPlegada`, `RegistroVacio`,
  `SinEntradaFraseEnlaces`, `SinResultado`, `SinResultadoIA`, `SinResultadoIAFallo`,
  `SinResultadoSinPista`, `Sugerencias`, `SugerenciasPausadas`. **Their dark face is this file's
  token table and nothing more. Read it there.** The other 21 families keep both faces: their dark
  carries something the light does not.
- **The mobile faces were not pruned, and the reason is that the measurement failed.** Three
  attempts at telling "only narrower" from "really reflowed" apart automatically kept marking
  boards as different that change nothing but padding. A mobile face restructures legitimately, so
  the difference is not mechanical the way the colour swap is. Prune them family by family with a
  human eye, or leave them.
- **`Main.dc.html` is now Palabra · light · mobile.** It was Palabra · dark · mobile, which the prune
  would have deleted — but it is the canvas entry file, so it kept its name and took the light
  mobile's content instead, and the duplicate `PalabraClaroMovil.dc.html` went in its place. A
  search for `PalabraClaroMovil` still finds nothing; the board is there, under the entry's name.
- The counts below are the earlier readings, kept for what each measured:
- **The canvas was 156 boards**, counted 2026-09-09 from the published file after the critic's drive.
  The twenty before those are the five decisions of that afternoon, each drawn light and dark ×
  desktop and mobile before any worker was dispatched, each carrying an annotation that says what was
  refused: `SugerenciasPausadas`, `SinEntradaFraseEnlaces` (every block a way
  back in), `CuentaSinRed` (the one screen allowed to name the connection), `PalabraDefinicionPlegada`
  and `PalabraDefinicionAbierta` (the English definition's two states). The older count follows:
- **The canvas was 112 boards**, counted 2026-09-09 from the published file: Inicio, Palabra,
  PalabraCategoria, PalabraHistorial, Frase, FraseOferta, Flexión, SinResultado, SinResultadoIA,
  SinResultadoIAFallo, SinResultadoSinPista, SinEntrada, SinEntradaEstados, Sugerencias, Instalando,
  Fuente, Fallo, Registro, RegistroVacío, RegistroEstudio, RegistroEstudioEstados, Cuenta,
  CuentaDentro, CuentaCopia, CuentaCopiaEstados, CuentaInformacion, Dispositivos and
  **BarraSidebar**, each in light/dark × desktop/mobile. The nine that arrived 2026-09-09 are T2,
  T3, T4 and T5; the count is the only thing that changed.
- **`SugerenciasPausadas`'s four boards were re-annotated 2026-09-10, canvas version 24.** They drew
  the right screen and said the wrong rule: «La lista no se retira al asentarse el prefijo. Se queda
  hasta que el texto cambie», which `#128` made false the day it was written. The drawing never
  needed changing — `ru` has no entry, so it does keep its ten. Only the sentence moved, to: the list
  withdraws when an answer is on screen, never on a clock. **No board draws the other half of that
  rule** — `word`, answered, with the list gone — because it is an ordinary `Palabra` board and the
  `Palabra` family already draws it.
- **An answer the AI wrote already has boards** — `SinResultadoIA` and `SinResultadoIAFallo`, both
  in all four. Whatever RL-29 becomes, it is not drawing from nothing.
- **Nothing is drawn for exporting or for syncing**, and this file names neither. A screen for
  either is designed from scratch, not derived from a board.
- **This slice's boards, named.** `FraseOferta`, `SinResultadoIA`, `SinResultadoIAFallo`,
  `SinResultadoSinPista`, `Registro`, `RegistroVacío`, `Cuenta`, `CuentaDentro`,
  `BarraSidebarClaroMovil`, `BarraSidebarClaroEscritorio`, `BarraSidebarOscuroMovil` and
  `BarraSidebarOscuroEscritorio` already exist. `BarraSidebar` (T1) draws the theme control at the
  sidebar's foot, which is what the user approved for desktop; see `## Settled`. T2, T3, T4 and T5
  landed 2026-09-09 and the user approved them the same day: `RegistroEstudio`,
  `RegistroEstudioEstados` and `PalabraHistorial` (T2); `SinEntrada` and `SinEntradaEstados` (T3);
  `CuentaCopia`, `CuentaCopiaEstados` and `CuentaInformacion` (T4); `PalabraCategoria` (T5).
- **`/registro/<palabra>`'s empty state is drawn now.** `PalabraHistorialVacio` exists in all four
  faces, and its dark carries its own decision, so the prune left it whole. The note that said this
  screen had no board was true when module 12 shipped it as a reuse of `RegistroEstudioEstados`'s
  strings; it stopped being true and nobody moved it.
- **`Fuente`'s four boards draw a route that is being retired.** The decision below takes `/fuente`
  out; `CuentaInformacion` (T4) is the credit's only board from now on. The `Fuente` boards stay on
  the canvas as stale — never cite one in a dispatch.
- **Every route this app serves has a board, checked 2026-09-10 against `app/`'s own files.** The
  routes are `/`, `/cuenta`, `/registro`, `/registro/[palabra]` and the three error screens; the 43
  board families cover all of them. A handoff carried «four screens from yesterday still have no
  board» from 2026-09-09 into 2026-09-10 — it named none of them, and by the time it was checked
  every route was drawn. **Name the screen or do not carry the claim.**
- **This canvas has since drawn every board this slice needs, and this line no longer holds.**
  Searched every board's source 2026-09-10, that morning, for `<img`, `background-image`, `foto` and
  `photo`: **zero hits across all 127**. That afternoon the photo gained five boards (canvas version
  29) and the generated definition and example gained three more (canvas version 30) — eight in all,
  named under **Settled** below. RL-36 no longer draws from nothing, and neither do RL-41 and RL-42.
- **The two dark `BarraSidebar` boards marked «Claro» selected in the theme control**, drawn dark.
  Fixed in place 2026-09-09. A worker copying that builds a control that contradicts the page it
  sits on.
- **The canvas is seven pages, one per area of the app. Light sits on the left, dark on the right
  where a dark face still exists** — since the 2026-09-10 prune, half the rows have no right half,
  and that gap is the token table doing the work, not a missing board. Instalación, Buscar · la palabra, Buscar · sin respuesta, Buscar · la frase, Registro,
  Cuenta, Cáscara. It was two pages — `Claro` and `Oscuro` — of 56 boards each, stacked over
  25,000 px, and at that height the user could not read it: «demasiadas pantallas que ya no se ve
  nada», 2026-09-09. Light sits at x 0 and 480, dark at 1900 and 2380, so a board and its dark twin
  are legible together for the first time. Adding a family means adding it to its area's page, never
  a ninth page and never a second canvas.
- **Reading the published canvas costs 2.7 MB**, and the head of it is the editor's own stylesheet,
  not the design. Read it to a file and grep the file for `\.dc\.html` names; never read it into a
  conversation twice.
- **`Main.dc.html` carries no `Palabra` in its name because it is the canvas entry file.** A search
  for the board by a `Palabra…` name finds nothing; the board is there. See the entry above for what
  it holds now. The claim that once followed here — that all four faces exist for every state — was
  retired by the 2026-09-10 prune, and only ever describes the 21 families that kept both. Grep the boards
  for a token with a case-insensitive match — they are written lowercase (`#14130f`).

## Settled

- **A word the dictionary carries is answered first, and the form it also inflects from is offered
  underneath — never instead of it. Decided by the user 2026-09-10**, written as `RL-40`, which
  retired `RL-06`. This corrects the 2026-09-09 decision without reversing it: an exact hit still
  wins the top of the screen, `bed` still does not draw «"bed" es una forma de "b"», and the
  inflection is no longer thrown away to get there.
  - **The price of throwing it away, measured the next day: 19 of the 53 `INFLECTION_FIXTURE`
    pairs.** `check:dict`'s D7 was red on `integracion` for a full day and nothing said so, because
    `check:dict` was in no workflow. It has its own CI job now.
  - **What the reader was actually being handed**, measured against the shipped asset: `faster` →
    «ayunador, ayunadora»; `running` → «administración, control»; `gone` → «ido, ha muerto»;
    `women` → «Femenil, Femenino»; `people` → «poblar con, poblarse»; `left` → «sobrado, sobras»
    before «izquierda»; `written`, `spoken`, `driven` and `chosen` → the adjective only, never the
    verb. Not a lost shortcut — a wrong answer for the sentence in front of them.
  - Board: `PalabraConFlexion`. The offer sits behind a 2px rule and a left border, its headword at
    27px against the entry's 34px. **It is never folded**, however many senses the entry itself
    carries — decided the same day against folding it at three or more.
  - `Flexion` stays the board for the other case, where the form typed is not a headword of its own
    and there is no entry above the offer.

- **With no account, the wipe offers one action, not two. Decided by the user 2026-09-10.** The
  account option is **not drawn at all** — not drawn and disabled with a hint, which was refused
  because `/cuenta` is already where this app says «you have no account».
  - What it fixed: `DELETE /api/log/clear` answers 401 with no reader, so a signed-out reader got
    «No se pudo vaciar el registro» and a «Reintentar» that could never succeed, with nothing naming
    the working option directly above it. The account is opt-in (`RL-22`), so signed-out is the
    default state. Found by the critic driving the app.
  - **The remaining action reads «Vaciar el registro», not «Vaciar sólo en este dispositivo».** With
    one action, «sólo» contrasts with a choice that reader does not have. `localAction` keeps its
    wording for the reader who does have an account.
  - It also retires `localBody` for that reader — «Tu cuenta conserva su copia» is false when there
    is no account.
  - Board: `RegistroVaciarConfirmarSinCuenta`, one face. `RegistroVaciarConfirmar` still governs the
    signed-in panel and is unchanged.

- **A phrase the translator cannot answer still falls straight to the word-by-word breakdown, with
  no retry of its own. Reaffirmed by the user 2026-09-10**, with the cost measured this time: the
  breakdown of a nine-word sentence is **2851–3574 px on a 390 px screen**, four phone-screens of
  scrolling, and a one-second network failure costs the reader exactly what a genuinely
  untranslatable phrase costs. Taken knowingly: the breakdown always answers, offline included, and
  a retry button would fail as often as the provider does — **3 of 12 measured**. Do not raise it
  again without a new number.

- **A search with no result offers two things, and they are not the same thing.** Decided by the
  user 2026-09-08, written as RL-28 and RL-29.
  - **A typo gets a correction, computed on the device.** Edit distance over the 58,944 headwords:
    of 1,955 generated one-edit typos it found the intended word **100% of the time**, 288 with more
    than one candidate, at **0.04 ms** a search. No network, no cost. `recieve` → `receive`.
    Boards: `SinResultado`, light × desktop/mobile — it is the face that draws «Quisiste
    decir» over `recieve`. **`SinResultadoSugerencia` was never drawn**; this line named it
    until 2026-09-10, when building RL-28 went looking and found no such board.
  - **A real word the dictionary lacks gets a button, never an automatic call.** `fettle` is English,
    absent from the 58,944, and confirmed in Wiktionary as having twelve senses **and no Spanish
    pair** — which is why DBnary never extracted it. Edit distance answers it *wrong*, offering
    `kettle/mettle/nettle/settle`, so the correction must not fire here. Only a model closes it.
    Nothing leaves the device until the reader taps. Boards: `SinResultadoIA`, light ×
    desktop/mobile.
  - **When the model cannot answer, the reader reaches `SinResultadoSinPista`. Decided by the
    user 2026-09-11.** RL-29 promises the answer says plainly when it could not be produced, and
    the board that drew that state — `SinResultadoIAFallo` — was retired the day before; the
    replacement named there, `SinEntradaFrase`, answers a failed *translation*, never a word the
    model could not answer. `SinResultadoSinPista` already draws the one thing true in both
    cases: the app has nothing to offer for this word and no hint to guess with. **No new board
    was drawn, and that is the decision, not an omission** — the failure adds no control and no
    layout the no-hint face does not already carry.
  - **The guard between them:** the correction shows only when a candidate is within one edit of a
    headword. `zzqqxv` gets neither line, and that is the case the guard exists for.
  - **That guard never silenced `fettle`, and this file was wrong to say it did, from 2026-09-08
    until today.** "Edit distance answers it wrong... so the correction must not fire here" (above)
    reads as if the one-edit guard itself withheld the offer. It does not: `fettle` sits exactly one
    substitution from `kettle`, `mettle`, `nettle` and `settle` alike, so "within one edit of a
    headword" is true of all four and a plain one-edit guard shows every one of them. Building RL-28
    on 2026-09-11 found this by running it, not by reading the paragraph above, and a cap of three
    candidates was added to make the old sentence true — with no textual basis in either the 2026-09-08
    decision above or in `docs/voyager/SPEC.md`'s RL-28. Measured against that cap, over 4,000 real
    one-edit typos: **90.2% have exactly one candidate**, and the cap **silenced the 2.9% with more
    than three** — dropping recovery from 100% to 97.1% (cap 3) or 95.5% (cap 2). Put to the user with
    that number: **decided 2026-09-11, no cap.** RL-28 corrects 100% of one-edit typos, and `fettle`
    draws `kettle`, `mettle`, `nettle` and `settle` — wrong, and known to be wrong — until RL-29 ships,
    which is the same day. RL-29 is what tells that reader none of the four is what they meant; a cap
    that only ever hides the truth from `fettle` was hiding it from every genuine typo past three
    candidates too.
  - **The candidates are ordered by measured frequency, and carry no translation beside them.
    Decided by the user 2026-09-11.** Alphabetical order is no order at all: `bame` returns 13
    candidates with `bae` first and `name` tenth, so the reader taps down a list that tells them
    nothing. **Unbuilt, and blocked on a data source the repo does not have — corrected 2026-09-11,
    the same day it was written.** The decision was taken believing RL-43's table could rank one
    headword against another. It cannot: `POS_FREQUENCY_ORDER` stores a part-of-speech order string
    per headword — `"nv"`, `"vn"` — and `build-pos-frequency.ts` discards the raw SUBTLEX counts
    before writing the file. Measured over `bame`'s 13 candidates, 8 carry a row and `bae`, `bake`,
    `bane`, `fame` and `same` carry none; **all four of `fettle`'s candidates carry none**, so the
    case that motivated RL-28 would come back unordered. The raw `private/subtlex-pos.xlsx` is not
    in the tree. Nothing was written against this decision, because the table was read before a
    worker was dispatched, not after.
  - **What ships instead: rank the candidates the table does carry, and leave the rest alphabetical
    behind them. Decided by the user 2026-09-11, knowing what it does not fix.** 8 of `bame`'s 13
    move; `bae`, `bake`, `bane`, `fame` and `same` keep their alphabetical place after them. **`fettle`
    is unchanged in every respect** — none of `kettle`, `mettle`, `nettle`, `settle` carries a row —
    so the case that opened RL-28 still shows four candidates in alphabetical order. Building the
    raw frequency table was offered and refused: it needs `private/subtlex-pos.xlsx` placed in the
    tree, and the user chose the partial order over waiting for it. A new corpus was refused too.
  - **Drawing each candidate's first translation was measured and refused.** It was the first choice
    and it does not survive the data: the dictionary's first sense for `name` is «ñame» — the yam —
    with «nombre» sitting in sense 1, and `game`'s first sense leads «gancho, imán, jale» with
    «juego» seventh in its own list. RL-43 ordered the sense *groups* by part-of-speech frequency;
    **inside** a group the senses keep FreeDict's order, which is not frequency. A gloss would tell
    a reader that `name` means yam, which is worse than the alphabetical list it replaces, because
    a reader recognises `name` unaided and cannot un-read «ñame». It stays refused until something
    orders the senses within a group, which nothing does today.
  - **No board for the ordering, and it does not need one.** `SinResultado` already draws the
    candidate list under «Quisiste decir»; a list reordered is the same board, exactly as RL-43's
    reordered sense stack was. A face nobody drew here is a face nobody needed. The refused gloss
    would have needed one — a second column is a different layout — and none was drawn, because the
    measurement killed it before it reached a canvas.
  - **The screen draws every candidate too, with no cap of its own, and this needed a second correction
    the same day.** A first pass capped the screen at five with "y N más" past that — wrong for two
    reasons, not one. `suggestCorrection`'s `hits.sort()` is alphabetical, not ranked by anything the
    reader meant, so cutting the list drops the intended word by accident of spelling, not by
    relevance: "boz" (nine headwords one edit away, no autocomplete prefix to hide behind) would have
    shown `boa, boaz, bob, bog, boo` and hidden `bot, bow, box, boy` for no reason a reader could act
    on. And "y N más" is exactly the shape of text `AGENTS.md` forbids — informing the reader of a
    gap without a tap that closes it, the same defect `notFoundHint` had. Measured 2026-09-11 over the
    same 4,000 typos: more than five candidates happens on **0.9%**, so the cap paid this cost on
    nearly every screen for a case that almost never shows up. `Flex`'s own `wrap="wrap"` already
    carries nine short words into a few rows with room to spare — checked at 360px, the narrowest
    viewport this app supports: `boz`'s nine wrap to two rows, the widest tap target's right edge at
    324px of 360, no horizontal scroll. Nothing here is a board decision — the board never asked for a
    cap, a worker added one and then found the reason it was wrong.
  - **The answer is labelled.** An AI answer carries `RESPONDIDO POR IA` above it; the reader always
    knows what came from the dictionary and what did not.
  - **A failure is a failure.** Measured 2026-09-08: 3 of ~12 calls failed (two 403, one 503). The
    board for it exists and says so plainly, with a retry in the ordinary accent button and **no new
    error colour**.
- **The provider is Gemini, `gemini-3.8-flash`.** Decided by the user 2026-09-08 after running both
  candidates against the real gap words. Flash writes what a reader uses (`fettle` → *estado, casi
  siempre en «in fine fettle»*); Flash-Lite pads every note with «Se usa para describir…», which is
  text that only explains and `AGENTS.md` forbids. Flash also costs less per answer at 55–92 output
  tokens against ~95.

- **A headword can be heard, in the browser's own voice.** Decided by the user 2026-09-08 over
  recorded audio and over doing nothing, and written as RL-26. It is the option that serves the
  **27,899 entries with no IPA** exactly as well as the 36,359 that have one, and it adds nothing to
  the 8.0 MiB the dictionary already costs. Known price, and it is not small: the system voice varies
  a lot between devices and is poor on some.
- **The speak control is drawn, on the four `Palabra` boards and on no other.** Counted 2026-09-08 in
  the published file: a 44 px tap target immediately after the headword, holding a 22 px speaker
  glyph in **muted** — `#9a9484` in dark, `#6b675a` in light — never in the accent, because the accent
  already names the part of speech there. It is icon-sized and never a labelled button competing with
  the headword's weight. RL-26 has its board and is buildable.
- **Grep this board set for a shape, not a word.** The control carries no label, no `aria-label` and
  no word in its markup — it is the path `M4 9v6h4l5 4V5L8 9H4z` plus two arcs. A search for `speak`,
  `altavoz` or `hablar` finds nothing and reads as a missing board. It cost this exact mistake once.

- **The English headword leads.** Decided by the user 2026-09-07, `Impreso · Palabra` over
  `Mixto · Palabra`. The headword anchors the answer in the text the reader was reading; the Spanish
  translation sits under it at 21 px. Nothing on this screen is open any more.

- **The record is read inside the app, not only counted and downloaded.** Decided by the user
  2026-09-08, against the alternative of leaving `/registro` as a number and a download button.
  A row carries three things and no more: the word, its translation, and how the answer was reached
  — Exacta, Flexionada, Traducida or Sin resultado. The boards are `Registro` and `RegistroVacío`,
  in all four of light/dark × desktop/mobile.
- **This reopens `/registro`, which shipped as neither.** `app/registro/page.tsx` mounts
  `ExportPanel`, and that renders `t("count")` and a download button — it lists nothing. The list is
  a screen nobody has built, and it belongs to no module in any plan.

- **Two English words the dictionary has no entry for get a screen, not silence.** Decided by the
  user 2026-09-08. Today anything of two tokens that is not a headword — and anything over sixty —
  parks in `waiting` and renders nothing at all: `PHRASE_MIN_TOKENS` is 3 (`lib/query/classify.ts:10`),
  `search-screen.tsx:182` parks there, and `phrase-answer.tsx:42` returns `null` for it. Nothing ever
  leaves that state. The screen names what was not found and offers the word answer for each word
  under it. It is chosen over lowering the phrase floor because it answers **offline**, where the
  network path cannot, and over one line of copy because the dictionary holds both words.
- **A lookup has a URL.** Decided by the user 2026-09-08. `/?q=book`, written on settle. Back walks
  the reader's own lookups instead of leaving the app — which is what it does today, since `/` is the
  only history entry there has ever been, and on a home-screen install that gesture closes the
  dictionary. It also ends the retype that every trip to `/fuente` or `/registro` costs. RL-14 is
  untouched: the answer still comes from IndexedDB and no keystroke reaches the network. Known price,
  and the user was told it: a reader's queries enter browser history, which on a shared phone is a
  real change.
- **The bottom bar ships with two items first — Buscar and Registro — and gains Cuenta with the
  account slice.** The user left the count to this file on 2026-09-08. Three is what the bar is for
  and what every board draws; `/cuenta` is a route that does not exist, and a permanent tab onto a
  dead end is worse than a bar that grows. The reason to build it now is that `/registro` is
  currently reachable only through a link labelled «Ver origen», behind the credits page.

- **The desktop gets a design of its own, and it starts with the sidebar.** Decided by the user
  2026-09-08, on their own words: «en desktop no se ve bien, es como el mobile», and «en desktop
  deberían ser un sidebar porque hay más información». Voyager has no desktop design today — it
  centres the phone layout and stops, which is what `/registro` stretching edge to edge showed. The
  sidebar is the first piece, not the whole answer: every screen that is not prose has to be drawn
  for the width it now gets. `BarraSidebar` (T1) drew the shell 2026-09-08; `RegistroEstudio`,
  `SinEntrada`, `CuentaCopia` and `CuentaInformacion` drew the screens inside it 2026-09-09.
- **Copying to an account is automatic, not an act.** Decided by the user 2026-09-08, on their own
  words: «no tiene sentido que sea manual, debería linkearse automáticamente. No es una pregunta, es
  algo que se hace solo». With an account, the copy starts by itself and is never asked about. This
  **retires RL-23**, which the 2026-09-08 slice had just built, and with it the consent screen that
  named the two figures. **RNL-09 is untouched**: with no account, nothing leaves the device — the
  account is still the whole of the consent. **No switch survives.** Asked whether one does, the
  user answered **none but signing out**: with an account, the copy runs; the only way to stop it is
  to close the session. Written as RL-30.
- **The licence hides in an information tab inside `/cuenta`.** Decided by the user 2026-09-08, on
  their own words: «LA LICENCIA SE ESCONDE EN UNA PESTAÑA DE INFORMACION EN LA CUENTA DONDE NO VA
  QUEDAR VISIBLE A LA GENTE (A MI)». It leaves the search screen, where it bothered the user, and
  lands in `/cuenta`, which already renders with no session — so the credit CC BY-SA 3.0 requires
  stays reachable by whoever uses the app, signed in or not. This retires RL-15 and is written as
  RL-33. Drawn 2026-09-09 as `CuentaInformacion`, in all four faces: a two-tab strip at the head of
  `/cuenta`, the dictionary and its edition, then the CC BY-SA 3.0 credit, then the app's version.
- **`/registro` becomes the study, and a word opens its full history.** Decided by the user
  2026-09-08. The record groups by word — one row, a count, ordered by frequency — and replaces the
  chronological list this same slice had just settled on (`Registro`/`RegistroVacío`, above);
  tapping a word opens every one of its searches with its date. Written as RL-32. Drawn 2026-09-09
  as `RegistroEstudio`, `RegistroEstudioEstados` and `PalabraHistorial`; `Registro` and
  `RegistroVacío` as drawn are the chronological list this decision retires from the reading path,
  and they stay on the canvas as what was replaced.
- **The theme control has two homes, one per shape of the navigation.** Decided by the user
  2026-09-08, looking at the `BarraSidebar` board: the sidebar's foot on desktop, inside `/cuenta`
  on the phone. Two surfaces, not one, because the bar that carries the phone's navigation has no
  foot to put a control in and the sidebar does. **This gives RNL-07 a home; it does not build it —
  RNL-07 stays unticked.** `app/theme.css:14-17` admits today that the reader does not choose: the
  OS preference alone picks the mode, and no toggle lives there yet.

- **A word's photo is online-only, and it never sits behind a tap.** Decided by the user 2026-09-08,
  on their own words: **«las fotos no es obligatorio para sesiones offline»**. Embedding one photo
  per entry measured at **≈247 MB** for the 64,258 entries — 29 times today's asset — against an
  average thumbnail of **3,846 bytes** for a 100 px width, sampled over 9 real words
  (`private/reportes/investigacion-oraciones-e-imagen-2026-09-08.md`). That weight is the reason it
  is never installed: with no connection there is no photo, and the word's answer draws exactly as it
  does today. No count of how many entries are even photographable exists: the loose upper bound is
  37,567 entries tagged as a noun, which does not tell `apple` from `anxiety`. The user also chose
  that the photo **draws by itself as the answer is drawn**, never behind a tap — and that clause is
  what **retires RL-14**: a keystroke can now reach the network, on the very screen that used to
  touch nothing at all. `SPEC.md` opens its successors as **RL-35** (the text, unchanged) and
  **RL-36** (the photo, the new exception).
- **The photo goes straight to Wikimedia, with no route handler of the app's own in front of it.**
  Decided by the user 2026-09-08, asked plainly whether it mattered that a third party sees which
  word the reader is looking up: they chose to let it go direct, over building a fifth route handler
  (the shape RL-09 already has for the sentence path) to hide it. Say this as the price it is, not as
  an implementation detail: everywhere else in this app a lookup never leaves the device — RL-35 (the
  word's text), RNL-09 (the copy), the consent the account screen already asks for — and the photo is
  the one deliberate exception, telling Wikimedia both the word and the reader's IP address.
- **The photo comes from Openverse, not from Wikimedia, and no model chooses it.** Decided by the
  user 2026-09-10 after the Wikimedia path was measured and found to be the wrong question: this file
  had assumed Wikipedia as the source, and the user had never asked for that constraint — «a mí no me
  importaba la fuente». Measured over the same 300 nouns:

  | | coverage | wrong-subject redirects | LLM calls |
  |---|---|---|---|
  | Wikipedia article images | 55.0% | 11.7% | 0 |
  | Wikipedia + `gpt-5-nano` choosing the article | 58.3% | 6.0% | 100% |
  | **Openverse image search** | **95.7%** | — | **0** |

  Openverse is WordPress's CC image search over Flickr, Wikimedia and others. **It needs no key and
  no model.** Restricted to permissive licences only — `by`, `by-sa`, `cc0`, `pdm`, no NC and no ND,
  which matters because the bytes are re-served from our own bucket — the search itself still answers
  95.0% (285 of 300). Licences seen: `by` 139, `by-sa` 127, `cc0` 11, `pdm` 8.
  **The 95.7% and 95.0% above count Openverse's search results, not the bytes that actually arrive,
  and a result can point to a dead thumbnail** (`abeyance`, `HTTP 424`). **The real coverage is 93.3%,
  not 95.7%** — measured 2026-09-10 over 60 words, requesting five candidates per word and falling
  back from `thumbnail` to `url` on a dead one (`docs/TRAPS.md`). Every image that does arrive carries
  its author and licence, which is what feeds the per-image list in `/cuenta`.
  **The whole `gpt-5-nano` article-choosing design is dropped.** It bought 3.3 points of coverage for
  a paid call and 3.7s of latency per word.

- **The model moves to what the dictionary is actually missing: definitions and example sentences.**
  Decided by the user 2026-09-10. **RL-41** fills the 19.7% of entries that carry no definition at
  all; **RL-42** adds one example sentence with its translation.

- **The model is `gpt-5-nano` with `reasoning_effort: low`.** Decided by the user 2026-09-10, over
  `minimal`, with the fallback stated plainly: «si lo vemos muy mal pues se prueba en otra».
  Measured on the same 12 entries that carry no definition:

  | | output tokens | reasoning | time | quality |
  |---|---|---|---|---|
  | `gpt-5-nano` `low` | 2,695 | 2,240 | 17.6s | correct |
  | `gpt-5-nano` `minimal` | **607** | 0 | 4.5s | **invented one definition** |
  | `gpt-4.1-nano` | 460 | 0 | 7.3s | **rejected** |

  `minimal` is 4.4x cheaper and defined `abies` as «the embryonic or immature forms of certain
  trees»; it is the fir genus, which `low` got right. **A false definition in a dictionary is worse
  than no definition** — the same test the photo had to pass. The saving is not worth it because
  **lazy caching already makes a word cost once for the life of the app**: 4x on cents.
  `gpt-4.1-nano` was rejected outright — in 12 of 12 it returned the bare word where the sentence's
  translation was asked for, and invented «antivario» as Spanish.
  **`reasoning_effort` is where the bill actually was**: 83% of the output tokens in the first test
  were reasoning, spent to write dictionary sentences that need none. Never leave it unset.
  **Never send a flagship for a task like this.** One `gpt-5.5` call was spent on an opinion during
  this session and it bought nothing the measurement did not already say.

- **The photo's bytes go to a Supabase Storage bucket, and the project gains its first storage
  credential.** Decided by the user 2026-09-10, told plainly that `apps/voyager/lib/env.ts:3-7`
  forbids a server-side Supabase key in writing, citing RNL-10, and told the alternative that needed
  no credential at all — the bytes as `bytea` in the `reading` schema, written over the
  `DATABASE_URL` connection that already exists. They chose the bucket: a database is scarcer and
  more expensive space than a file store, and at a measured ~24 KB a thumbnail it grows fast.
  **The prohibition in `env.ts` is narrowed, not deleted.** What RNL-10 protects is a reader's record,
  and the photo cache is not one. So the rule becomes: **no privileged key may reach Postgres**, and
  the storage credential must be
  **scoped to Storage alone** — Supabase's S3 access keys are, and `service_role` is not, because
  `service_role` bypasses every RLS policy in the database as well. One file may read it. It never
  builds a client that touches the `reading` schema, and RNL-10 is still proved by driving it.
  Hotlinking straight to Openverse was offered as a third way and refused: it is exactly the leak the
  user closed on 2026-09-08 — the image host would see the reader's IP and the word looked up.

- **Our own server now sees which word each reader looks up, and that is new.** On 2026-09-08 the
  user accepted that Wikimedia would see the word and the reader's IP, over building a route of the
  app's own. Openverse behind our route reverses that: the image host sees nothing, and the server
  sees everything. Better against third parties, worse against us. Written down because the earlier
  decision went the other way and nobody should read this file and think it never changed.

- **Generated text is marked «generada»; a dictionary definition is not.** The dictionary's own
  definitions come from Wiktionary under CC BY-SA and have been reviewed by people; a generated one
  was written by a model that mis-defined `abies` in a test of twelve. Without the mark the reader
  cannot tell which is which, and has no way to know when to doubt one. Taken 2026-09-10 on the
  user's «déjalo como consideres», against the cost of one more 10px line on the screen.

- **The route carries a hard daily spend ceiling, and refuses past it.** Lazy generation means the
  bill follows use, and use has no ceiling of its own. Past the cap the route stops calling the model
  and answers as if there were no connection — which RL-35 already makes safe, and which the
  «sin red» board already draws, so no new state is invented for it. Taken 2026-09-10 on the same
  instruction. The number lives in an env var, not in code, so moving it costs no deploy.

- **Both are resolved lazily and cached, never in a pass over the dictionary.** Decided by the user
  2026-09-10, explicitly: «que se gaste poco a poco pero que no se ponga a buscar todo el diccionario
  de un tacazo». A word is generated the first time somebody looks it up, and cached so it costs once
  for every reader there will ever be. **This is what bounds the bill**, and the bound is real usage,
  not the 64,258 entries.
  **It also keeps the asset where it is.** Baking the generated text into the downloaded dictionary
  would take it from **8.00 MiB to 14.14 MiB** — measured — and that cost is paid by every reader on
  every install, in an offline-first app. Caching server-side pays nothing at install.

- **RL-35 does not need retiring for this, and was not.** Its own text already allows it: «what the
  network can add afterwards is decoration: it arrives late, arrives only sometimes, and its absence
  never changes the answer or delays it». A definition for a word that has none, and a sentence, only
  ever add. With no connection the screen is exactly the one the device draws today.

- **Dollar figures in this repo's AI reports before 2026-09-10 were assumed, not verified, and were
  wrong by about 7x.** The per-token prices were never checked against a bill; the account balance
  moved **USD 9.96 → 9.68** while the estimates for the same work summed to USD 0.04. The key cannot
  read `api.usage.read`, so **the balance is the only ground truth available** — read it, do not
  compute it. What that corrects: the 300-noun photo run cost **~USD 0.25, not 0.035**, and resolving
  the whole dictionary with a model would have been **~USD 20, not 2.89**.

- **The photo is drawn on the dark face, in five boards** — canvas version 29, 2026-09-10:
  `PalabraFotoOscuroMovil` (resolved), `PalabraFotoCargandoOscuroMovil` (asked for, not yet back),
  `PalabraSinFotoOscuroMovil` (the 6.7% with nothing behind them), `PalabraFotoOscuroEscritorio` and
  `CuentaInformacionFotosOscuroMovil` (the credits). Dark, not light, because a photograph on
  `#14130F` is a real design difference and not the token table applied — the one place in this app
  where the dark face is not derivable from the light one.
- **The generated definition and example are drawn on the dark face too, in three boards** — canvas
  version 30, 2026-09-10: `PalabraGeneradaOscuroMovil` (resolved, the definition and example marked
  «generada»), `PalabraGenerandoOscuroMovil` (asked for, not yet back — the translation above is
  already whole, so this block reserves no height for it) and `PalabraSinDefinicionOscuroMovil` (no
  connection, no result, or the daily ceiling reached — exactly today's screen, with no gap left for
  what did not arrive). Same reason as the photo: a generated block on `#14130F` is a real design
  difference, not the token table applied.
- **The heading over a generated block names what is under it, and no board draws the case where
  that is only an example. Decided and built 2026-09-11.** «Definición generada» was drawn
  unconditionally while the definition itself was gated on `definition !== null`, so a word without
  one was told it had a definition. Measured against `reading.word_texts` that day: **22 of 41 rows
  carry a null definition** — two populations, not one, and both want the same answer: RL-41's
  19.7% of headwords the dictionary ships with no definition at all, and every word that already
  has a dictionary definition, where the route strips the generated one by design. The heading now
  reads «Ejemplo» there, in the same treatment, and the «generada» mark stays either way.
  **`PalabraSinDefinicion` is NOT this case** — it is the absent state: no connection, no result,
  or the daily ceiling reached. **No board draws «resolved, no definition, has example», and one
  was not drawn:** it reuses an existing heading treatment and an existing string, changes no
  layout and adds no control, so it is the same board with a different word in it.
- **The pending square is silent, not spinning.** A 76px ornament that the reader is not waiting on
  must not advertise itself as a task; a spinner would turn it into one. The whole answer reads
  without it.
- **The photo sits beside the headword, small and square, not in the body of the answer.** Decided by
  the user 2026-09-10, over placing it last after every sense and over placing it under the first
  translation. The header already has that height, so a lazily-resolved image **pushes nothing** —
  the reason the other two placements needed a reserved slot disappears with this one. The price the
  user took knowingly: at that size a photograph of an object reads poorly, and **it forces a desktop
  face**, because the header is the one band of this screen whose proportions really change between
  360px and a wide column. Both faces are drawn.
- **No photo means no slot, no placeholder and no apology.** The 6.7% with nothing behind them — the
  complement of the 93.3% that actually downloads, measured 2026-09-10 over 60 words with five
  candidates each and a thumbnail-then-`url` fallback (`docs/TRAPS.md`) — draws exactly the screen it
  draws today, headword flush left as though the photo had never been a possibility. A «sin imagen»
  marker would turn the commonest case into a visible failure.
- **Wikimedia's licence is per file, and this app hides licences in a tab today.** CC BY-SA, CC0 and
  public domain sit mixed across individual files, so every photo carries its own attribution, unlike
  the CC BY-SA 3.0 that covers the whole dictionary asset under one credit. `/cuenta` is where this
  app already puts a licence (RL-33's source and licence, in an information tab). A per-image credit
  cannot hide there. A per-image attribution has to sit next to its image to mean anything, which is the
  opposite instinct. **Now obligatory, not optional:** the user chose 2026-09-10 to keep the bytes in
  a Supabase bucket rather than hotlink, and re-serving a CC BY-SA file is redistribution, which
  carries its share-alike with it.
  **Resolved 2026-09-10: the credits go where the other licences already are** — the information tab
  inside `/cuenta`, `CuentaInformacion`, beside RL-33's source and edition. Chosen by the user over
  riding on the image's foot and over hiding behind a tap on the image. The instinct this file
  recorded on 2026-09-08 — that a per-image credit cannot live in a collection's licence tab — was
  **too strong, and is corrected here**: a credits page satisfies CC BY-SA when it names each file
  individually and the reader can reach it. **What that costs, and it is not optional:** every photo
  gets **its own entry** — author, licence, link to the file — and one blanket line covering «the
  photos» does not discharge it, because the licence is per file and the files differ (CC BY-SA, CC0
  and public domain sit mixed). The list is the reader's own resolved photos, so it is finite and
  grows only as they look words up. **It is a device's list, not an account's**: it lives in the
  browser's own storage, never in `reading`, and that is why `CuentaInformacion` keeps drawing it with
  no session — the same reason RL-33's credit already draws there without one.

- **A sense group carries one category label, and the group's IPA sits on that label's row.**
  Decided by the user 2026-09-09, looking at `PalabraCategoria`, over the alternative of giving every
  sense its own IPA. `like` draws SUSTANTIVO once, not twice. The IPA on the label row is the first
  sense's; a sense whose IPA differs from it draws its own above its translation, and a sense whose
  IPA matches never repeats it. This is what RL-04 has asked for since it was written and what
  `sense-list.tsx` has never done. Known price: a reader glancing at the label row sees an IPA that
  belongs to the first sense of the group, not to the group.
- **The study replaces the download as the weight of `/registro`.** Decided by the user 2026-09-09,
  approving `RegistroEstudio`. The grouped rows are the screen; «Descargar el registro» drops from a
  filled button to an underlined link at the foot. The three other states are drawn:
  a four-row skeleton while loading, «Todavía no has buscado nada» when empty, and «No pude leer el
  registro» with a retry when the store fails — no system red, per `## Failure`.
- **The no-entry screen names the string and answers each word under it.** Decided by the user
  2026-09-09, approving `SinEntrada`. At most eight word blocks; the rest becomes one line. Over
  sixty words there is one line and no block at all. A word the dictionary also lacks draws its own
  «El diccionario tampoco tiene esta palabra», never a gap.
- **`measure="full"` takes no maximum width on desktop.** Decided by the user 2026-09-09, after
  three candidates were rendered on the real app with the same rows: no cap, 1120px, 960px. A row
  runs 1680px on a 1920 window and 2320px on a 2560 one, and the known price is the distance a
  reader's eye crosses between a word and its translation — 925px at 2560. `width: auto` is what
  keeps the screen from overflowing the sidebar's 240px; a maximum is a separate rule and there is
  none. Any new `measure="full"` screen inherits this.
- **A sentence that fails to translate falls to the per-word breakdown, always.** Decided by the
  user 2026-09-09, after the code was measured rather than assumed. «The translation comes back
  empty» is not a state this app has: `app/api/translate/route.ts` turns an empty `translatedText`,
  a quota warning and a non-200 `responseStatus` each into a 502, which `translateOverNetwork`
  throws and `search-screen.tsx` renders as `failed`. So the fallback hangs off `failed`, and a
  module built on «done with empty text» would have landed dark. Written as **RL-37**; RL-31 is
  untouched, because its own claim — a string *not* treated as a sentence never gets silence —
  stays true.
- **The generated text draws as soon as it is ready, without waiting for the photo. Decided by the
  user 2026-09-11.** `use-decoration.ts` settled both in one `Promise.all`, so text already sitting
  in Postgres waited on the photo: **64 s measured** for `left`. Two readings were offered and
  refused — leaving them coupled, and separating them with no reserved box. **Board:
  `PalabraTextoAntesDeFoto`, óscuro × móvil**, drawn 2026-09-11 on the «Palabra» page beside
  `PalabraGenerada` and `PalabraGenerando`. The 76 px slot is **reserved from the first paint**, so
  nothing moves under the reader's finger when the photo lands, and the square stays **silent, not
  spinning** — `PalabraFotoCargando`'s own reasoning holds: a 76 px ornament is not a task the
  reader is waiting on, and a spinner would make it one.
- **No light face and no desktop face for it, and neither is missing.** This screen's decoration
  states were only ever drawn óscuro × móvil, and this one changes neither layout nor controls —
  only what has arrived by the time the reader looks.
- **`SinResultadoIAFallo` is stale in all four faces.** «La IA no pudo responder» is the state the
  decision above replaces. The boards stay on the canvas as a record of what was; never cite one in
  a dispatch. The screen a failed translation reaches from now on is `SinEntradaFrase`, and the
  screen a word the model could not answer reaches is `SinResultadoSinPista` — decided by the
  user 2026-09-11, written against RL-29 above.
- **The app says nothing about being offline, and `offline.notice` goes.** Decided by the user
  2026-09-09, with both readings drawn side by side on the canvas's «Cáscara» page. The string
  existed — «Estás usando la app instalada en el dispositivo, sin conexión» — and it only explains:
  there is nothing to act on, and the app answers a lookup offline exactly as it does online, which
  is what RL-16 promises. `## Type`'s rule wins: write what a person acts on, cut what only explains.
  **`SinConexionCallado` is the approved board; `SinConexionAviso` is stale** — it exists only to
  record what was refused. Known price, and the user took it: a reader who needs the network for
  something that needs it — translating a phrase, copying to the account — is told nothing about why.
- **The error boundary covers the whole app and keeps the shell.** Decided by the user 2026-09-09,
  approving `Error` in all four faces on the «Cáscara» page. One `app/error.tsx` at the root: the
  bottom bar or the sidebar stay put, so a reader can leave for another section without reloading.
  It draws `error.title` and `error.retry`, which were written long before any screen called them.
  It obeys `## Failure` — a hairline sets the break off, the line is full-weight ink, and the accent
  is spent only on the button that recovers. No error colour, here or anywhere.
- **A word block on `SinEntradaFrase` carries its translations alone — no IPA, no definition.**
  Decided by the user 2026-09-09, once the screen's real height was measured. It applies to this
  screen only: looking a word up on its own still answers in full. A reader scrolling a failed
  sentence does not need the full entry for «the». Known price: the fallback answers less completely
  than a direct lookup, and it needs a `SenseList` variant. **The four `SinEntradaFrase` boards were
  redrawn to the trimmed block 2026-09-09 and are current.** The same redraw gave the word the
  dictionary also lacks a heading of its own: it had none, so the one word that made the sentence
  fail was the only one unfindable among the eight. Approved by the user the same day.
- **«El diccionario no tiene esa palabra» never shows over an unfinished prefix.** Decided by the
  user 2026-09-09, after the critic drove it: typing `ru` and pausing 900ms — to think, to look back
  at the book — withdrew a correct suggestion list and left the not-found line over a prefix the
  dictionary certainly has, in the gesture the app repeats most. The message is suppressed while the
  text is still a prefix of at least one suggestion already offered, and kept for when nothing
  matches at all. **`SUGGESTIONS_SETTLE_MS` does not change** — raising it was offered and refused —
  **and RL-18 does not change**: the list still withdraws on settle. What was wrong is RL-18's own
  stated reason, «the answer is already on screen»: on an unfinished prefix there is no answer.
- **`SinEntradaFrase` draws the phrase fallback, and the screen it makes is tall.** Approved by the
  user 2026-09-09, four boards on the canvas's «Buscar · sin respuesta» page at y 5200, light and
  dark × desktop and mobile. «she kept her fettle through the long and bitter winter» with no
  translation: eight word blocks, then «y 2 palabras más» for the rest. `fettle` is block 4, so the
  «El diccionario tampoco tiene esta palabra» line is drawn **inside** the fallback and not only
  beside it. Two alternatives were offered and refused — cutting to four or five blocks, and skipping
  articles and prepositions — so the breakdown stays every word, in order.
  **The height was given wrong twice, and the boards still carry the wrong figure.** They say 1560px
  desktop and 1880px mobile — that sized the content column, not the page, and it is the number the
  approval was given against. A first correction said 3022/3155. Driving the built app 2026-09-09
  measured **3508px desktop and 3805px mobile** for a nine-word failing phrase: four or five phone
  screens of scrolling to reach the word the reader wanted. Measure the page, never the artboard,
  when a screen is approved on its height.
  **The three figures are reconciled, 2026-09-09, and the number is 2851px desktop / 2944px mobile.**
  They never contradicted each other: 3022/3155 was the block before the trim, and 3508/3805 was a
  different phrase on a version with no eight-block cap. A validator re-measured 2851/2944
  independently and hit the worker's figure exactly. **The method is the number**:
  `document.documentElement.scrollHeight`, production build, the phrase
  `dog cat zzqx bird fish mouse horse cow pig`, read 1000ms after the fill. Measure the page, never
  the artboard. The four boards still print 1560/1880 — the content column, not the page — and are
  stale until redrawn.
- **A phrase the translation cannot answer falls back to the per-word breakdown.** Decided by the
  user 2026-09-09, closing the gap `SinEntrada`'s eight-block cut left. `schedulePhrase` sends every
  3-to-60-token phrase to `PhraseAnswer` today, so the breakdown ran at exactly two tokens and
  `MAX_BLOCKS = 8` never fired. From now on, a 3-to-60-token phrase whose translation comes back
  empty drops to `NoEntryAnswer`: at most eight word blocks, the rest one line. The cut and the «N
  más» line become reachable. **The board for it does exist** — `SinEntradaFraseEnlaces`, which
  draws the eight blocks, the «y 2 palabras más» line and the links out of each one. This sentence
  said otherwise until 2026-09-10; it was written before that board landed and nobody moved it.
- **`/fuente` is retired, and the credit lives in `/cuenta` alone.** Decided by the user 2026-09-09.
  The route was orphaned from module 6 — no screen linked it, `source.open` had no caller — and it
  is a leftover of RL-15, retired 2026-09-08. RL-33 already puts the source, the edition and the CC
  BY-SA 3.0 licence in an information tab inside `/cuenta`, so **no live requirement changes and
  nothing is retired from the SPEC.** `app/fuente/`, its strings and its boards go.
- **Every attribution the app owes is named in `/cuenta`'s information tab, and nowhere else.**
  Decided by the user 2026-09-09, settling the question open since 2026-09-08. Tatoeba's per-sentence
  credit and Wikimedia's per-image credit join the dictionary's in `CuentaInformacion`; the reading
  screen carries no credit line and no per-block affix. The tab reads with no session, which is what
  keeps the credit reachable to whoever uses the work.
- **The account screen shows a state, never a control.** Decided by the user 2026-09-09, approving
  `CuentaCopia`. With a session it reads «Copiando a tu cuenta» and when the last copy was; there is
  no button and neither of the two figures RL-23 used to name. Copying now, never copied, failed
  with its retry, and signed-out are each drawn. The only way out stays signing out, per RL-30.

- **The AI is parked, and no provider is chosen.** Decided by the user 2026-09-08, after the numbers
  came in. RL-28 and RL-29 stay open and unbuilt; nothing in the app calls a model, so picking a
  provider now would be deciding without a caller. What was measured that day, and what it is worth
  re-reading before this reopens (`private/reportes/proveedores-ia-oracion-2026-09-08.md`):
  - The 46.7% failure rate that started this was **never the provider**. It was
    `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue: 20` — a per-project daily cap
    on `gemini-3.8-flash`, shared by every lane. Spacing calls 5 s apart changed nothing; the same
    model measured **0/35** the next day, when the day's 20 were already gone.
  - **Google publishes no free-tier daily limit.** Its own rate-limit page says to look in AI Studio.
    Community guides say ~1,500 requests a day for free Flash; this project measured 20. A figure
    read off the open web would have confirmed a false diagnosis and bought a migration for nothing.
  - Two models in the same family and project have no such wall: `gemini-3.5-flash-lite` measured
    **19/20**, `gemini-3.1-flash-lite` **16/20**, on the same 20 headwords. The one failure of the
    first was **our own client timeout**, not theirs.
  - Published prices per MTok, read 2026-09-08: `gemini-3.1-flash-lite` $0.25/$1.50,
    `gemini-3.5-flash-lite` $0.30/$2.50, `gemini-3.8-flash` $0.75/$3.75 — **doubling to $1.50/$7.50
    on 2027-01-01** — Claude Haiku 4.5 $1.00/$5.00.
  - Nobody has compared the one thing that decides this: **which model writes a better Spanish
    example sentence for a reader.** Price does not separate them at this volume; quality is unmeasured.
- **Read a price, measure a reliability. Never the other way round.** The rule this day earned. Half
  the published comparisons confuse Flash with Flash-Lite, and none of them knows this project's
  quota, prompt or words.

- **`global-error.tsx` gets a test hook, and only outside production.** Decided by the user
  2026-09-09. `app/layout.tsx` throws on a signal that an environment variable arms, so `check:e2e`
  can drive the root-layout crash; the production build strips it and no reader can reach it.
  Prove the stripping, or the hole comes back wearing a hook. Until that module lands, the only
  proof this screen renders is a hand-made hook a validator wrote and deleted.

- **The 429 stays proven by reading, not by driving.** Decided by the user 2026-09-09: no vitest, no
  jest, one test layer in this repo. `apps/voyager/app/actions/account.ts` classifies
  `error.status === 429` into its own line, and a validator mutation confirmed 2026-09-09 that
  breaking that branch reddens nothing in `check:e2e`. The type it leans on is
  `AuthError.status: number | undefined`. Known gap, not an oversight.

- **The false-inflection filter stops where grammar stops.** Decided by the user 2026-09-09. The
  grammatical filter took 931 headwords claiming a false comparative or superlative to 0 without
  losing a legitimate one. What survives is semantic: `cutter` still reduces to `cut`, because
  `cut` carries an adjective sense. Closing that needs NLP — excluded by SPEC §4 — or a hand-built
  gradability list. Neither is worth it at this residue.

- **No lookup is lost when the tab dies, and the grouping stays.** Decided by the user 2026-09-09,
  after a critic drove it: `lemon` searched, 2.0s wait, tab closed — the row was gone, and only
  landed after **5.8s** of quiet (`SETTLE_MS` 800 + `MAX_PENDING_MS` 5000, `lib/log/record.ts:18-19`).
  RL-21 says «**every** lookup a reader settles on is recorded» and its own context is «typed into,
  read, and **closed**». The listeners were never missing: `pagehide` and `visibilitychange` both
  call the flush. What loses is the race — `commit` fires `void writeRow(row).then(…)` and the page
  dies before the IndexedDB transaction commits. Two alternatives were refused: writing at settle
  (800ms), which fills the record with prefix rows «bo», «boo», «book»; and rewriting RL-21 to
  promise less.

- **The offer retires on an answer, never on a clock. Corrected by the user 2026-09-09**, the same
  day, after driving the first version. «La lista nunca se retira» was too blunt: typing `word` left
  ten suggestions stacked above the entry that was already answering it. The rule is finer — the
  list withdraws the moment the screen holds an answer for what was typed, and stays when it holds
  none. `ru` keeps its ten candidates, `word` closes them. `RL-18`'s underlying intent survives; only
  its trigger changed, from a 900ms timer to the presence of an answer. This supersedes the entry
  below, which is kept for what it measured.

- **A word the dictionary carries is answered, never also guessed at. Decided by the user
  2026-09-09.** `bed` is its own headword, and the app drew its real entry *and* two inflection
  guesses under it — «"bed" es una forma de "b"» and «"bed" es una forma de "be"», the first
  translating to «n.». `lookupWord` now returns no `viaInflection` at all when the exact headword
  hits. Guessing is what a miss earns. **The measured price: `left` no longer offers `leave`.** It is
  a real headword itself, so it is answered as itself; the reader of «he left» loses the one-tap path
  to the verb. Taken knowingly — reversing it is one line in
  `apps/voyager/lib/dictionary/lookup.ts`.

- **A paused prefix keeps its suggestions on screen.** Decided by the user 2026-09-09. **Superseded
  the same day by the entry above** — kept for its measurement, not as law. Typing `ru`
  and waiting left `main.innerText` empty at 900ms (`SUGGESTIONS_SETTLE_MS`,
  `components/search/search-screen.tsx:35`): **640px of nothing** on a 360×740 phone, light and
  dark, and the ten candidates the reader was reading went with it. From now the list stays until
  the text itself changes. The price, taken knowingly: the list coexists with the answer when the
  prefix is also a word (`book`), which is what RL-18 set out to avoid.

- **Every block of the breakdown is a way back in.** Decided by the user 2026-09-09. On a failed
  phrase the eight blocks and the «…y N palabras más» line carry no control at all — the only
  interactive element in `main` was the box's own clear button, so `winter` had to be retyped. Each
  block and that line now lead to `/?q=<word>`. The price: the reader loses the breakdown on the
  jump. Two alternatives were refused earlier and are not reopened — cutting to four blocks, and
  skipping articles and prepositions. This also closes the compact block's other hole: it draws a
  34px headword identical to a real answer, with no IPA, no definition, no speak and, until now, no
  door to the full entry.

- **The email screen names the connection when there is none.** Decided by the user 2026-09-09, as
  an explicit exception to the same day's decision that the app says nothing about being offline.
  Driven offline at 360px, the button sat on «Enviando…» at 2, 5, 8, 12 and **30 seconds** with no
  failure line, no retry and no way out but a reload. This is the one screen that genuinely needs
  the network, so it is the one screen allowed to say so. Everywhere else the silence holds.

- **The English definition draws open, always.** Decided by the user 2026-09-10, over folding it
  and over opening it only under a length threshold. **This reverses the fold decided 2026-09-09**,
  whose stated reason was to shorten the app's longest screen. Measured before the question was put:
  the definition is **a sentence**, not a paragraph — median **75 characters**, p75 114, p90 161,
  p95 194, p99 270, max 657; senses carrying one at all have a median of **1** per word, max 4. A
  fold costs a tap in the **80.3%** of lookups that carry a definition (51,622 of 64,258 entries) to
  save two lines. The counter-argument was put to the user and refused: it is English prose under a
  Spanish heading, for someone who has just demonstrated they did not understand an English word, so
  opening it always does not make it more useful, it makes it more visible. Removing it outright was
  refused 2026-09-09 and stays refused: the information is real.
  **`PalabraDefinicionPlegada` is retired as a board** — there is no folded state left to draw.

- **A one-character query answers only `a` and `i`, everything else falls through to
  suggestions. Decided by the user 2026-09-09.** Typing `b` against the production build drew
  «b / ADJETIVO / Traducciones / n. / Abbreviation of born.» — the index's own key for the headword
  **`b.`**, whose period `normaliseHeadword` strips. 12 of the index's keys are one letter, 15
  entries behind them: `a` (un, una) and `I`→`i` (yo) are real headwords; the other ten —
  `b.`→«n.», `p.`→«p., pp.», `C` (the programming language), `s` (a suffix), `y` (a suffix list),
  `u`/`o`/`e` (letter names), `x` (the letter or the messaging «x»), `4` (a messaging «x») — are
  abbreviations, suffix lists and letter-name entries a reader typing one key never meant to reach.
  `lookupWord` now answers only `a` and `i` at length one; every other one-letter query falls
  through to the suggestion list a mid-word prefix already draws — no new screen state, the same
  `suppressNotFound` a paused `ru` already stands on. `suggest()` drops the same ten from its own
  list, so tapping the top suggestion for `b` never lands on `b` itself. Measured against the
  built index, `limit=10`: `suggest("b", 10)` returned `b, b major, b-flat, b-flat major, b-side,
  baa, bab el mandeb, baba ganoush, baba yaga, babalawo` before the filter and drops only the
  first; `suggest("a", 10)`, `suggest("i", 10)`, `suggest("p", 10)` and `suggest("s", 10)` each
  keep one or zero one-letter entries at their head, so the visible list past the fix is at most
  one item shorter, never empty. The price, taken knowingly: the ten entries behind those keys
  become unreachable by any typed query — `normaliseHeadword` strips a trailing period before the
  index is ever consulted, so `b.` already collapsed to the same `b` the bare letter did; there was
  no second spelling to fall back to, and this fix removes the only one that reached them.

- **The senses of a headword are ordered by measured frequency, not by a fixed rank. Decided by the
  user 2026-09-11.** `index-build.ts:22`'s `POS_RANK` put `v` before `n` so that «leave» would show
  «dejar» before «permiso»; the same rank is what put `grudge`'s rare verb «diñar de mala gana» in
  front of «rencor», which the user hit reading. No single rank gives both, because the right order
  is a fact about each word. Measured against the built index that day: 4,650 of 58,946 headwords
  carry more than one part of speech, SUBTLEX-US covers 3,888 of them, 2,681 can be ordered, and
  **1,797 of those 2,681 — 67.0% — sit in the wrong order today**. The 762 headwords SUBTLEX has no
  row for keep `POS_RANK` and change nothing.
- **Quote the generator, never the prototype that argued for it.** The measurement that opened this
  decision said 1,808 rows and a 40.9 KB table; what shipped is 1,797 and 54.4 KB, and for a day the
  paragraph carrying a non-commercial licence decision described neither. The eleven rows are
  headwords used equally often in two parts of speech, where nothing defines a winner; the kilobytes
  are the one-entry-per-line format the repo prefers over a minified line. `npm run pos:build`
  prints both numbers, so there is no reason to carry an older one.
- **Its source is CC BY-NC-SA 4.0, and that price was taken knowingly.** SUBTLEX-US with
  part-of-speech information is non-commercial and share-alike, so the derived table ships under the
  same licence and the app stays non-commercial while it does. The credit goes on `/cuenta`, in
  `CuentaInformacion`, as one more `MetaLabel` block beside the dictionary's own FreeDict credit and
  the per-photo credits.
- **No board was drawn for either, and neither needs one.** The order changes what a sense list
  says, never how it is drawn: `PalabraCategoria` already draws a stack of sense groups behind their
  category labels, in all four faces, and a stack reordered is the same board. The attribution is the fourth repetition of a block
  `CuentaInformacion` already draws three times — same `MetaLabel`, same `Text`, same `Separator`,
  no new layout, no new control. A face nobody drew here is a face nobody needed.
- **The photo is gated on measured concreteness, and a word with no score gets none. Decided by the
  user 2026-09-11.** RL-36 has said «concrete noun» since it was written and the route never tested
  either half: `openverse.ts:86` searched the bare headword, and the only guard in the chain asked
  whether the word was in the dictionary, never what kind of word it was. The 93.3% that justified
  the design measured whether a photo came back, never whether it had anything to do with the word —
  coverage is not relevance, and nobody had measured relevance until this day. What it measured:
  **20 of 36 relevant overall**, 12 of 12 for concrete nouns, **2 of 12 for abstract ones**.
- **Filtering on part of speech alone was measured and refused.** All 12 abstract headwords probed
  carry a noun sense in the index, so the filter RL-36's own wording seems to ask for lifts relevance
  from 55.6% to 58.3% and leaves `grudge` exactly where it was.
- **The price, taken knowingly: the photo becomes rare.** 9,942 of 58,946 headwords can carry one,
  against every headword today, and 22,896 noun headwords go without because the norms have no row
  for them. Rarity is the right failure here — `PalabraSinFoto` is already drawn, and a reader who
  sees no photo loses nothing, while a reader who sees the wrong one stops trusting the screen.
- **The rows already cached must go.** `reading.word_photos` has no expiry, so every word resolved
  before this change keeps serving the photo it got under no filter at all.
- **No board for this either.** `PalabraFoto` and `PalabraSinFoto` already draw both outcomes; this
  decides which a word reaches, and adds no state to draw.
- **Concreteness alone still lets pronouns and time nouns through, and a closed list is what
  removes them. Decided by the user 2026-09-11.** `we` scored above the threshold and returned an
  axe head, which at 76 px in dark reads as a blank square; `you`, `him`, `time`, `hour`, `minute`,
  `week`, `war`, `sale` and `spare` sit in the same file. `build-concreteness.ts` asks only for
  `pos === "n"`, and Wiktionary grants that to the corporate «we».
- **Requiring the first sense group to be a noun was measured and refused.** It reads as the
  general rule and it is not one: measured against the shipped index, it leaves `we`, `him`,
  `time`, `hour`, `minute`, `week` and `sale` photographed — 7 of the 10 words that prompted it,
  the axe-head `we` included — because the dictionary tags them `n` and RL-43's order puts that
  group first. It costs **871 of 9,942 (8.8%)** photographable words that deserve one, whose first
  group happens to be a verb or adjective: `abscess`, `ace`, `aim`, `antique`, `asphalt`, `alien`.
  A rule that generalises in argument and not in measurement is worth less than the list it
  replaces.

- **A word the dictionary has no entry for is answered over the network on its own, and the reader
  asks for nothing. Decided by the user 2026-09-11**, on their own words: «esta palabra me apareció
  en el libro entonces existe, la ia debió darme una traducción con una oración y cosas no
  simplemente decirme "no la tenemos te jodes"». **This retires `RL-29`**, whose whole point was
  that nothing left the device until the reader pressed a control. Written as `RL-44`.
  - What it answers, measured in production at 22:43–23:17 on 2026-09-11, after that day's deploy:
    `whereat`, `coccidiosis`, `mangels` and `milk-pails` all reached «El diccionario no tiene esa
    palabra. Revisa la ortografía o prueba con otra forma de la palabra» — four real words, one of
    them hyphenated, none of them a typo, and `RL-28`'s suggestions had nothing to offer any of them
    because they are not misspellings of anything.
  - The dead end is the defect, not the missing entry. A dictionary of 58,946 headwords will always
    miss the word in the book in front of the reader.
  - **The answer must say it did not come from the dictionary, and say plainly when it could not be
    produced.** That half of `RL-29` survives into `RL-44` unchanged.
  - **The cost, taken knowingly:** one network call per word the dictionary misses, with nobody
    authorising it. `RNL-09` is untouched — what leaves is the word, never the record.
  - Boards, canvas **version 32**, page «Buscar · sin respuesta», dark × mobile — the primary face,
    and the only one: nothing but the palette changes in light, and `SinResultadoIA` /
    `SinResultadoIAFallo` already stand in light from the control-first design.
    `SinResultadoIACargando` (the word and the stamp painted at once, the rest reserved, quiet and
    not spinning), `SinResultadoIA` (translation, English definition, example with its Spanish),
    `SinResultadoIAFallo` (the `## Failure` shape: hairline, failure line in full-weight ink, retry
    in the ordinary accent button — no red is added, this palette has none).
  - **An answer that arrives without a definition drops the line, and is not a failure. Decided by
    the user 2026-09-12.** `definition` is `string|null` in the route's own contract, so the state is
    reachable and not an edge. The label «Definición en inglés» and its paragraph both disappear and
    the hairline closes over the example — no reserved gap, and no text explaining the absence. A
    technical word whose translation is its cognate is answered in full by the example; calling that
    a failure would throw away what did arrive. A missing *translation* is a different thing: there
    is no answer at all, and that state stays `SinResultadoIAFallo`.
  - Board, canvas **version 33**, page «Buscar · sin respuesta»: `SinResultadoIASinDefinicion`,
    dark × mobile, fourth in the RL-44 row at x 1440. It takes for granted that translation and
    example are both there.
  - **Stale: `SinResultadoSinPista`**, which draws the dead end this replaces, and the light
    `SinResultadoIA` / `SinResultadoIAFallo` pair, drawn behind a control that no longer exists.
  - **No board exists for the light face of any of RL-44's four states, and none is needed**: the
    token table says what light is, and drawing it again repeats a decision instead of taking one.

- **A dictionary answer that is thin is completed over the network. Decided by the user
  2026-09-11**, on their own words about `snuff`: «me dice palabras todas tontas cuando en google sí
  me recomendó, y era aspirar, no era muy difícil la palabra como para no saberla». Written as
  `RL-45`.
  - Measured in production the same night: `snuff` answered «apagar, despabilar» for the verb and
    «rapé» for the noun. Google Translate, on the same string, led with «aspirar».
  - This is the first time the network touches a word the dictionary **does** carry. It is deliberate
    and it is narrow: what arrives is added underneath what the dictionary said and marked as coming
    from the network, never substituted for it.
  - **What counts as thin is not decided yet, and it is the whole of this code's risk.** Too loose
    and every word pays a round trip; too tight and `snuff` stays wrong. Measure the distribution
    over the shipped index before writing the threshold, never after.
  - Board, canvas **version 32**, page «Buscar · la palabra»: `PalabraCompletada`, dark × mobile.
    The network line sits under the dictionary's own inside the same sense group, carrying a small
    outlined «por internet» tag rather than the full-width stamp — provenance without turning half
    the screen into labels. **No board for the un-completed case:** that is `Palabra`, unchanged.

- **A translated sentence carries a note on the terms that are not obvious. Decided by the user
  2026-09-11**, on their own words: «aquí es donde me gustaría que al traducir una oración también
  definamos cosas como qué es un black minorca, que al menos haya un poco de aprendizaje en la
  oración, no simplemente la traducción». Written as `RL-46`.
  - Measured: `black minorca pullets` answered «pollitas negras de menorca» and stopped. The reader
    learned the words and not the thing.
  - The app picks which terms earn a note. A note on every word is `RL-31`'s word-by-word list,
    which already exists and is a different answer.
  - Board, canvas **version 32**, page «Buscar · la frase»: `FraseConNotas`, dark × mobile. The
    notes follow the sentence's own order, not importance: the reader is following their own text.
    **No board for a sentence with no term worth a note** — the «En la oración» block is not drawn
    and the screen is `Frase`, which already exists.

- **The form the reader typed leads the answer, and the headword it inflects from sits underneath.
  Decided by the user 2026-09-11**, on their own words: «busco reading, la app debería decir
  leyendo o algo relacionado, y luego abajo sí la recomendación de que esta palabra es una forma de
  read, y así yo entenderé — no quitarme el completo significado». **This retires `RL-40`**, taken
  2026-09-10, which put the exact entry on top and offered the inflection below it. Written as
  `RL-47`.
  - **RL-40 was right about the case it answered and wrong about this one.** It exists because
    `bed` must not draw «"bed" es una forma de "b"», and that still holds: an exact entry the reader
    typed on purpose still wins. What it never answered is the form that is *only* a form — where
    the entry on top is a different word wearing the same spelling.
  - Measured in production 2026-09-11 at 23:17: `swishing` answered **`swish` · ADJETIVO ·
    «sofisticado, refinado»**. An `-ing` cannot come from an adjective; the reader typed a verb form
    and got a word about taste. `sternly` answered **`stern` · SUSTANTIVO · «popa»** — a ship's
    stern, for an adverb of the adjective. `shrieked` and `fidgeted` answered the bare infinitive:
    correct and still not what was asked.
  - **The form's own translation is what leads, resolved over the network when the dictionary has
    no row for it**, with one example sentence. «es una forma de X» keeps `PalabraConFlexion`'s rule
    and left border, now carrying the headword's groups underneath rather than above.
  - **The cost, taken knowingly:** a network call on every inflected form the dictionary cannot
    translate on its own. Answering the form from the lemma where the inflection is regular was
    offered and **not** taken: the reader chose the form's own answer in every case.
  - Boards, canvas **version 32**, page «Buscar · la palabra», dark × mobile: `PalabraFormaPropia`
    and `PalabraFormaPropiaCargando`. The second draws the lemma and its groups already painted —
    they come from the device — with the form's own answer reserved, quiet and not spinning, the
    shape `PalabraTextoAntesDeFoto` settled 2026-09-11.
  - **No board for the form the dictionary can translate on its own** (`left`): the «Por internet»
    stamp is not drawn and nothing else changes, so drawing it would repeat a decision.
  - **Stale: `Flexion`**, which draws the case RL-47 reverses — the form typed is not a headword of
    its own, so the lemma's entry is the whole answer and stands above nothing.
  - **`PalabraConFlexion` is not stale, and an earlier line here said it was.** It draws the exact
    entry on top with the inflection offered below, which is the `bed` clause RL-47 **keeps**: a
    reader who types `left` still gets `left`'s own entry first. What RL-47 reverses is the case that
    board never drew — the form that is *only* a form, where the entry on top is a different word
    wearing the same spelling.

### The four numbers this slice runs on, decided 2026-09-11

- **The network answer arrives even when a correction fits. Decided by the user 2026-09-11.**
  `RL-44` as first written said «when a search finds nothing **and no suggestion fits**», and the
  measurement killed that clause: `whereat` **does** have a candidate, `whereas`. Read literally, the
  word the reader met in their book would stay in exactly the dead end they photographed. The
  correction is offered first and the network's answer for **the word as typed** lands underneath it.
  The clause is struck from `RL-44`.
  - The cost, taken knowingly: a call on real typos too, where the reader will take the suggestion
    and never read what arrived.
  - Board: `SinResultadoIA` gains `Sugerencias`' offer above its hairline; both already exist.

- **One global daily ceiling, raised. Decided by the user 2026-09-11**, who chose the global ceiling
  over a per-route one. **The number is 500 and it is mine, not theirs** — they said «súbelo» without
  naming one, and a ceiling is one variable, so this is the cheapest thing in the slice to move.
  - Why 50 cannot stand: it was sized when `RL-42` alone bit. Measured, **98.5% of inflected forms
    have no row of their own**, so `RL-47` spends a call per new form on top of `RL-42`'s per new
    word, and `RL-46` spends one per sentence. A reading evening of 40 new words, 40 new forms and
    20 sentences is ~100 calls. At 50 the reader hits tonight's screen halfway through a chapter.
  - Why not much higher: the word path caches **forever and for every reader**, so its steady state
    falls away. `RL-46` is the only one that keeps costing, and 500 leaves it room without leaving
    the bill open.

- **`RL-46` ships on, with its ceiling. Decided by the user 2026-09-11**, over shipping it dark and
  over putting its notes behind a control. It is the first time the reader's own free text reaches a
  paid model — the sentence already leaves for MyMemory, but a translator is not a model — and it is
  the code that caches least: a sentence out of a book is unique, so it is ~1 call per sentence
  against one call per word for every reader who ever looks that word up.
  - The guard is the plan's, unchanged: **12 tokens, 200 characters, and the sentence is never stored
    in the clear.**

- **«Thin» is `≤4 translations` and `(≥2 senses or no definition)`: 9,685 of 58,944 lemmas, 16.4%.
  Decided by the user 2026-09-11**, who asked for wider than the first rule measured.
  - The ladder that produced it. **These are `check:thinness`'s numbers, over the real runtime
    pipeline**: `buildIndex` groups the shipped asset into **58,944 lemmas**, which is `manifest.json`'s
    own count, asserted as D1. An earlier table here read 59,253 and was mine — I grouped raw entries by
    headword string without `normaliseHeadword`, so variants counted as separate lemmas. The shape of
    the conclusion did not move; every figure did, by about two tenths of a point.

    | rule | lemmas | share | catches |
    |---|---|---|---|
    | `≤3 tr` and `≥2 senses` | 1,885 | 3.2% | `snuff` |
    | `≤4 tr` and `≥2 senses` | 2,463 | 4.2% | `snuff`, `stern` |
    | **`≤4 tr` and (`≥2 senses` or no definition)** | **9,685** | **16.4%** | `snuff`, `stern` |
    | `≤5 tr` and (`≥2 senses` or no definition) | 10,681 | 18.1% | `snuff`, `stern` |
    | `≤4 tr`, no sense floor | 52,991 | 89.9% | everything, including `swish` |

  - **The sense floor is what stops it being every word**, and dropping it is the cliff: 4.2% → 89.9%
    in one step. What widens it safely is the missing definition — a word answered thinly **and** left
    undefined is thin twice over. That clause alone is 2.9% → 13.6%.
  - It catches `stern`, which the reader also hit: `sternly` answered «popa» off a 4-translation,
    2-sense entry. It leaves out `swish` (1 sense, 1 translation — thin because the word is simple),
    `clamp` (10), `read` (8) and `black` (11).

### What one real chapter measured, 2026-09-12

The reader signed in and read a chapter — **55 lookups in 43 minutes**, 22:39 to 23:22 Bogotá,
copied up to their account. It is the first time this app has been measured against real reading
instead of against the dictionary. The book is *Animal Farm*: `black minorca pullets`, `beech
spinney`, `fore hoofs`, `snuffed the ground`.

| what | measured |
|---|---|
| words / sentences | 45 distinct words, 10 sentences |
| exact / inflected | **24 exact, 21 inflected** |
| sentences translated **on the device** | **0 of 10.** Every one went to the network |
| misses recorded | **0** — and see below |

- **`RL-47` is not an edge case: it is 21 of 45 word lookups, 47%.** Nearly half of what this reader
  typed was a form, not a lemma, and this is the session that returned `swishing` → «sofisticado» and
  `sternly` → «popa».
- **`RL-45`'s threshold holds against real use.** The rule catches **8 of these 45 words, 18%** —
  `gilded`, `sleet`, `stern`, `snuff`, `envious`, `edible`, `shriek`, `rejoice` — against 16.4% of
  the dictionary at large. Calibrated, not lucky.
- **The ceiling of 500 is now grounded.** This session alone is **45 + 21 + 10 ≈ 76 calls in 43
  minutes**. At 50 the reader hits the wall around minute 28, mid-chapter. 500 buys about 4.7 hours.
- **`RL-08` never fires on this reader's phone.** 10 of 10 sentences carry `origin = network`, so
  every sentence is already a paid round trip and `RL-46` adds its note to a call that happens
  anyway.

**The record cannot see the app's own failures, by design.** `lib/log/record.ts:252` sets
`LOGGED_OUTCOMES = {exact, inflected, translated}`, so **`miss` and `untranslated` are dropped before
they reach IndexedDB** — the comment above `commit` says a miss must never be stored. That is why
this log holds zero misses while the same evening's screenshots show four: `whereat`, `coccidiosis`,
`mangels`, `milk-pails`. The reason is sound — every prefix of a word being typed is a miss — but the
consequence is that **the words that failed the reader are the only ones the app throws away**, and
no measurement of how often the dead end fires is possible from the record. Open question for the
user; nothing is built either way.

**The dictionary is thin at one end and padded at the other, and only the thin end has a code.**
Median translation list this session: **4**. But **13 of 45 words carry 8 or more** — `shiver` 12,
`frost` 11, `tear` 11, `trample` 10, `creep` 10, `clamp` 10 — and the padding is archaic or regional:
`creep` answers a story about animals creeping with «deformación por fluencia lenta, fatiga, alimaña,
degenerado, depravado»; `gnaw` offers «chancomer, rosigar, rustir, concomer, recomer, reconcomer»;
`pullet` offers «polla» alone, which is vulgar in half the language's speakers. `RL-45` completes the
thin end. **Nothing trims the padded end, and no code is opened for it** — it is the user's to decide.

### Pruning the dictionary was measured and refused, 2026-09-12

The user asked for the padded translation lists to be trimmed when the asset is built. **Measured,
there is almost nothing to trim, and trimming would not have changed one word of their chapter.**

- **Within a part-of-speech group — which is how the screen draws it — the median is 1 translation
  and the 90th percentile is 4.** Only 5.9% of the 64,258 groups hold more than five. Cutting every
  group to five removes 7.3% of the asset's translations and touches tails the reader never reaches.
- The mechanical rules fare no better. Dropping a translation that echoes the English headword is
  4.42% of all translations; dropping a gloss of three words or more is 11.4%; together they take
  15.8% and leave **10,335 senses with nothing at all**, so a floor would hand most of it straight
  back. Against the reader's own chapter: `creep` 10 → 9, `clamp` 10 → 9, `gnaw` 9 → 9,
  `trample` 10 → 10, `pullet` 1 → 1. Nothing that mattered moved.
- **The flat soup the reader saw was `/registro`, not the word screen.** `RL-34` stores one
  translation string cut to 120 characters, so the record flattens every group into one line —
  «deformación por fluencia lenta, fatiga, alimaña, degenerado» is that field, not the answer.

**The real defect is which group leads, and a corpus cannot fix it.** `creep`'s noun group holds 8
translations and leads; its verb group holds 2 — «reptar, hormiguear» — and comes second. `RL-43`
would keep it that way: SUBTLEX scores `creep` **`"nv"`**, and in film subtitles the noun really is
commoner. A corpus-wide order cannot know the reader is in *Animal Farm*.

**What the reader typed knows more than the corpus does.** Measured over their 21 inflected forms:
**16 carry a suffix that pins a part of speech** — only a verb takes `-ing` or `-ed`, only an
adjective takes `-ly` — and **in 5 of those 16 the group that leads is the wrong one**, every one of
them a case `RL-43`'s table would also get wrong:

| form | lemma | leads | the suffix demands | SUBTLEX says |
|---|---|---|---|---|
| `creeping` | `creep` | noun | verb | `nv` |
| `shrieked` | `shriek` | noun | verb | `nv` |
| `frosted` | `frost` | noun | verb | `nv` |
| `toiled` | `toil` | noun | verb | `nv` |
| `sternly` | `stern` | noun | adjective | `nj` |

- **This becomes a clause of `RL-47`, not a code of its own:** when the form's suffix pins a part of
  speech, that group leads. It is the same decision — the form the reader typed governs the answer —
  and it costs **no network call and no table**: the suffix is already parsed to find the lemma.
- It is the cheapest thing in this slice and it fixes `sternly` → «popa» outright, on the device,
  with no connection.
- **`pullet` → «polla», alone, is none of the above.** One sense, one translation, and that
  translation is vulgar to half the language's speakers. It is not padding and not order: the
  dictionary is simply thin there, which is `RL-45`'s case.

- **A search that found nothing is recorded too. Decided by the user 2026-09-12.** Written as
  `RL-48`. `lib/log/record.ts:252` keeps `{exact, inflected, translated}` and drops `miss` and
  `untranslated` before they reach IndexedDB — deliberately, because every prefix of a word being
  typed is a miss. The settling rule already solves that: it is what stops «wher» becoming a row, and
  it applies to a miss exactly as it applies to a hit.
  - What it cost: the reader's own log held **0 misses** for the evening whose screenshots show four
    — `whereat`, `coccidiosis`, `mangels`, `milk-pails`. The words that failed them are the only ones
    the app throws away, and how often the dead end fires cannot be counted from the record.
  - **No new screen, and no board.** `/registro` draws a recorded lookup; this adds rows to it, not a
    view. The user was offered a «what I could not answer» screen and did not take it.
