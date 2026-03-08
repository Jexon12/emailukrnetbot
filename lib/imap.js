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

// ─── IMAP Helpers ───────────────────────────────────────────────
function getAllBoxes(boxes, prefix = '') {
    let result = [];
    for (const name in boxes) {
        const box = boxes[name];
        const fullName = prefix + name;
        // Don't monitor folders with \NoSelect attribute
        if (!box.attribs || !box.attribs.includes('\\NoSelect')) {
            result.push(fullName);
        }
        if (box.children) {
            result.push(...getAllBoxes(box.children, fullName + box.delimiter));
        }
    }
    return result;
}

const EXCLUDED_FOLDERS = [
    /spam|спам|junk/i,
    /trash|кошик|корзина/i,
    /drafts|чернетки|черновики/i,
    /sent|надіслані|отправленные/i,
    /archive|архів/i,
    /outbox|вихідні/i
];

function isExcluded(folderName) {
    return EXCLUDED_FOLDERS.some(regex => regex.test(folderName));
}

// ─── IMAP Persistent Connection ─────────────────────────────────
function startIMAPForAccount(account, config = {}, onNewEmail, folderName = null) {
    const {
        IMAP_HOST = 'imap.ukr.net',
        IMAP_PORT = '993',
        TLS_REJECT_UNAUTHORIZED = 'true',
        RECONNECT_DELAY = 5000,
        IMAP_MAX_RECONNECT_ATTEMPTS = 10,
    } = config;

    const label = `${account.user}${folderName ? ` [${folderName}]` : ''}`;
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
    let processing = false;

    function processNew() {
        if (processing) {
            logger.info(`⏳ [${label}] processNew вже виконується, пропускаю`);
            return;
        }
        if (startUid === null) return;
        processing = true;
        logger.info(`🔎 [${label}] Шукаю листи з UID > ${startUid}`);
        imap.search([['UID', `${startUid + 1}:*`]], (err, results) => {
            if (err) { logger.info(`❌ [${label}] Пошук: ${err.message}`); return; }
            const allResults = results || [];
            const newR = allResults.filter(uid => uid > startUid);
            logger.info(`🔎 [${label}] Знайдено UID: [${allResults.join(', ')}] → нових: [${newR.join(', ')}]`);
            if (newR.length === 0) return;

            logger.info(`📬 [${label}] Завантажую ${newR.length} листів...`);
            const fetch = imap.fetch(newR, { bodies: '', markSeen: true, struct: true });

            const pendingPromises = [];
            let maxUidSeen = startUid;

            fetch.on('message', (msg) => {
                let raw = '';
                let uid = null;
                msg.on('attributes', (a) => {
                    uid = a.uid;
                    logger.info(`📩 [${label}] Отримую лист UID=${uid}`);
                });
                msg.on('body', (s) => { s.on('data', (c) => { raw += c.toString('utf8'); }); });
                const p = new Promise((resolve) => {
                    msg.on('end', async () => {
                        try {
                            const parsed = await simpleParser(raw);
                            const from = parsed.from?.value?.[0]?.address || '?';
                            const subject = parsed.subject || '(без теми)';
                            logger.info(`📧 [${label}] UID=${uid} | від: ${from} | тема: ${subject}`);
                            if (onNewEmail) {
                                await onNewEmail(parsed, account.user);
                                logger.info(`✅ [${label}] UID=${uid} — оброблено callback`);
                            }
                            if (uid && uid > maxUidSeen) maxUidSeen = uid;
                        } catch (e) {
                            logger.error(`❌ [${label}] UID=${uid} Parse/Send error: ${e.message}`);
                        }
                        resolve();
                    });
                });
                pendingPromises.push(p);
            });

            fetch.once('error', (e) => { processing = false; logger.error(`❌ [${label}] Fetch: ${e.message}`); });
            fetch.once('end', async () => {
                await Promise.allSettled(pendingPromises);
                if (maxUidSeen > startUid) startUid = maxUidSeen;
                processing = false;
                logger.info(`✅ [${label}] Пакет оброблено. Новий startUid: ${startUid}`);
            });
        });
    }

    imap.once('ready', () => {
        imapReconnectAttempts.delete(label);

        if (!folderName) {
            // Initial connection to discover folders
            imap.getBoxes((err, boxes) => {
                if (err) {
                    logger.error(`❌ [${account.user}] getBoxes: ${err.message}`);
                    imap.end();
                    return;
                }
                const allFolders = getAllBoxes(boxes);
                const toMonitor = allFolders.filter(f => !isExcluded(f) && f !== 'INBOX');

                logger.info(`🔍 [${account.user}] Знайдено папок для моніторингу: ${toMonitor.join(', ')}`);

                // Start INBOX monitor on THIS connection (re-using it)
                imap.openBox('INBOX', false, (err, box) => {
                    if (err) { logger.error(`❌ [${account.user}] INBOX: ${err.message}`); return; }
                    startUid = box.uidnext - 1;
                    logger.info(`📭 [${account.user}] INBOX: ${box.messages.total} листів | UID: ${startUid}`);
                    imap.on('mail', () => processNew());
                });

                // Start separate connections for other folders
                for (const folder of toMonitor) {
                    startIMAPForAccount(account, config, onNewEmail, folder);
                }
            });
        } else {
            // connection for a specific folder
            imap.openBox(folderName, false, (err, box) => {
                if (err) {
                    logger.error(`❌ [${label}] Open: ${err.message}`);
                    imap.end();
                    return;
                }
                startUid = box.uidnext - 1;
                logger.info(`📭 [${label}] ${box.messages.total} листів | UID: ${startUid}`);
                imap.on('mail', () => processNew());
            });
        }
    });

    imap.once('error', (err) => {
        logger.error(`❌ [${label}] IMAP: ${err.message}`);
        reconnect();
    });

    imap.once('end', () => {
        logger.warn(`⚠️ [${label}] IMAP закрито`);
        reconnect();
    });

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
        setTimeout(() => { reco = false; startIMAPForAccount(account, config, onNewEmail, folderName); }, delay);
    }

    imap.connect();
}

module.exports = { startIMAPForAccount, searchEmails, searchImapAccount };
