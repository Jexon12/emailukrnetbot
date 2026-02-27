const Imap = require('imap');
const { simpleParser } = require('mailparser');
const TelegramBot = require('node-telegram-bot-api');

// ─── Config ───────────────────────────────────────────────────────
const {
    EMAIL_USER,
    EMAIL_PASSWORD,
    IMAP_HOST = 'imap.ukr.net',
    IMAP_PORT = '993',
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
} = process.env;

// ─── Validate env vars early ─────────────────────────────────────
function validateEnv() {
    const missing = [];
    if (!EMAIL_USER) missing.push('EMAIL_USER');
    if (!EMAIL_PASSWORD) missing.push('EMAIL_PASSWORD');
    if (!TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
    return missing;
}

// ─── HTML escape ─────────────────────────────────────────────────
const esc = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

// ─── Pretty HTML message formatting ──────────────────────────────
function formatEmailMessage(parsed) {
    const fromName = parsed.from?.value?.[0]?.name || '';
    const fromEmail = parsed.from?.value?.[0]?.address || parsed.from?.text || 'невідомо';
    const subject = parsed.subject || '(без теми)';
    const date = parsed.date
        ? parsed.date.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kyiv',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        })
        : 'невідома дата';

    let body = parsed.text || '';
    if (!body && parsed.html) {
        body = parsed.html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    if (body.length > 3200) {
        body = body.substring(0, 3200) + '\n\n✂️ <i>...повідомлення обрізано</i>';
    }

    let attachLine = '';
    if (parsed.attachments && parsed.attachments.length > 0) {
        const attList = parsed.attachments.map(a => {
            const size = a.size > 1024 * 1024
                ? `${(a.size / 1024 / 1024).toFixed(1)} МБ`
                : `${(a.size / 1024).toFixed(1)} КБ`;
            return `📄 ${esc(a.filename || 'файл')} (${size})`;
        }).join('\n');
        attachLine = `\n\n📎 <b>Вкладення:</b>\n${attList}`;
    }

    return [
        `📨 <b>НОВЕ ПИСЬМО</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `👤 <b>Від:</b> ${esc(fromName)}`,
        `📧 <b>Email:</b> <code>${esc(fromEmail)}</code>`,
        `📋 <b>Тема:</b> ${esc(subject)}`,
        `📅 <b>Дата:</b> ${esc(date)}`,
        ``,
        `┄┄┄┄┄ <b>Текст листа</b> ┄┄┄┄┄`,
        ``,
        esc(body) || '<i>порожнє повідомлення</i>',
        attachLine,
    ].join('\n');
}

// ─── Send email to Telegram ──────────────────────────────────────
async function sendToTelegram(bot, parsed) {
    const message = formatEmailMessage(parsed);
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });

    if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
            if (att.size > 50 * 1024 * 1024) {
                await bot.sendMessage(TELEGRAM_CHAT_ID,
                    `⚠️ Вкладення "${att.filename}" занадто велике (${(att.size / 1024 / 1024).toFixed(1)} МБ)`
                );
                continue;
            }
            await bot.sendDocument(TELEGRAM_CHAT_ID, att.content, {}, {
                filename: att.filename || 'attachment',
                contentType: att.contentType,
            });
        }
    }
}

// ─── IMAP: connect, fetch UNSEEN, send, disconnect ───────────────
function checkEmails(bot) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('IMAP connection timeout (25s)'));
        }, 25000);

        const imap = new Imap({
            user: EMAIL_USER,
            password: EMAIL_PASSWORD,
            host: IMAP_HOST,
            port: parseInt(IMAP_PORT),
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 15000,
            authTimeout: 15000,
        });

        imap.once('ready', () => {
            imap.openBox('INBOX', false, (err, box) => {
                if (err) {
                    clearTimeout(timeout);
                    imap.end();
                    return reject(err);
                }

                imap.search(['UNSEEN'], async (err, results) => {
                    if (err) {
                        clearTimeout(timeout);
                        imap.end();
                        return reject(err);
                    }

                    if (!results || results.length === 0) {
                        clearTimeout(timeout);
                        imap.end();
                        return resolve({ processed: 0, total: box.messages.total });
                    }

                    const emails = [];
                    const fetch = imap.fetch(results, {
                        bodies: '',
                        markSeen: true,
                        struct: true,
                    });

                    fetch.on('message', (msg) => {
                        let rawEmail = '';
                        msg.on('body', (stream) => {
                            stream.on('data', (chunk) => {
                                rawEmail += chunk.toString('utf8');
                            });
                        });
                        msg.on('end', () => {
                            emails.push(rawEmail);
                        });
                    });

                    fetch.once('error', (err) => {
                        clearTimeout(timeout);
                        imap.end();
                        reject(err);
                    });

                    fetch.once('end', async () => {
                        let processed = 0;
                        for (const raw of emails) {
                            try {
                                const parsed = await simpleParser(raw);
                                await sendToTelegram(bot, parsed);
                                processed++;
                            } catch (e) {
                                console.error('Parse/send error:', e.message);
                            }
                        }
                        clearTimeout(timeout);
                        imap.end();
                        resolve({ processed, total: box.messages.total });
                    });
                });
            });
        });

        imap.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        imap.connect();
    });
}

// ─── Vercel Serverless Handler ───────────────────────────────────
module.exports = async (req, res) => {
    console.log('check-email invoked');

    // Check env vars
    const missing = validateEnv();
    if (missing.length > 0) {
        console.error('Missing env vars:', missing.join(', '));
        return res.status(500).json({
            ok: false,
            error: `Missing environment variables: ${missing.join(', ')}`,
        });
    }

    try {
        const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
        const result = await checkEmails(bot);
        const timestamp = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

        console.log(`[${timestamp}] Processed: ${result.processed} emails`);

        return res.status(200).json({
            ok: true,
            timestamp,
            processed: result.processed,
            totalInbox: result.total,
        });
    } catch (err) {
        console.error('Error:', err.message, err.stack);
        return res.status(500).json({
            ok: false,
            error: err.message,
        });
    }
};
