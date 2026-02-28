/* Basic unit tests for spam module */
const { calculateSpamScore, addSpamWord, removeSpamWord, getSpamWords, addSpamSender, removeSpamSender, getSpamSenders } = require('../lib/spam');
const store = require('../lib/store');

function reset() {
    store.update((d) => {
        d.spamWords = [];
        d.spamSenders = [];
    });
}

let ok = 0, fail = 0;
function t(name, pass) { (pass ? ok++ : fail++); console.log((pass ? '  ✓' : '  ✗') + ' ' + name); }

reset();
console.log('Testing calculateSpamScore...');
t('normal email not spam', !calculateSpamScore('Test', 'a@b.com', 'Hello').isSpam);
t('spam patterns detected', calculateSpamScore('You won lottery prize!!!', 'spam@x.com', 'Claim your million now').isSpam);

reset();
addSpamWord('badword');
t('addSpamWord works', getSpamWords().includes('badword'));
removeSpamWord('badword');
t('removeSpamWord works', !getSpamWords().includes('badword'));

reset();
addSpamSender('blocked@x.com');
t('addSpamSender works', getSpamSenders().includes('blocked@x.com'));
removeSpamSender('blocked@x.com');
t('removeSpamSender works', !getSpamSenders().includes('blocked@x.com'));

console.log(`\nDone: ${ok} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
