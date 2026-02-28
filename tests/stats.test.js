/* Basic unit tests for stats */
const store = require('../lib/store');

function reset() {
    store.update((d) => { d.stats = { daily: {}, totalForwarded: 0 }; });
}

let ok = 0, fail = 0;
function t(name, pass) { (pass ? ok++ : fail++); console.log((pass ? '  ✓' : '  ✗') + ' ' + name); }

reset();
console.log('Testing stats...');
store.recordEmail('a@b.com', 'Subject 1');
store.recordEmail('a@b.com', 'Subject 2');
store.recordEmail('c@d.com', 'Subject 3');

const digest = store.getTodayDigest();
t('recordEmail / getTodayDigest works', digest.count === 3);

const period = store.getStatsForPeriod(1);
t('getStatsForPeriod works', period.totalCount === 3 && period.totalAll === 3);

console.log(`\nDone: ${ok} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
