# Goal log — design guide

Governs `apps/pulsar` alone. `docs/DESIGN.md` governs `apps/orbit` and `docs/voyager/DESIGN.md`
governs `apps/voyager`; neither applies here and no pattern crosses over because it exists next door.

Approved by the user 2026-09-22 from the canvas
<https://claude.ai/artifact/5ZNtobfQDzeBNFcEMs38Qp>.

## The direction: Bitácora

A ship's log: what happened, when, and who wrote it down.

- **The design has no colour for failure.** A commitment done is the accent; one not done is an
  empty outline. No red anywhere, no broken streak, no badge, no praise. Decided by the user
  2026-09-22. A palette with no red is what enforces it — a later screen cannot reach for one.
- **Light is the primary face.** Dark is the same design inverted, never a second design.
  `apps/voyager` is dark-first; this app inherits nothing from it.
- **A figure is set in mono, a sentence in Archivo.** Hours, counts, minutes, dates and quantities
  are the log's substance: they read as a log or they read as decoration.
- **Writing a fact costs one tap.** No form stands on the day's path. What needs a number offers it
  already filled.
- Rule between rows with a hairline. Never a card, never a border box.

## Tokens

Light, the primary:

| role | value |
|---|---|
| ground | `#EDEFF2` |
| raised (a sheet, a field, the tab bar) | `#FFFFFF` |
| line | `#DCE1E7` |
| border | `#C7CED7` |
| ink | `#12171C` |
| ink, secondary | `#333C45` |
| muted | `#5E6874` |
| quiet (strokes and decoration only) | `#8A939E` |
| accent | `#1C6E5A` |
| accent, soft (the evidence mark's fill) | `#DCEAE5` |

Dark, the same design inverted:

| role | value |
|---|---|
| ground | `#0F1317` |
| raised | `#161B20` |
| line | `#222930` |
| border | `#2B333B` |
| ink | `#E7ECF1` |
| ink, secondary | `#C3CBD3` |
| muted | `#949EA9` |
| quiet | `#5C666F` |
| accent | `#4FBEA0` |
| accent, soft | `#17332C` |

- The accent is a different hex per face, not one colour at two opacities. `#1C6E5A` has too little
  contrast on the dark ground; `#4FBEA0` has too little on the light one.
- **muted is the smallest text colour there is.** `quiet` never carries a word a person must read:
  it draws strokes, empty marks and the units beside a figure.
- Text on the accent is `#FFFFFF` on the light face and `#0F1317` on the dark one.

## Type

- Sentences, headings, commitment names and controls: **Archivo**, fallback `system-ui, sans-serif`.
- Every figure: **DM Mono**, fallback `ui-monospace, monospace`, `letter-spacing: 0.02em`.
- Set a section label at 11 px, mono, uppercase, `letter-spacing: 0.14em`, in **muted**. It names a
  goal or a group, never a state.
- Set a screen title at 27 px / 600 / `-0.02em` on the phone, 38–44 px / 600–700 / `-0.03em` wide.
- Set a commitment name at 16 px / 500. Its metadata line is mono 12 in muted.
- Set the measure at 26 px mono / 500, with its unit beside it at mono 11 in quiet.

## The marks

Three states, one shape — a 24 px circle at the head of the row:

| state | mark |
|---|---|
| done, declared | filled accent, a `#FFFFFF` check inside (`#0F1317` on dark) |
| done, by evidence | accent-soft fill, 1.5 px accent border, an accent check |
| not done | 1.5 px border, nothing inside |

- The two done marks differ so a day marked by another app never reads as one the person said they
  did (RP-09). The difference is fill, never hue: a second hue would be a second accent.
- A row is a real `<button>`, never a div. Minimum 56 px tall; every other control minimum 48 px.
- Radius: 10 px on a control or a field, 16 px on the top corners of a sheet.

## The boards

On the canvas, in three pages. A module that draws a screen cites its board by name.

| board | what it holds |
|---|---|
| `Main.dc.html` | the direction, both palettes and the type scale |
| `Hoy.dc.html` | the day with work left, one goal |
| `HoyVarias.dc.html` | two goals open and two one-offs that belong to none — the general case |
| `HoyOscuro.dc.html` | the same day on the dark face |
| `HoyCantidad.dc.html` | the sheet that takes a quantity and its optional line (RP-03, RP-04) |
| `HoyCompleto.dc.html` | every commitment satisfied, with no congratulation |
| `HoyVacio.dc.html` | no goal open yet |
| `HoyCargando.dc.html` | the day while it loads |
| `HoySinEvidencia.dc.html` | a source that could not be read (RNP-04) |
| `Semana.dc.html` | the week with its gaps (RP-16) |
| `Revision.dc.html` | the measure week by week, on the phone (RP-17) |
| `RevisionEscritorio.dc.html` | the same table wide |
| `Meta.dc.html` | a goal's commitments, cadences and phases |
| `MetaNueva.dc.html` | the least it takes to open a goal |
| `Entrar.dc.html` | the link sent to an address (RP-18) |

## The boards that do not exist

Say what is missing, so a gap nobody drew reads as a gap nobody needed.

- **Dark beyond `HoyOscuro.dc.html`.** Every other state is this design with the dark column of the
  token table. Drawing it again repeats a decision instead of taking one. Decided by the user
  2026-09-10, for every app.
- **A wide face beyond `RevisionEscritorio.dc.html`.** Only the review's table changes shape rather
  than width. The rest is used with one thumb.
- **Adding or retiring a commitment (RP-12, RP-13).** `Meta.dc.html` lists them; nothing draws the
  act. Draw it before its module.
- **The one-offs with no day (RP-21).** Their list is named in the contract and drawn nowhere.
- **Writing a fact for a day already past (RP-06).** Not drawn.
- **The moment a phase ends (RP-15)** and the review's own act — recording the answer again. Not drawn.

## Decisions taken here

- **How much evidence satisfies a day (RP-08): one search.** Taken by the user 2026-09-22.
  `Meta.dc.html` draws «1 búsqueda · diccionario»; the day boards draw 55, which is the real figure
  measured in `reading.lookups` that day. The threshold is per commitment and the person can raise it.
