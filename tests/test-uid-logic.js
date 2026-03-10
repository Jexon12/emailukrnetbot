const store = require('./lib/store');

// Mock box object
const mockBox = {
    uidnext: 1567,
    messages: { total: 100 }
};

function testUidLogic(startUid, folderName) {
    const accountUser = 'test@ukr.net';
    const folder = folderName || 'INBOX';

    // Simulate what's in lib/imap.js
    const storedUid = store.getLastUid(accountUser, folder);
    let effectiveStartUid;

    if (storedUid) {
        effectiveStartUid = storedUid;
        console.log(`[PASS] Found in store: ${effectiveStartUid}`);
    } else if (startUid !== null) {
        effectiveStartUid = startUid;
        console.log(`[PASS] Found in local closure: ${effectiveStartUid}`);
    } else {
        effectiveStartUid = mockBox.uidnext - 1;
        console.log(`[PASS] New/Empty state: starting from ${effectiveStartUid}`);
    }

    const searchCriteria = (effectiveStartUid === null) ? ['UNSEEN'] : [['UID', `${effectiveStartUid + 1}:*`]];
    console.log(`Search criteria: ${JSON.stringify(searchCriteria)}`);
}

console.log('--- Test 1: No state (should start from box.uidnext-1) ---');
testUidLogic(null, 'INBOX');

console.log('\n--- Test 2: State exists in store ---');
store.setLastUid('test@ukr.net', 'INBOX', 1234);
testUidLogic(null, 'INBOX');

console.log('\n--- Test 3: State exists in local closure ---');
testUidLogic(5555, 'INBOX');

console.log('\nAll tests simulated. Check search criteria logs.');
