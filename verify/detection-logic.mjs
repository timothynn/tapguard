/**
 * TapGuard — independent verification of the fare-validation rule set.
 *
 * Replays the full seven-step scenario against the same logic the console
 * implements, and asserts every outcome. Run with:  node verify/detection-logic.mjs
 *
 * Exit code 0 = all assertions passed.
 */
import { webcrypto as crypto } from 'node:crypto';

const enc = new TextEncoder();
const MIN_TRAVEL_S = 120;   // minimum plausible transfer between the two stations
const FARE = 50;            // KSh, flat CBD-core fare
const STATIONS = { A: 'Railways / Muthurwa', B: 'Upper Hill' };

const newKey = async () =>
  crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

const hmacHex = async (key, msg) =>
  [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- system state
const keys = { K001: await newKey() };
const backend = { acct: {}, deny: new Set(), denyVer: 0 };
const edges = {
  A: { acct: {}, buffer: [], deny: new Set() },
  B: { acct: {}, buffer: [], deny: new Set() }
};
let online = true;
let ledger = [];
let leaked = 0, protectedKes = 0;

/** Validate one tap. Mirrors validate() in tapguard.html. */
async function tap(media, edgeId, ts) {
  const counter = ++media.counter;                       // media's own monotonic counter
  const msg = `${media.id}|${counter}|${edgeId}|${ts}`;
  const mac = await hmacHex(keys[media.id], msg);
  const t = { id: media.id, counter, edgeId, ts, mac, kind: media.kind };

  const store = online ? backend : edges[edgeId];
  const deny  = online ? backend.deny : edges[edgeId].deny;
  let code;

  if (deny.has(t.id)) {
    code = 'REVOKED';
  } else if (t.mac !== await hmacHex(keys[t.id], `${t.id}|${t.counter}|${t.edgeId}|${t.ts}`)) {
    code = 'FORGED';
  } else {
    const seen = store.acct[t.id];
    if (seen && t.counter <= seen.counter) {
      code = 'REPLAY';
    } else if (seen && seen.station !== t.edgeId && (t.ts - seen.ts) < MIN_TRAVEL_S * 1000) {
      code = 'CLONE';                                    // networked gates block the ride
    } else {
      store.acct[t.id] = { counter: t.counter, station: t.edgeId, ts: t.ts };
      if (!online) edges[edgeId].buffer.push({ ...t });
      code = 'OK';
    }
  }

  if (t.kind === 'clone') { code === 'OK' ? leaked += FARE : protectedKes += FARE; }
  ledger.push({ ...t, code, online });
  return code;
}

/** Merge buffered offline taps and revoke any card that broke physics. */
function reconcile() {
  const byCard = {};
  for (const row of ledger) if (row.code === 'OK') (byCard[row.id] ??= []).push(row);

  let revoked = 0;
  for (const id in byCard) {
    if (backend.deny.has(id)) continue;
    const taps = [...byCard[id]].sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < taps.length; i++) {
      const prev = taps[i - 1], cur = taps[i];
      if (prev.edgeId !== cur.edgeId && (cur.ts - prev.ts) < MIN_TRAVEL_S * 1000) {
        backend.deny.add(id); backend.denyVer++; revoked++;
        break;
      }
    }
  }
  edges.A.buffer = []; edges.B.buffer = [];
  edges.A.deny = new Set(backend.deny);                  // signed deny-list distribution
  edges.B.deny = new Set(backend.deny);
  return revoked;
}

// ---------------------------------------------------------------- the scenario
let fails = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) fails++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label.padEnd(42)} ${actual}${ok ? '' : `  (expected ${expected})`}`);
}

const genuine = { id: 'K001', kind: 'genuine', counter: 0 };
let T = 1_000_000;

console.log('\nNetworked gates');
check('1. genuine tap at Railways', await tap(genuine, 'A', T), 'OK');
T += 15_000;

const clone = { id: 'K001', kind: 'clone', counter: genuine.counter };  // skimmed snapshot
console.log(`   clone created from counter ${clone.counter}`);
check('2. clone at Upper Hill, +15s', await tap(clone, 'B', T), 'CLONE');
check('   card NOT yet revoked', backend.deny.has('K001'), 'false');
T += 15_000;

console.log('\nGates offline (tunnel outage)');
online = false;
check('3. genuine at Railways, offline', await tap(genuine, 'A', T), 'OK');
T += 9_000;
check('4. clone at Upper Hill, +9s', await tap(clone, 'B', T), 'OK');
T += 15_000;

console.log('\nLink restored');
online = true;
check('5. reconcile confirms clones', reconcile(), 1);
check('   card now revoked', backend.deny.has('K001'), 'true');
check('   deny-list version', backend.denyVer, 1);
check('6. clone refused at Railways', await tap(clone, 'A', T), 'REVOKED');
online = false;
check('7. refused offline too', await tap(clone, 'B', T + 1000), 'REVOKED');

console.log('\nRevenue');
check('   leaked before detection', `KSh ${leaked}`, 'KSh 50');
check('   protected at the gate', `KSh ${protectedKes}`, 'KSh 150');

console.log(fails === 0 ? '\nAll assertions passed.\n' : `\n${fails} assertion(s) FAILED.\n`);
process.exit(fails === 0 ? 0 : 1);
