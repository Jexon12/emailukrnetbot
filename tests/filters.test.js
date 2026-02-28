/* Basic unit tests for filters */
const store = require('../lib/store');

function reset() {
    store.update((d) => { d.filters = []; });
}

let ok = 0, fail = 0;
function t(name, pass) { (pass ? ok++ : fail++); console.log((pass ? '  ✓' : '  ✗') + ' ' + name); }

reset();
console.log('Testing filters...');
store.addFilter('newsletter');
t('addFilter works', store.getFilters().includes('newsletter'));
t('isFiltered matches', store.isFiltered('Newsletter from X', 'a@b.com'));
store.removeFilter('newsletter');
t('removeFilter works', !store.getFilters().includes('newsletter'));
t('isFiltered does not match when no filter', !store.isFiltered('Hello', 'a@b.com'));

console.log(`\nDone: ${ok} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
