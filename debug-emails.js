require('dotenv').config();
require('./lib/patch-utf7')();

const store = require('./lib/store');
const { startIMAPForAccount } = require('./lib/imap');
const Imap = require('imap');

const { EMAIL_USER, EMAIL_PASSWORD, IMAP_HOST = 'imap.ukr.net', IMAP_PORT = '993' } = process.env;

const account = { user: EMAIL_USER, password: EMAIL_PASSWORD, imapHost: IMAP_HOST, imapPort: IMAP_PORT };

console.log('\n=== Debug: Email Receiving Issues ===\n');

// Check store state
const data = store.get();
console.log('1. Store UIDs:', JSON.stringify(data.uids, null, 2));
console.log('2. Store filters:', data.filters);
console.log('3. Store muted:', data.muted);
console.log('4. Store muteQueue length:', data.muteQueue.length);
console.log('5. Store spamWords:', data.spamWords);
console.log('6. Store spamSenders:', data.spamSenders);

// Connect to IMAP and check current state
console.log('\n=== Connecting to IMAP ===\n');

const imap = new Imap({
    user: account.user,
    password: account.password,
    host: account.imapHost,
    port: parseInt(account.imapPort),
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
});

imap.once('ready', () => {
    imap.openBox('INBOX', true, (err, box) => {
        if (err) {
            console.error('Error opening INBOX:', err);
            imap.end();
            return;
        }

        console.log('IMAP INBOX state:');
        console.log('  - messages.total:', box.messages.total);
        console.log('  - messages.new:', box.messages.new);
        console.log('  - uidnext:', box.uidnext);
        console.log('  - uidvalidity:', box.uidvalidity);

        const storedUid = store.getLastUid(account.user, 'INBOX');
        console.log('\nStored UID in store:', storedUid);

        if (storedUid === null) {
            console.log('\n⚠️ No UID stored! This means either:');
            console.log('   1. First run - will fetch only new emails');
            console.log('   2. UID tracking is broken');
        } else {
            console.log(`\nSearch criteria would be: UID ${storedUid + 1}:*`);

            // Search for emails after stored UID
            imap.search([['UID', `${storedUid + 1}:*`]], (err, results) => {
                if (err) {
                    console.error('Search error:', err);
                    imap.end();
                    return;
                }
                console.log(`Found ${results.length} emails with UID > ${storedUid}`);
                if (results.length > 0) {
                    console.log('UIDs:', results.slice(0, 10).join(', '), results.length > 10 ? '...' : '');

                    // Show what these emails are
                    const fetch = imap.fetch(results.slice(0, 5), { bodies: 'HEADER.FIELDS (FROM SUBJECT DATE)', struct: true });
                    fetch.on('message', (msg) => {
                        let header = '';
                        msg.on('body', (s) => { s.on('data', (c) => { header += c.toString('utf8'); }); });
                        msg.on('end', () => {
                            const from = header.match(/From: (.+)/i)?.[1] || '?';
                            const subject = header.match(/Subject: (.+)/i)?.[1] || '?';
                            console.log(`\n  📧 From: ${from}`);
                            console.log(`     Subject: ${subject.substring(0, 60)}...`);
                        });
                    });
                    fetch.once('end', () => {
                        imap.end();
                    });
                } else {
                    imap.end();
                }
            });
        }
    });
});

imap.once('error', (err) => {
    console.error('IMAP Error:', err.message);
});

imap.connect();