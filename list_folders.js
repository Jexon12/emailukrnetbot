const Imap = require('imap');
require('dotenv').config();

const imap = new Imap({
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    host: process.env.IMAP_HOST || 'imap.ukr.net',
    port: parseInt(process.env.IMAP_PORT || '993'),
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
});

imap.once('ready', () => {
    console.log('IMAP Ready');
    imap.getBoxes((err, boxes) => {
        if (err) {
            console.error('getBoxes Error:', err);
            imap.end();
            return;
        }
        console.log('Available boxes:');
        printBoxes(boxes);
        imap.end();
    });
});

function printBoxes(boxes, prefix = '') {
    for (const name in boxes) {
        const box = boxes[name];
        const fullName = prefix + name;
        console.log(`- ${fullName} (attribs: ${JSON.stringify(box.attribs)})`);
        if (box.children) {
            printBoxes(box.children, fullName + box.delimiter);
        }
    }
}

imap.once('error', (err) => {
    console.error('IMAP Error:', err);
});

imap.once('end', () => {
    console.log('IMAP Connection Ended');
});

console.log('Connecting to IMAP...');
imap.connect();
