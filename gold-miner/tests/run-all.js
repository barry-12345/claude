#!/usr/bin/env node
// One-command entry point:  node tests/run-all.js   [smoke] [logic] [keys] [shots] [phase2] [touch]
// touch = T-01..T-16 (phase 2.5: phone / touch UI, Playwright mobile emulation + real touch input);
// phase2 = AC-P2-01..24 (rule set 2, default); logic/keys/shots = the phase-1 suite, run on the legacy path (?rules=1).
// Prints the measured numbers.
if (process.argv.includes('--wip')) process.env.GM_INDEX = require('path').join(__dirname, '..', 'wip', 'index.html');   // run the suite against the phase-3 working copy
const L = require('./lib');
(async () => {
  const want = process.argv.slice(2).filter(a => a !== '--wip');
  const suites = (want.includes('smoke') ? ['smoke'] : ['phase2', 'touch', 'logic', 'keys', 'shots', 'phase3'].filter(s => !want.length || want.includes(s)));
  const browser = await L.launch();
  const t0 = Date.now();
  try {
    for (const s of suites) { console.log(`\n=== ${s} ===`); await require('./' + s).run(browser); }
  } finally { await browser.close(); }
  const bad = L.results.filter(r => !r.ok);
  console.log(`\n${L.results.length - bad.length}/${L.results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (bad.length) { console.log('FAILED: ' + bad.map(b => b.id).join(', ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(2); });
