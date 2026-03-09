const store = require('./lib/store');
const logger = require('./lib/logger');

console.log('Testing UID persistence...');

// Set a test UID
const testAccount = 'test@example.com';
const testFolder = 'INBOX';
const testUid = 12345;

store.setLastUid(testAccount, testFolder, testUid);
store.flush();

console.log('Saved UID. Reading back...');

// Invalidate cache and reload
store.invalidateCache();
const savedUid = store.getLastUid(testAccount, testFolder);

if (savedUid === testUid) {
    console.log('✅ Success: UID persisted and recovered correctly.');
} else {
    console.error(`❌ Failure: Expected ${testUid}, got ${savedUid}`);
    process.exit(1);
}

// Clean up
store.update(data => {
    delete data.uids[`${testAccount}:${testFolder}`];
});
store.flush();
console.log('Cleaned up.');
