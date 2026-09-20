/* Independent check of the analytics layer in tapguard.html.
 *
 * The engine is extracted verbatim from the page between its marker comments,
 * so this cannot drift from what ships: if someone edits the page, this runs
 * the edited code. Run with:  node verify/intel-engine.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '..', 'tapguard.html'), 'utf8');

const START = '/* ==== INTEL ENGINE START ====';
const END = '/* ==== INTEL ENGINE END ==== */';
const a = page.indexOf(START), b = page.indexOf(END);
if(a < 0 || b < 0) fail('engine markers not found in tapguard.html');
const source = page.slice(a, b + END.length);

const INTEL = new Function(source + '\nreturn INTEL;')();

let pass = 0, failed = 0;
function ok(name, cond, extra){
  if(cond){ pass++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}
function eq(name, got, want){ ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function fail(msg){ console.error(msg); process.exit(1); }

/* A fixed Monday so weekday-dependent behaviour is reproducible. */
const NOW = new Date('2026-09-21T18:30:00').getTime();
const STATION_NAME = s => s === 'A' ? 'Railways / Muthurwa' : 'Upper Hill';
const ACCOUNTS = {
  K001:{holder:'Wanjiku M.'}, K042:{holder:'Otieno D.'}, K077:{holder:"Achieng' P."},
  K118:{holder:'Kamau J.'},   K156:{holder:'Mwangi S.'}, K203:{holder:'Njeri W.'},
  K315:{holder:'Mutua K.'}
};

console.log('\n1. Corpus generation');
const corpus = INTEL.genCorpus(NOW, 14);
const corpus2 = INTEL.genCorpus(NOW, 14);
ok('produces a substantial history', corpus.length > 120, corpus.length + ' taps');
ok('is deterministic across calls', JSON.stringify(corpus) === JSON.stringify(corpus2));
ok('is sorted by time', corpus.every((t,i) => i === 0 || t.ts >= corpus[i-1].ts));
ok('is entirely in the past', corpus.every(t => t.ts < NOW));
ok('stays within the requested window', corpus.every(t => t.ts > NOW - 15 * 86400000));
ok('covers every card in the roster', new Set(corpus.map(t => t.id)).size === 7);
ok('uses only the two real stations', corpus.every(t => t.edgeId === 'A' || t.edgeId === 'B'));
{
  /* the anchor is NOW's time of day, so a trip at offset h lands h hours before it */
  const anchorHour = new Date(NOW).getHours();
  const offsetOf = t => {
    const d = new Date(t.ts);
    let off = anchorHour - (d.getHours() + d.getMinutes()/60);
    if(off < -12) off += 24; if(off > 12) off -= 24;
    return off;
  };
  const k001 = corpus.filter(t => t.id === 'K001');
  const dows = new Set(k001.map(t => new Date(t.ts).getDay()));
  ok('K001 is a weekday commuter (no weekend travel)', !dows.has(0) && !dows.has(6),
     'days seen: ' + [...dows].sort().join(','));
  ok('K001 taps cluster on its three scheduled legs',
     k001.every(t => [6.0, 0.6, -2.2].some(h => Math.abs(offsetOf(t) - h) < 1.0)),
     'strays: ' + k001.map(offsetOf).filter(o => ![6.0,0.6,-2.2].some(h=>Math.abs(o-h)<1.0))
       .map(o=>o.toFixed(1)).slice(0,4).join(','));
  const k203 = new Set(corpus.filter(t => t.id === 'K203').map(t => new Date(t.ts).getDay()));
  ok('K203 never rides on a Monday', !k203.has(1), 'days: ' + [...k203].sort().join(','));
  ok('some history falls later in the day than now (so the forecast has something ahead)',
     corpus.some(t => offsetOf(t) < -1));
}

console.log('\n2. Behavioural profiles');
const profiles = INTEL.buildProfiles(corpus);
ok('a profile per active card', Object.keys(profiles).length === 7);
{
  const p = profiles.K001;
  ok('K001 has a usable sample', p.n >= 15, 'n=' + p.n);
  ok('K001 trips-per-day matches its three scheduled legs',
     p.perDayMean >= 2.6 && p.perDayMean <= 3.2, p.perDayMean.toFixed(2));
  /* the profile smears each tap over a three-hour window, so allow for that */
  ok('K001 peak hour sits on one of its legs',
     [6.0, 0.6, -2.2].some(h => {
       const want = (new Date(NOW).getHours() - h + 24) % 24;
       const d = Math.abs(p.peakHour - want);
       return Math.min(d, 24 - d) <= 2;
     }), 'peak ' + p.peakHour + ', anchor ' + new Date(NOW).getHours());
  ok('K001 uses both stations', Object.keys(p.station).length === 2);
  ok('K001 has a dominant station pair', p.topPair !== null);
  ok('gap median is a plausible working day', p.gapMedian > 60 && p.gapMedian < 900,
     Math.round(p.gapMedian) + ' min');
  const q = profiles.K156;
  ok('K156 peaks off-peak', q.peakHour >= 9 && q.peakHour <= 17, 'peak ' + q.peakHour);
}

console.log('\n3. Anomaly scoring');
{
  const normal = { id:'K001', edgeId:'A', ts:new Date('2026-09-22T07:15:00').getTime(), code:'OK' };
  const r = INTEL.scoreTap(profiles.K001, normal, { stationName:STATION_NAME('A'), todayCount:1 });
  ok('a routine commute scores low', r.score < 30, 'score ' + r.score + ' band ' + r.band);
  eq('and is banded normal', r.band, 'normal');
}
{
  const odd = { id:'K001', edgeId:'A', ts:new Date('2026-09-22T03:10:00').getTime(), code:'OK' };
  const r = INTEL.scoreTap(profiles.K001, odd, { stationName:STATION_NAME('A'), todayCount:1 });
  ok('a 03:10 tap is flagged as an unusual hour', r.factors.some(f => f.k === 'hour'),
     JSON.stringify(r.factors.map(f => f.k)));
  ok('and scores above a routine commute', r.score > 15, 'score ' + r.score);
}
{
  const burst = { id:'K001', edgeId:'A', ts:new Date('2026-09-22T08:00:00').getTime(), code:'OK' };
  const r = INTEL.scoreTap(profiles.K001, burst, { stationName:STATION_NAME('A'), todayCount:11, gapMin:2 });
  ok('eleven taps in a day raises pace', r.factors.some(f => f.k === 'pace'));
  ok('a two-minute re-tap raises cadence', r.factors.some(f => f.k === 'cadence'));
  ok('a shared-card pattern lands in watch or worse', r.score >= 30, 'score ' + r.score);
}
{
  const r = INTEL.scoreTap(profiles.K001,
    { id:'K001', edgeId:'B', ts:NOW, code:'OK' },
    { stationName:STATION_NAME('B'), impossible:true, impossibleGapS:95, todayCount:2 });
  ok('impossible travel forces a high band', r.score >= 92 && r.band === 'high', 'score ' + r.score);
  eq('and velocity is the leading factor', r.factors[0].k, 'velocity');
}
{
  const r = INTEL.scoreTap(undefined, { id:'K999', edgeId:'A', ts:NOW }, {});
  eq('an unknown card is not accused', r.band, 'insufficient');
  eq('and scores zero', r.score, 0);
}
{
  const thin = INTEL.buildProfiles([{ id:'KXXX', edgeId:'A', ts:NOW - 1000, code:'OK' }]);
  eq('a card with one tap is not accused either',
     INTEL.scoreTap(thin.KXXX, { id:'KXXX', edgeId:'B', ts:NOW }, {}).band, 'insufficient');
}
{
  /* every factor must carry a sentence an operator can read */
  const r = INTEL.scoreTap(profiles.K001,
    { id:'K001', edgeId:'A', ts:new Date('2026-09-22T03:10:00').getTime() },
    { todayCount:9, gapMin:1, stationName:'Railways / Muthurwa' });
  ok('every factor is explained in words',
     r.factors.length > 0 && r.factors.every(f => typeof f.why === 'string' && f.why.length > 10));
  ok('factors are ordered by weight',
     r.factors.every((f,i) => i === 0 || r.factors[i-1].w >= f.w));
  ok('score is bounded at 100', r.score <= 100, 'score ' + r.score);
}

console.log('\n3b. False positives on ordinary riders');
{
  /* The alert list is worthless if routine travel lands on it. Replay each
     card's own last fortnight back at it and require silence. */
  let noisy = [];
  for(const id of Object.keys(profiles)){
    const mine = corpus.filter(t => t.id === id);
    for(const tap of mine){
      const r = INTEL.scoreTap(profiles[id], tap,
        { stationName:STATION_NAME(tap.edgeId), todayCount:2 });
      if(r.score >= 30) noisy.push(id + '@' + new Date(tap.ts).getHours() + ':00=' + r.score);
    }
  }
  ok('no ordinary journey reaches even the watch band',
     noisy.length === 0, noisy.slice(0, 6).join(', ') + ' (' + noisy.length + ' total)');
}
{
  /* and the model must still fire on the thing it exists to catch */
  const p = profiles.K156;
  const shared = INTEL.scoreTap(p, { id:'K156', edgeId:'B', ts:new Date('2026-09-22T21:30:00').getTime() },
    { stationName:'Upper Hill', todayCount:8, gapMin:30 });
  ok('a card used 8 times at a strange hour is still caught',
     shared.score >= 50, 'score ' + shared.score + ' factors ' + shared.factors.map(f=>f.k).join(','));
}

console.log('\n4. Card scan');
{
  const recent = corpus.filter(t => t.ts > NOW - 3 * 86400000);
  const scan = INTEL.scanCards(profiles, recent, () => ({}));
  ok('scan returns ranked cards', scan.length > 0 && scan.every((c,i) => i === 0 || scan[i-1].score >= c.score));
  ok('every scanned card has a band', scan.every(c => typeof c.band === 'string'));
  ok('routine days produce no high-risk cards', scan.every(c => c.score < 80),
     'top ' + scan[0].id + ' ' + scan[0].score);
}

console.log('\n5. Triage copilot');
{
  const cases = INTEL.buildCases({
    incidents:[
      { sev:'bad', title:'Clone blocked in real time', desc:'Card K315 presented at Upper Hill 95s after Railways.' },
      { sev:'warn', title:'Replay blocked', desc:'Card K203 presented a stale counter.' },
      { sev:'bad', title:'Revoked card refused', desc:'Card K315 refused at Railways.' }
    ],
    anomalies:[ { id:'K077', score:74, band:'elevated', factors:[{k:'pace', w:.8, why:'9 taps today against a usual 3.0.'}] },
                { id:'K001', score:12, band:'normal', factors:[] } ],
    deny:new Set(['K315']),
    denyDetail:{ K315:'Confirmed duplicate on reconcile' },
    accounts:ACCOUNTS, fare:50
  });
  eq('one case per card with a signal', cases.length, 3);
  eq('the clone sorts first', cases[0].id, 'K315');
  eq('and is critical', cases[0].severity, 'critical');
  eq('a revoked card closes', cases[0].state, 'closed');
  ok('the close reason is the recorded one', /duplicate/i.test(cases[0].rationale), cases[0].rationale);
  ok('two signals give high confidence', cases[0].confidence === 'high');

  const replay = cases.find(c => c.id === 'K203');
  eq('a lone replay is high, not critical', replay.severity, 'high');
  ok('and is not treated as proven fraud', /gate/i.test(replay.action), replay.action);

  const beh = cases.find(c => c.id === 'K077');
  ok('behaviour alone never blocks or revokes',
     /^Watch/.test(beh.action) && !/revoke|block(?!ing)/i.test(beh.action), beh.action);
  ok('and the case says why blocking would be wrong',
     /strand/i.test(beh.rationale), beh.rationale);
  {
    /* the same must hold when behaviour scores in the high band */
    const hi = INTEL.buildCases({ incidents:[], accounts:ACCOUNTS, deny:new Set(),
      anomalies:[{ id:'K077', score:88, band:'high', factors:[{ k:'pace', w:.9, why:'14 taps today against a usual 3.0.' }] }] });
    ok('a high behavioural score still does not revoke',
       /^Watch/.test(hi[0].action), hi[0].action);
    ok('and still explains the cost of a wrong block', /strand/i.test(hi[0].rationale), hi[0].rationale);
  }
  ok('every case names the card and holder', cases.every(c => c.summary.includes(c.id) && c.summary.includes(c.holder)));
  ok('every case has an action and a rationale',
     cases.every(c => c.action && c.rationale && c.rationale.length > 20));
  eq('exposure is counted once per clone', cases[0].exposure, 50);
  ok('the LLM boundary is documented in the code', /must not|never/i.test(INTEL.LLM_SLOT) || INTEL.LLM_SLOT.length > 80);
}
{
  const none = INTEL.buildCases({ incidents:[], anomalies:[], deny:new Set(), accounts:ACCOUNTS });
  eq('a clean day produces no cases', none.length, 0);
}
{
  /* an incident with no card reference must not invent one */
  const c = INTEL.buildCases({ incidents:[{ title:'Gate link restored', desc:'Reconcile complete.' }],
    anomalies:[], deny:new Set(), accounts:ACCOUNTS });
  eq('an incident naming no card raises no case', c.length, 0);
}

console.log('\n6. Demand forecast');
{
  const vol = INTEL.genVolume(NOW, 14);
  const fcv = INTEL.forecastDemand(corpus, NOW, ['A','B'], 24, vol);
  const at = (s,h) => fcv[s].find(p => p.hour === h);
  ok('the morning peak lands at 07:00-08:00',
     at('A',7).expected > at('A',10).expected && at('A',8).expected > at('A',10).expected,
     '07=' + at('A',7).expected + ' 08=' + at('A',8).expected + ' 10=' + at('A',10).expected);
  ok('the evening peak lands at 17:00-18:00',
     at('A',18).expected > at('A',15).expected && at('A',17).expected > at('A',21).expected,
     '17=' + at('A',17).expected + ' 18=' + at('A',18).expected);
  ok('the small hours are near-empty', at('A',3).expected < 5, String(at('A',3).expected));
  ok('peak hours actually reach a crowding level worth staffing',
     ['busy','crush'].includes(at('A',8).level) && ['busy','crush'].includes(at('A',18).level),
     at('A',8).level + ' / ' + at('A',18).level);
  ok('03:00 is light', at('A',3).level === 'light');
  ok('the quieter station forecasts below the busier one',
     at('B',8).expected < at('A',8).expected, at('B',8).expected + ' vs ' + at('A',8).expected);
  ok('background volume never becomes a profiled card',
     Object.keys(INTEL.buildProfiles(corpus)).length === 7);
  ok('volume is deterministic',
     JSON.stringify(vol) === JSON.stringify(INTEL.genVolume(NOW, 14)));

  const fc = INTEL.forecastDemand(corpus, NOW, ['A','B'], 6);
  ok('a series per station', fc.A.length === 6 && fc.B.length === 6);
  ok('hours run forward from now', fc.A[0].hour === new Date(NOW).getHours());
  ok('hours are consecutive', fc.A.every((p,i) => i === 0 || p.hour === (fc.A[i-1].hour + 1) % 24));
  ok('expectations are non-negative', fc.A.every(p => p.expected >= 0) && fc.B.every(p => p.expected >= 0));
  ok('every point has a crowding level',
     fc.A.every(p => ['light','steady','busy','crush'].includes(p.level)));
  ok('load is a percentage of stated capacity', fc.A.every(p => p.load >= 0 && p.load <= 300));
  const night = INTEL.forecastDemand(corpus, new Date('2026-09-21T03:00:00').getTime(), ['A','B'], 3);
  ok('03:00 forecasts less than 18:00',
     night.A[0].expected <= fc.A[0].expected, night.A[0].expected + ' vs ' + fc.A[0].expected);
  ok('empty history forecasts zero, not NaN',
     INTEL.forecastDemand([], NOW, ['A'], 3).A.every(p => p.expected === 0));
}

console.log('\n7. Natural-language query');
const rows = corpus.concat([
  { id:'K315', edgeId:'B', ts:new Date('2026-09-21T06:12:00').getTime(), code:'CLONE' },
  { id:'K203', edgeId:'A', ts:new Date('2026-09-21T19:40:00').getTime(), code:'REPLAY' },
  { id:'K315', edgeId:'A', ts:new Date('2026-09-21T17:05:00').getTime(), code:'REVOKED' }
]);
const QCTX = { rows, anomalies:[
  { id:'K077', score:74, band:'elevated', factors:[{ why:'9 taps today against a usual 3.0.' }] },
  { id:'K001', score:22, band:'normal', factors:[{ why:'nothing notable.' }] }
], accounts:ACCOUNTS, nowTs:NOW, stationName:STATION_NAME };
const run = q => INTEL.runQuery(INTEL.parseQuery(q), QCTX);
{
  const p = INTEL.parseQuery('how many taps at Upper Hill after 17:00');
  eq('intent: count', p.intent, 'count');
  eq('station extracted', p.filters.station, 'B');
  eq('time floor extracted', p.filters.from, 17 * 60);
}
eq('card id extracted', INTEL.parseQuery('show taps by K042').filters.card, 'K042');
eq('card id with a space', INTEL.parseQuery('trips for k 077').filters.card, 'K077');
eq('refusals map to an outcome', INTEL.parseQuery('which cards were refused today').filters.outcome, 'refused');
eq('revoked is its own code', INTEL.parseQuery('show revoked taps').filters.outcome, 'REVOKED');
eq('clone is its own code', INTEL.parseQuery('any clones today').filters.outcome, 'CLONE');
eq('top intent', INTEL.parseQuery('top riders by trips').intent, 'top');
eq('risk intent', INTEL.parseQuery('which cards look suspicious').intent, 'risk');
eq('threshold extracted', INTEL.parseQuery('risk above 70').filters.minScore, 70);
eq('morning window', INTEL.parseQuery('taps this morning').filters.from, 5 * 60);
eq('last N days window', INTEL.parseQuery('taps in the last 3 days').filters.window.n, 3);
{
  const r = run('how many taps at Railways / Muthurwa');
  const expect = rows.filter(t => t.edgeId === 'A').length;
  ok('count matches a hand count', r.answer.startsWith(expect + ' tap'), r.answer + ' vs ' + expect);
}
{
  const r = run('show refused taps');
  const expect = rows.filter(t => t.code !== 'OK').length;
  eq('refusals counted correctly', r.matched, expect);
  ok('and none of them are accepts', r.rows.every(row => row[4] !== 'OK'));
}
{
  const r = run('taps by K042 at Upper Hill');
  ok('two filters compose', r.rows.every(row => row[0] === 'K042' && row[2] === 'Upper Hill'));
}
{
  const r = run('top riders by trips');
  ok('top returns a ranking', r.rows.length > 1);
  ok('ranked descending', r.rows.every((row,i) => i === 0 || +r.rows[i-1][2] >= +row[2]));
  ok('holders are resolved', r.rows.every(row => row[1] !== '—'));
}
{
  const r = run('which cards are suspicious');
  eq('risk query returns the elevated card only', r.rows.length, 1);
  eq('and it is K077', r.rows[0][0], 'K077');
  ok('with its leading factor spelled out', /taps today/.test(r.rows[0][4]), r.rows[0][4]);
}
{
  const r = run('risk above 90');
  ok('a high threshold returns nothing, clearly', r.rows.length === 0 && /No cards/.test(r.answer), r.answer);
}
{
  const r = run('taps by K999');
  ok('an unknown card says nothing matched', /Nothing matched/.test(r.answer), r.answer);
}
{
  const r = run('');
  ok('an empty query does not throw', Array.isArray(r.rows));
  ok('and does not pretend to have understood', r.understood === false, r.answer);
}
{
  const r = run('zzz qqq wibble');
  ok('gibberish is not answered with the whole table',
     r.rows.length === 0 && /could not read/i.test(r.answer), r.answer);
  ok('and it says what would work instead', !!r.hint, JSON.stringify(r.hint));
}
{
  const r = run('show me all taps');
  ok('an explicit "all" request is still honoured', r.rows.length > 0, r.answer);
}
{
  /* the sharp edge: a question we half-read must not look confident */
  ok('a recognised filter marks the query understood',
     INTEL.parseQuery('taps by K042').understood === true);
  ok('a bare listing verb does not', INTEL.parseQuery('show me stuff').understood === false);
}
{
  const r = run('show me everything that happened at upper hill this evening');
  ok('a wordy question still parses', r.rows.every(row => row[2] === 'Upper Hill'));
}

console.log('\n8. Language and SMS fallback');
{
  const en = INTEL.STR.en, sw = INTEL.STR.sw;
  const missing = Object.keys(en).filter(k => !(k in sw));
  ok('Kiswahili covers every English string', missing.length === 0, 'missing: ' + missing.join(','));
  ok('translations are not copies of the English',
     Object.keys(en).filter(k => en[k] === sw[k] && k !== 'lang_name').length < 3);
  eq('unknown language falls back to English', INTEL.t('fr','balance'), 'Balance');
  eq('unknown key returns the key', INTEL.t('en','nope'), 'nope');
}
{
  const cases = [
    ['I lost my card on a matatu', 'block', 'en'],
    ['my card was stolen',         'block', 'en'],
    ['BLOCK',                      'block', 'en'],
    ['nimepoteza kadi yangu',      'block', 'sw'],
    ['kadi yangu imeibiwa',        'block', 'sw'],
    ['tafadhali zuia kadi yangu',  'block', 'sw'],
    ['what is my balance',       'balance', 'en'],
    ['salio langu ni ngapi',     'balance', 'sw'],
    ['show my trips',              'trips', 'en'],
    ['safari zangu',               'trips', 'sw'],
    ['help',                        'help', 'en'],
    ['nisaidie tafadhali',          'help', 'sw']
  ];
  for(const [text, intent, lang] of cases){
    const p = INTEL.smsParse(text);
    ok('"' + text + '" -> ' + intent + '/' + lang,
       p.intent === intent && p.lang === lang, p.intent + '/' + p.lang);
  }
  const junk = INTEL.smsParse('asdfgh qwerty');
  eq('gibberish is not guessed at', junk.intent, 'unknown');
  eq('and carries zero confidence', junk.confidence, 0);
  eq('empty text is unknown', INTEL.smsParse('').intent, 'unknown');
}
{
  const ctx = { card:'K042', balance:520, blocked:false, trips:['Railways 08:04 KSh 50'], ref:'TG7Q2', online:true };
  const enBlock = INTEL.smsReply({ intent:'block', lang:'en' }, ctx);
  ok('an English block reply names the card and the replacement',
     /K042/.test(enBlock) && /replacement/i.test(enBlock), enBlock);
  const swBlock = INTEL.smsReply({ intent:'block', lang:'sw' }, ctx);
  ok('the Kiswahili reply is actually in Kiswahili',
     /IMEZUIWA/.test(swBlock) && /kitambulisho/.test(swBlock), swBlock);
  const offline = INTEL.smsReply({ intent:'block', lang:'en' }, Object.assign({}, ctx, { online:false }));
  ok('offline says queued, not applied', /queued/i.test(offline) && !/pushed/i.test(offline), offline);
  const swOffline = INTEL.smsReply({ intent:'block', lang:'sw' }, Object.assign({}, ctx, { online:false }));
  ok('and says so in Kiswahili too', /hifadhiwa/.test(swOffline), swOffline);
  ok('balance reply carries the figure', /520/.test(INTEL.smsReply({ intent:'balance', lang:'en' }, ctx)));
  ok('blocked status is reported', /BLOCKED/.test(
     INTEL.smsReply({ intent:'balance', lang:'en' }, Object.assign({}, ctx, { blocked:true }))));
  ok('no trips reads cleanly',
     /none/.test(INTEL.smsReply({ intent:'trips', lang:'en' }, Object.assign({}, ctx, { trips:[] }))));
  ok('an unknown intent offers the keywords',
     /BALANCE/.test(INTEL.smsReply({ intent:'unknown', lang:'en' }, ctx)));
  ok('and offers them in Kiswahili',
     /SALIO/.test(INTEL.smsReply({ intent:'unknown', lang:'sw' }, ctx)));
}

console.log('\n9. Boundary: no model in the gate path');
{
  const names = Object.keys(INTEL);
  ok('the engine exposes no accept/refuse entry point',
     !names.some(n => /^(validate|accept|refuse|authori|decide|allow|block|revoke)/i.test(n)),
     names.join(','));
  ok('and every export is analysis, not a decision',
     names.every(n => typeof INTEL[n] !== 'function' || !/decision|verdict/i.test(n)));
  ok('the engine source does not touch crypto or the deny-list',
     !/crypto\.|hmac|denySet/i.test(source));
}

console.log('\n' + pass + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
