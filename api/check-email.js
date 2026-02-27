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
    CRON_SECRET,
} = process.env;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
const chatId = TELEGRAM_CHAT_ID;

// ─── Pretty HTML message formatting ──────────────────────────────
function formatEmailMessage(parsed) {
    const fromName = parsed.from?.value?.[0]?.name || '';
    const fromEmail = parsed.from?.value?.[0]?.address || parsed.from?.text || 'невідомо';
    const subject = parsed.subject || '(без теми)';
    const date = parsed.date
        ? parsed.date.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kyiv',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
        : 'невідома дата';

    // Get text content
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

    // Trim if too long
    const maxLen = 3200;
    if (body.length > maxLen) {
        body = body.substring(0, maxLen) + '\n\n✂️ <i>...повідомлення обрізано</i>';
    }

    // Escape HTML special chars in user content
    const esc = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

    // Attachments summary
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
async function sendToTelegram(parsed) {
    const message = formatEmailMessage(parsed);

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

    // Send attachments as files
    if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
            if (att.size > 50 * 1024 * 1024) {
                await bot.sendMessage(
                    chatId,
                    `⚠️ Вкладення "${att.filename}" занадто велике (${(att.size / 1024 / 1024).toFixed(1)} МБ)`,
                    { parse_mode: 'HTML' }
                );
                continue;
            }
            const fileOptions = {
                filename: att.filename || 'attachment',
                contentType: att.contentType,
            };
            await bot.sendDocument(chatId, att.content, {}, fileOptions);
        }
    }
}

// ─── IMAP: connect, fetch UNSEEN, send, disconnect ───────────────
function checkEmails() {
    return new Promise((resolve, reject) => {
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

        let processed = 0;

        imap.once('ready', () => {
            imap.openBox('INBOX', false, (err, box) => {
                if (err) {
                    imap.end();
                    return reject(err);
                }

                imap.search(['UNSEEN'], async (err, results) => {
                    if (err) {
                        imap.end();
                        return reject(err);
                    }

                    if (!results || results.length === 0) {
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
                        imap.end();
                        reject(err);
                    });

                    fetch.once('end', async () => {
                        // Parse and send all emails
                        for (const raw of emails) {
                            try {
                                const parsed = await simpleParser(raw);
                                await sendToTelegram(parsed);
                                processed++;
                            } catch (e) {
                                console.error('Parse/send error:', e.message);
                            }
                        }
                        imap.end();
                        resolve({ processed, total: box.messages.total });
                    });
                });
            });
        });

        imap.once('error', (err) => {
            reject(err);
        });

        imap.connect();
    });
}

// ─── Vercel Serverless Handler ───────────────────────────────────
module.exports = async (req, res) => {
    // Verify cron secret (optional security)
    if (CRON_SECRET && req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const result = await checkEmails();
        const timestamp = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

        console.log(`[${timestamp}] Checked: ${result.processed} new emails sent to Telegram`);

        return res.status(200).json({
            ok: true,
            timestamp,
            processed: result.processed,
            totalInbox: result.total,
        });
    } catch (err) {
        console.error('Error checking emails:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
};
