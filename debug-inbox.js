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

const fs = require('fs');

imap.once('ready', () => {
    imap.openBox('INBOX', true, (err, box) => {
        if (err) { fs.writeFileSync('inbox_status.txt', err.stack); process.exit(1); }
        let output = `INBOX: ${box.messages.total} messages, uidnext: ${box.uidnext}\n`;

        const count = 15;
        const start = Math.max(1, box.messages.total - count + 1);
        const f = imap.fetch(`${start}:*`, { bodies: 'HEADER.FIELDS (FROM SUBJECT DATE)', struct: true });

        const results = [];
        f.on('message', (msg, seqno) => {
            const res = { seqno };
            msg.on('attributes', (attrs) => {
                res.uid = attrs.uid;
                res.flags = attrs.flags;
            });
            msg.on('body', (stream) => {
                let buffer = '';
                stream.on('data', (c) => buffer += c);
                stream.on('end', () => {
                    res.from = buffer.match(/From: (.*)/i)?.[1];
                    res.subject = buffer.match(/Subject: (.*)/i)?.[1];
                    res.date = buffer.match(/Date: (.*)/i)?.[1];
                });
            });
            msg.on('end', () => results.push(res));
        });

        f.once('end', () => {
            results.sort((a, b) => b.seqno - a.seqno).forEach(r => {
                const seen = r.flags.includes('\\Seen') ? '[SEEN]' : '[UNSEEN]';
                output += `${r.uid} | ${seen} | ${r.date} | ${r.from} | ${r.subject}\n`;
            });
            fs.writeFileSync('inbox_status.txt', output);
            console.log('Done, check inbox_status.txt');
            imap.end();
            process.exit(0);
        });
    });
});

imap.once('error', (err) => { console.error(err); process.exit(1); });
imap.connect();
