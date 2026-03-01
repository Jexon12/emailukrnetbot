const Imap = require('imap');
const { simpleParser } = require('mailparser');
const logger = require('./logger');

// ─── IMAP Reconnect tracking ────────────────────────────────────
const imapReconnectAttempts = new Map();

// ─── IMAP Search (single account) ───────────────────────────────
function searchImapAccount(account, query, limit = 15, config = {}) {
    const { IMAP_HOST = 'imap.ukr.net', IMAP_PORT = '993', TLS_REJECT_UNAUTHORIZED = 'true' } = config;

    return new Promise((resolve) => {
        const imap = new Imap({
            user: account.user,
            password: account.password,
            host: account.imapHost || IMAP_HOST,
            port: parseInt(account.imapPort || IMAP_PORT),
            tls: true,
            tlsOptions: { rejectUnauthorized: TLS_REJECT_UNAUTHORIZED !== 'false' },
            connTimeout: 15000,
            authTimeout: 15000,
        });

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err) => {
                if (err) { imap.end(); return resolve([]); }
                imap.search([['OR', ['SUBJECT', query], ['FROM', query]]], (err, results) => {
                    if (err || !results || results.length === 0) {
                        imap.end();
                        return resolve([]);
                    }
                    const ids = results.slice(-limit);
                    const emails = [];
                    const fetch = imap.fetch(ids, { bodies: 'HEADER.FIELDS (FROM SUBJECT DATE)', struct: true });
                    fetch.on('message', (msg) => {
                        let header = '';
                        msg.on('body', (s) => { s.on('data', (c) => { header += c.toString('utf8'); }); });
                        msg.on('end', () => {
                            const fromMatch = header.match(/From: (.+)/i);
                            const subjectMatch = header.match(/Subject: (.+)/i);
                            const dateMatch = header.match(/Date: (.+)/i);
                            emails.push({
                                from: fromMatch ? fromMatch[1].trim() : '?',
                                subject: subjectMatch ? subjectMatch[1].trim() : '?',
                                date: dateMatch ? dateMatch[1].trim() : '?',
                                account: account.user,
                            });
                        });
                    });
                    fetch.once('end', () => { imap.end(); resolve(emails.reverse()); });
                    fetch.once('error', () => { imap.end(); resolve([]); });
                });
            });
        });
        imap.once('error', () => { imap.end(); resolve([]); });
        imap.connect();
    });
}

async function searchEmails(query, limit = 20, config = {}) {
    const store = require('./store');
    const accounts = [
        { user: config.EMAIL_USER, password: config.EMAIL_PASSWORD, imapHost: config.IMAP_HOST, imapPort: config.IMAP_PORT },
        ...store.getAccounts(),
    ];
    const perAccount = Math.ceil(limit / accounts.length) + 2;
    const results = await Promise.all(accounts.map(acc => searchImapAccount(acc, query, perAccount, config)));
    const merged = results.flat();
    return merged.slice(0, limit);
}

// ─── IMAP Persistent Connection ─────────────────────────────────
function startIMAPForAccount(account, config = {}, onNewEmail) {
    const {
        IMAP_HOST = 'imap.ukr.net',
        IMAP_PORT = '993',
        TLS_REJECT_UNAUTHORIZED = 'true',
        RECONNECT_DELAY = 5000,
        IMAP_MAX_RECONNECT_ATTEMPTS = 10,
    } = config;

    const label = account.user;
    const attempts = imapReconnectAttempts.get(label) || 0;
    const maxAttempts = parseInt(IMAP_MAX_RECONNECT_ATTEMPTS, 10) || 10;

    const imap = new Imap({
        user: account.user,
        password: account.password,
        host: account.imapHost || IMAP_HOST,
        port: parseInt(account.imapPort || IMAP_PORT),
        tls: true,
        tlsOptions: { rejectUnauthorized: TLS_REJECT_UNAUTHORIZED !== 'false' },
        keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true },
    });

    let startUid = null;

    function processNew() {
        if (startUid === null) return;
        imap.search([['UID', `${startUid + 1}:*`]], (err, results) => {
            if (err) { logger.info(`❌ [${label}] Пошук: ${err.message}`); return; }
            const newR = results ? results.filter(uid => uid > startUid) : [];
            if (newR.length === 0) return;

            logger.info(`📬 [${label}] ${newR.length} нових`);
            const fetch = imap.fetch(newR, { bodies: '', markSeen: true, struct: true });

            fetch.on('message', (msg) => {
                let raw = '';
                let uid = null;
                msg.on('attributes', (a) => { uid = a.uid; });
                msg.on('body', (s) => { s.on('data', (c) => { raw += c.toString('utf8'); }); });
                msg.on('end', async () => {
                    try {
                        const parsed = await simpleParser(raw);
                        if (onNewEmail) await onNewEmail(parsed, label);
                        if (uid && uid > startUid) startUid = uid;
                    } catch (e) { logger.error(`❌ [${label}] Parse: ${e.message}`); }
                });
            });

            fetch.once('error', (e) => logger.error(`❌ [${label}] Fetch: ${e.message}`));
            fetch.once('end', () => logger.info(`✅ [${label}] Оброблено`));
        });
    }

    imap.once('ready', () => {
        imapReconnectAttempts.delete(label);
        logger.info(`✅ [${label}] IMAP підключено`);
        imap.openBox('INBOX', false, (err, box) => {
            if (err) { logger.error(`❌ [${label}] INBOX: ${err.message}`); return; }
            startUid = box.uidnext - 1;
            logger.info(`📭 [${label}] ${box.messages.total} листів | UID: ${startUid}`);
            imap.on('mail', (n) => { logger.info(`📨 [${label}] +${n}`); processNew(); });
        });
    });

    imap.once('error', (e) => { logger.error(`❌ [${label}] IMAP: ${e.message}`); reconnect(); });
    imap.once('end', () => { logger.warn(`⚠️ [${label}] IMAP закрито`); reconnect(); });

    let reco = false;
    function reconnect() {
        if (reco) return;
        reco = true;
        imapReconnectAttempts.set(label, attempts + 1);
        if (attempts + 1 >= maxAttempts) {
            logger.warn(`⚠️ [${label}] Максимум спроб перепідключення (${maxAttempts}). Зупиняю.`);
            imapReconnectAttempts.delete(label);
            return;
        }
        const baseDelay = parseInt(RECONNECT_DELAY, 10) || 5000;
        const delay = Math.min(baseDelay * Math.pow(2, attempts), 300000);
        logger.info(`🔄 [${label}] Перепідключення через ${Math.round(delay / 1000)}с (спроба ${attempts + 1}/${maxAttempts})`);
        setTimeout(() => { reco = false; startIMAPForAccount(account, config, onNewEmail); }, delay);
    }

    logger.info(`🔌 [${label}] Підключення...`);
    imap.connect();
}

module.exports = { startIMAPForAccount, searchEmails, searchImapAccount };
