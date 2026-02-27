const Imap = require('imap');
const { simpleParser } = require('mailparser');
const TelegramBot = require('node-telegram-bot-api');

const {
    EMAIL_USER,
    EMAIL_PASSWORD,
    IMAP_HOST = 'imap.ukr.net',
    IMAP_PORT = '993',
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
} = process.env;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// ─── Helper: escape HTML ─────────────────────────────────────────
const esc = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

// ─── Get inbox status ────────────────────────────────────────────
function getInboxStatus() {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: EMAIL_USER,
            password: EMAIL_PASSWORD,
            host: IMAP_HOST,
            port: parseInt(IMAP_PORT),
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 10000,
            authTimeout: 10000,
        });

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err, box) => {
                if (err) { imap.end(); return reject(err); }

                imap.search(['UNSEEN'], (err, unseen) => {
                    if (err) { imap.end(); return reject(err); }

                    imap.end();
                    resolve({
                        total: box.messages.total,
                        unseen: unseen ? unseen.length : 0,
                    });
                });
            });
        });

        imap.once('error', reject);
        imap.connect();
    });
}

// ─── Get last email ──────────────────────────────────────────────
function getLastEmail() {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: EMAIL_USER,
            password: EMAIL_PASSWORD,
            host: IMAP_HOST,
            port: parseInt(IMAP_PORT),
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 10000,
            authTimeout: 10000,
        });

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err, box) => {
                if (err) { imap.end(); return reject(err); }

                if (box.messages.total === 0) {
                    imap.end();
                    return resolve(null);
                }

                // Fetch the last message
                const fetch = imap.seq.fetch(box.messages.total, {
                    bodies: '',
                    struct: true,
                });

                let rawEmail = '';

                fetch.on('message', (msg) => {
                    msg.on('body', (stream) => {
                        stream.on('data', (chunk) => {
                            rawEmail += chunk.toString('utf8');
                        });
                    });
                });

                fetch.once('end', async () => {
                    try {
                        const parsed = await simpleParser(rawEmail);
                        imap.end();
                        resolve(parsed);
                    } catch (e) {
                        imap.end();
                        reject(e);
                    }
                });

                fetch.once('error', (err) => {
                    imap.end();
                    reject(err);
                });
            });
        });

        imap.once('error', reject);
        imap.connect();
    });
}

// ─── Handle bot commands ─────────────────────────────────────────
async function handleCommand(chatIdFrom, text) {
    const cmd = text.trim().toLowerCase();

    // ── /start ──
    if (cmd === '/start') {
        return bot.sendMessage(chatIdFrom, [
            `🤖 <b>Email → Telegram Bot</b>`,
            ``,
            `Я пересилаю листи з вашої пошти`,
            `<code>${esc(EMAIL_USER)}</code> сюди в чат.`,
            ``,
            `📋 <b>Команди:</b>`,
            `• /status — стан пошти`,
            `• /last — останній лист`,
            `• /help — довідка`,
        ].join('\n'), { parse_mode: 'HTML' });
    }

    // ── /help ──
    if (cmd === '/help') {
        return bot.sendMessage(chatIdFrom, [
            `📋 <b>Доступні команди:</b>`,
            ``,
            `/status — 📊 кількість листів і непрочитаних`,
            `/last — 📩 показати останній лист`,
            `/help — 📋 ця довідка`,
            ``,
            `⏰ Бот перевіряє пошту кожні 2 хв.`,
        ].join('\n'), { parse_mode: 'HTML' });
    }

    // ── /status ──
    if (cmd === '/status') {
        try {
            const status = await getInboxStatus();
            const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
            return bot.sendMessage(chatIdFrom, [
                `📊 <b>Стан пошти</b>`,
                `━━━━━━━━━━━━━━━━━━━━`,
                ``,
                `📧 <b>Email:</b> <code>${esc(EMAIL_USER)}</code>`,
                `📭 <b>Всього листів:</b> ${status.total}`,
                `🔴 <b>Непрочитаних:</b> ${status.unseen}`,
                `⏰ <b>Перевірено:</b> ${time}`,
                ``,
                `✅ Бот працює нормально`,
            ].join('\n'), { parse_mode: 'HTML' });
        } catch (err) {
            return bot.sendMessage(chatIdFrom,
                `❌ Не вдалося перевірити пошту:\n<code>${esc(err.message)}</code>`,
                { parse_mode: 'HTML' }
            );
        }
    }

    // ── /last ──
    if (cmd === '/last') {
        try {
            const email = await getLastEmail();
            if (!email) {
                return bot.sendMessage(chatIdFrom, '📭 Пошта порожня');
            }

            const fromName = email.from?.value?.[0]?.name || '';
            const fromEmail = email.from?.value?.[0]?.address || 'невідомо';
            const subject = email.subject || '(без теми)';
            const date = email.date
                ? email.date.toLocaleString('uk-UA', {
                    timeZone: 'Europe/Kyiv',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                })
                : '?';

            let body = email.text || '';
            if (body.length > 500) {
                body = body.substring(0, 500) + '...';
            }

            return bot.sendMessage(chatIdFrom, [
                `📩 <b>Останній лист</b>`,
                `━━━━━━━━━━━━━━━━━━━━`,
                ``,
                `👤 <b>Від:</b> ${esc(fromName)}`,
                `📧 <b>Email:</b> <code>${esc(fromEmail)}</code>`,
                `📋 <b>Тема:</b> ${esc(subject)}`,
                `📅 <b>Дата:</b> ${esc(date)}`,
                ``,
                `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`,
                ``,
                esc(body) || '<i>порожнє</i>',
            ].join('\n'), { parse_mode: 'HTML' });
        } catch (err) {
            return bot.sendMessage(chatIdFrom,
                `❌ Помилка:\n<code>${esc(err.message)}</code>`,
                { parse_mode: 'HTML' }
            );
        }
    }
}

// ─── Vercel Webhook Handler ──────────────────────────────────────
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true, message: 'Webhook is active' });
    }

    try {
        const { message } = req.body || {};

        if (!message || !message.text) {
            return res.status(200).json({ ok: true });
        }

        // Only respond to our chat
        if (String(message.chat.id) !== String(TELEGRAM_CHAT_ID)) {
            return res.status(200).json({ ok: true });
        }

        if (message.text.startsWith('/')) {
            await handleCommand(message.chat.id, message.text);
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Webhook error:', err.message);
        return res.status(200).json({ ok: true });
    }
};
