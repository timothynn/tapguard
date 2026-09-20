# TapGuard

**Offline-first transit fare validation with live clone detection.**
Built for the Nairobi Metropolitan Mass Rapid Transit System (Phase I) and BRT context.

> Hackathon track: **Everyday** — a tool for a real recurring job.
> The job: validating a fare tap and triaging card fraud, every day, at every gate.

---

## The problem

Nairobi City County approved Phase I of the Nairobi Metropolitan Mass Rapid Transit
System on 31 July 2026: a 30 km network whose core is a 10 km underground run through
the CBD with stations at Upper Hill, KNH, Parliament, City Hall, Kenyatta Avenue,
Railways/Muthurwa, University Way, Museum Hill, Westlands and Sarit Centre.
Construction starts around 2030. **The ticketing layer is still an open design question.**

Meanwhile the fare world that exists today — matatus and the coming BRT — runs on M-Pesa
and a patchwork of contactless cards. Two facts collide:

1. **Legacy contactless media is cloneable.** MIFARE Classic, still deployed in London,
   Boston and Mexico City, can be copied by someone standing next to you for a couple of
   minutes. Cryptography on the card alone cannot save a system whose keys have leaked.
2. **Gates are frequently offline.** Tunnels, power cuts, fibre breaks, and matatus with no
   reliable link. A gate that can only validate when the network is up is not a gate.

A fare validator therefore has to answer, in under a second and with no network:
*is this media genuine, is it being used in two places at once, and has it been revoked?*

## What this is

Two self-contained HTML pages. No build step, no dependencies, no server.

**Live:** https://timothynn.is-a.dev/tapguard/

| File | What it does |
|---|---|
| [`tapguard.html`](tapguard.html) | The **operator console** — a live, interactive validator you drive yourself. Two station gates, a rider wallet, a bilingual USSD handset on `*384#` with SMS fallback, a network switch, a reconciliation backend, a fraud-triage feed and an operations intelligence layer. |
| [`tapguard-simulation.html`](tapguard-simulation.html) | **Field simulation** — an 88-second narrated animation of the clone scenario from the operator's side, with synthesised sound and spoken narration. |
| [`tapguard-ussd.html`](tapguard-ussd.html) | **Lost Card, No Smartphone** — a 90-second narrated animation of the same system from the rider's side: a card lost on a matatu, blocked over USSD from a feature phone, refused at the gate. Uses real DTMF keypad tones. |
| [`verify/detection-logic.mjs`](verify/detection-logic.mjs) | An independent Node check that replays the whole scenario and asserts every outcome. |
| [`verify/intel-engine.mjs`](verify/intel-engine.mjs) | 137 assertions against the analytics layer, extracted live from the page so it cannot drift. |
| [`index.html`](index.html) | A landing page linking the three. |

Open any of them directly in a browser. No build step, no dependencies, no server.

## How detection actually works

Every tap is a signed token, not a card number.

```
token = HMAC-SHA256( key_card , cardID | counter | stationID | timestamp )
```

Signing and verification run in-browser via the WebCrypto API. Keys are per-card. The
gate verifies locally, so **no network round trip is required to accept a fare.**

The validator then applies four checks, in order:

| # | Check | Catches | Works offline? |
|---|---|---|---|
| 1 | Signed deny-list membership | Known-revoked media | ✅ yes |
| 2 | HMAC signature verification | Forged / fabricated media | ✅ yes |
| 3 | Counter monotonicity | Replayed tap tokens | ✅ yes |
| 4 | Impossible travel between stations | **Cloned media in active use** | ⚠️ only where the store has seen both stations |

Check 4 is the interesting one. When gates are networked they share a last-seen table, so
a clone tapping at a second station within the minimum plausible transfer time (120 s) is
refused in real time. When gates are **offline** they are islands — each one legitimately
accepts, because neither can see the other. That gap is closed on reconciliation:

- Offline gates buffer every accepted tap locally.
- On reconnect, buffers merge into one backend timeline.
- Any card appearing at two stations closer together than physics allows is a confirmed clone.
- The card is revoked, the deny-list is re-signed with the operator key, and the new
  version is pushed to every gate — so the clone is refused everywhere, online or not.

A real-time block stops the ride; **permanent revocation is a reconciliation decision**, not
a gate decision. That separation is deliberate: the legitimate holder may be the one
standing at the gate.

## Verifying the logic

The detection rules are not just asserted in the UI — they are checked independently:

```bash
node verify/detection-logic.mjs
node verify/intel-engine.mjs
```

The first replays the full seven-step scenario against the same rule set and asserts each
outcome (clean accept → clone created → real-time block → outage → double offline accept
→ reconcile revoke → refused everywhere). It caught a genuine bug during development: the
real-time clone block was auto-revoking the card, which made the offline branch
unreachable.

The second runs 137 assertions against the analytics layer. It does not hold its own copy
of that code — it **extracts the engine from `tapguard.html` at run time**, between marker
comments, so it always tests what actually ships. Among the things it pins down:

- no ordinary journey in the whole corpus reaches even the watch band (the false-positive
  check that forced both scoring redesigns above)
- a behavioural score can never produce a block or a revocation, at any band
- a card with too little history is banded `insufficient`, never accused
- every query answer matches a hand count over the same rows
- an unparseable question says so instead of returning the whole table
- Kiswahili covers every English string, and an offline block reply says *queued*, not
  *pushed*
- the engine exposes no accept/refuse entry point and touches neither crypto nor the
  deny-list

## USSD: the rider channel

Most fare-paying Kenyans reach a service on a feature phone, not an app. The console
includes a working **USSD handset on the shortcode `*384#`**, running against the same
state the gates use — not a mockup.

```
*384#
  1. Check balance          balance, status, last trip
  2. Top up fare            KSh 20 – 5,000, credited immediately
  3. Report card lost       revokes the card at every gate
  4. Why was I refused?     plain-language reason for the last refusal
  5. Last 3 trips           station and fare per trip
  0. Exit
```

The important one is **3**. A rider who loses a card dials the shortcode and blocks it
themselves. That revocation bumps the deny-list version, re-signs it with the operator key
and pushes it to every gate — so the card is refused on the next tap without anyone
phoning a call centre.

It also behaves correctly when the network is down. If the gates are offline, the block is
**queued** rather than claimed as applied, and the handset says so. It reaches the gates at
the next reconcile, on exactly the same path as a clone revocation.

Sessions time out after 120 seconds like the real thing. The PIN step is deliberately
omitted — this is a simulation and should not train anyone to type a PIN into a demo.

### Kiswahili, and SMS for riders with no session

The whole handset runs in **English or Kiswahili** — menus, confirmations, validation
errors, refusal reasons. Option `9` switches language mid-session and lands you back on a
menu you can read; the choice is remembered per viewer and survives a demo reset. The
operator console stays in English: the rider channel is the part that has to meet people
where they are.

Below the handset is an **SMS fallback to 22384**, for riders with no USSD session or no
credit. It takes free text in either language:

```
"nimepoteza kadi yangu"  → card blocked, deny-list re-signed and pushed, reply in Kiswahili
"what is my balance"     → balance and card status
"asdfgh"                 → "Sorry, we did not understand. Reply BALANCE, LOST or TRIPS."
```

Two deliberate choices here. First, **free text lives only on SMS, never on the keypad**: a
rider at a gate needs a deterministic numbered menu, and a misread on SMS costs a
clarifying reply rather than a fare or a wrongful block. Second, every SMS-triggered
revocation records **the parsed intent, the detected language, the confidence and the
original text** in the incident evidence, so an operator can always see that the system
acted on an interpretation, and check it.

Offline, SMS behaves exactly like the handset: the reply says the block is *queued*, and
the gates genuinely do not have it until the next sync.

> The Kiswahili strings were written for clarity over register and want a native
> reviewer before any real deployment.

## Operations intelligence

A back-office layer over what the gates recorded: triage, behaviour, query and demand.

**No model sits in the gate decision path.** Accept or refuse stays deterministic
cryptography — offline, sub-second, explainable, and identical every time. Everything in
this section reads the record *after* the fact. That boundary is asserted in the test
suite, not just claimed here.

| Tab | What it does |
|---|---|
| **Triage** | Clusters every signal about one card — rule hits and behaviour — into a single case with severity, confidence, exposure, a written summary and a recommended action. |
| **Behaviour** | Scores each card against **its own** fourteen-day pattern: stations, hours, trips per day, time between taps. |
| **Ask the record** | Plain-English questions over every tap on record, parsed to filters and executed literally. |
| **Demand** | Expected taps per hour per gate for the next six hours, with crowding against stated gate capacity. |

### What the behavioural layer is for

The four cryptographic checks catch forged, replayed and duplicated media. They cannot
catch a card that is **quietly shared or borrowed**, because every individual tap is
genuine: real media, correct counter, physically possible timing. The gate is right to
accept all of them.

The console seeds exactly that case. `K156` (Mwangi S., normally two off-peak trips a day)
is being passed around a household — eight trips today, every one accepted. The behavioural
layer scores it 85/100 while the three ordinary commuters score **zero**, and the
recommendation is still *"Watch — do not block yet"*:

> Unusual travel is not proof of anything. Blocking a legitimate rider on behaviour alone
> strands them at a gate with no way home. Wait for a cryptographic signal before acting.

That restraint is enforced in code and in the tests: no behavioural score, at any band, can
produce a block or a revocation.

Two design decisions worth naming, both found by testing rather than by reasoning:

- **Novelty is measured against what a card does most, not against its total.** A commuter
  concentrates into two windows and two stations. Dividing by the total made even their
  usual 08:00 tap look rare and put the entire roster on the watch list.
- **Factors combine by noisy-OR, not a weighted sum.** A weighted sum caps any one factor
  at its weight, so a card used four times its normal rate could never raise a case on
  volume alone — and volume is the single best signal for a shared card. Travelling at an
  odd hour has a ceiling *below* the alert threshold, so it can only ever corroborate.

Every point of every score comes from a named factor with a sentence attached, because a
score an operator cannot interrogate is one they will learn to ignore.

### On the word "AI"

Being precise, since it matters: **this layer is statistical and rule-based, not a language
model.** The triage copilot composes prose from structured evidence; the query parser does
intent and entity extraction; the forecaster is a historical mean weighted by weekday. All
of it is deterministic, runs offline, and can be traced line by line.

That is a deliberate fit to the problem, not a limitation worked around. A fare system
needs answers that are identical every time, auditable after an appeal, and defensible to a
regulator. The code marks exactly where a language model *would* earn its place — writing
the case narrative — and why it must stop there:

> `buildCases()` composes prose from structured evidence. To use a language model instead,
> send that evidence object to it and replace `case.summary` and `case.rationale` with the
> response. Keep `case.severity`, `case.action` and the gate decision itself rule-derived:
> a model that hallucinates a revocation strands a rider.

### Where the data comes from

The console carries fourteen days of history behind today: seven named riders with coherent
personas, plus anonymous station throughput so the demand curve is a real station's rather
than seven people's. All of it is generated from a seeded PRNG, so it is identical on every
load and in the test suite. Today's traffic is produced by running the **same `validate()`
path the live gates use** — every seeded row, incident and deny-list entry was produced by
the real rules, not written in by hand.

## Running the demo

The console walks you through it with a checklist that advances automatically as you go:

1. Tap Wanjiku's card at Railways/Muthurwa — clean accept.
2. Skim the card (one click) to create a clone.
3. Tap the clone at Upper Hill while online — blocked instantly on impossible travel.
4. Cut the gate link.
5. Tap the genuine card and the clone at different stations — both accepted locally.
6. Restore the link and reconcile — clone confirmed, card revoked, deny-list signed and pushed.
7. Tap the clone again — refused.

The simulation tells the same story as a narrated animation. Press **Play with sound**;
`M` mutes, the microphone button turns narration off so you can speak over it live.

## Design notes

- **No external assets.** All audio is synthesised with the Web Audio API; narration uses
  the browser's own speech synthesiser. Nothing to download or buffer.
- **Light and dark themes**, remembered per viewer.
- **Responsive** down to phone width.
- Fare and geography constants (KSh 50 flat CBD-core fare, 120 s minimum transfer,
  real Phase I station names) live at the top of each file.

## Honest limitations

This is a **reference implementation and demonstration**, not production software.

- Card keys are generated in-page for the demo. Real deployments need an HSM, per-card
  key diversification from a master key, and a key ceremony. None of that is here.
- The deny-list is signed but not distributed over a real transport, and there is no
  revocation of the signing key itself.
- Impossible-travel thresholds are a single constant. A real network needs a per-station-pair
  travel matrix, and tolerance for staff, interchanges and wheelchair boarding times.
- Revoking on a confirmed clone freezes the *legitimate* rider too. The console recommends
  refund and reissue, but the policy question — how long a rider is stranded — is a real
  operational cost this prototype only gestures at.
- No accessibility audit, no load testing, no formal threat model.
- The behavioural baselines are built from generated history, not real ridership. The
  scoring logic is real and tested; the distributions it learns from are synthetic, and a
  real deployment would find different thresholds.
- The demand forecaster is a historical mean by hour weighted toward the same weekday. It
  cannot see a match at Kasarani, rain, or a closed road, and it is a baseline rather than
  a serious forecasting model.
- The natural-language query understands a fixed vocabulary of cards, stations, outcomes
  and time expressions. It says so when it cannot read a question, but it is not
  open-domain.
- The Kiswahili strings have not been reviewed by a native speaker.
- SMS intent parsing is keyword-based. It is deliberately confined to a channel where being
  wrong is cheap, but "deliberately confined" is not the same as accurate.

## Context and sources

- Nairobi County approval of NMRTS Phase I, July 2026 — [The Star](https://www.the-star.co.ke/news/2026-07-22-city-hall-approves-phase-i-of-nairobi-metropolitan-mass-rapid-transit-system)
- Cracking MIFARE Classic — [NCC Group](https://www.nccgroup.com/research/cracking-mifare-classic-1k-rfid-charlie-cards-and-free-subway-rides/)
- Digital fare collection scale in Kenya — [O-CITY](https://www.o-city.com/blog/o-city-leads-kenya-contactless-payment-boom-by-scaling-digital-fare-collection-for-over-10000-matatu-buses)
- Transit fraud detection and revenue protection — [transit-fare.org](https://www.transit-fare.org/fraud-detection-revenue-protection/)

## Licence

MIT — see [LICENSE](LICENSE).
