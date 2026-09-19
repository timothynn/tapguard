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

| File | What it does |
|---|---|
| [`tapguard.html`](tapguard.html) | The **operator console** — a live, interactive validator you drive yourself. Two station gates, a rider wallet, a network switch, a reconciliation backend and a fraud-triage feed. |
| [`tapguard-simulation.html`](tapguard-simulation.html) | The **field simulation** — an 88-second narrated, animated walkthrough of the full scenario, with synthesised sound effects and spoken narration. |
| [`index.html`](index.html) | A landing page linking the two. |

Open any of them directly in a browser. That is the whole setup.

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
```

This replays the full seven-step scenario against the same rule set and asserts each
outcome (clean accept → clone created → real-time block → outage → double offline accept
→ reconcile revoke → refused everywhere). It caught a genuine bug during development: the
real-time clone block was auto-revoking the card, which made the offline branch
unreachable.

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

## Context and sources

- Nairobi County approval of NMRTS Phase I, July 2026 — [The Star](https://www.the-star.co.ke/news/2026-07-22-city-hall-approves-phase-i-of-nairobi-metropolitan-mass-rapid-transit-system)
- Cracking MIFARE Classic — [NCC Group](https://www.nccgroup.com/research/cracking-mifare-classic-1k-rfid-charlie-cards-and-free-subway-rides/)
- Digital fare collection scale in Kenya — [O-CITY](https://www.o-city.com/blog/o-city-leads-kenya-contactless-payment-boom-by-scaling-digital-fare-collection-for-over-10000-matatu-buses)
- Transit fraud detection and revenue protection — [transit-fare.org](https://www.transit-fare.org/fraud-detection-revenue-protection/)

## Licence

MIT — see [LICENSE](LICENSE).
