require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const {
    EMAIL_USER,
    EMAIL_PASSWORD,
    IMAP_HOST = 'imap.ukr.net',
    IMAP_PORT = '993',
} = process.env;

const imap = new Imap({
    user: EMAIL_USER,
    password: EMAIL_PASSWORD,
    host: IMAP_HOST,
    port: parseInt(IMAP_PORT),
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
});

imap.once('ready', () => {
    console.log('✅ Connection ready');
    imap.openBox('INBOX', true, (err, box) => {
        if (err) {
            console.error('❌ Error opening INBOX:', err);
            process.exit(1);
        }
        console.log(`📬 INBOX open. Total messages: ${box.messages.total}`);
        
        // Fetch last 5 messages
        const start = Math.max(1, box.messages.total - 4);
        const fetch = imap.fetch(`${start}:*`, { bodies: 'HEADER.FIELDS (FROM SUBJECT DATE)' });
        
        fetch.on('message', (msg, seqno) => {
            console.log(`📩 Message #${seqno}`);
            msg.on('body', (stream) => {
                let buffer = '';
                stream.on('data', (chunk) => { buffer += chunk.toString(); });
                stream.once('end', () => {
                   const from = buffer.match(/From: (.*)/i)?.[1];
                   const subject = buffer.match(/Subject: (.*)/i)?.[1];
                   console.log(`   From: ${from}`);
                   console.log(`   Subject: ${subject}`);
                });
            });
        });
        
        fetch.once('error', (err) => {
            console.error('❌ Fetch error:', err);
        });
        
        fetch.once('end', () => {
            console.log('✅ Fetch complete');
            imap.end();
            process.exit(0);
        });
    });
});

imap.once('error', (err) => {
    console.error('❌ IMAP error:', err);
    process.exit(1);
});

imap.once('end', () => {
    console.log('👋 Connection ended');
});

console.log(`Connecting to ${IMAP_HOST}:${IMAP_PORT} as ${EMAIL_USER}...`);
imap.connect();
