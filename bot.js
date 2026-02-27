require('dotenv').config();
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
    RECONNECT_DELAY = 5000,
} = process.env;

const required = ['EMAIL_USER', 'EMAIL_PASSWORD', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
for (const key of required) {
    if (!process.env[key]) {
        console.error(`❌ Missing: ${key}`);
        process.exit(1);
    }
}

// Polling mode — works on Render without webhooks
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const chatId = TELEGRAM_CHAT_ID;

function log(msg) {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    console.log(`[${time}] ${msg}`);
}

const esc = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

// ─── Stats tracking ──────────────────────────────────────────────
const stats = {
    startedAt: new Date(),
    emailsForwarded: 0,
    lastEmailAt: null,
    lastEmailSubject: null,
    lastEmailFrom: null,
};

// ─── Pretty HTML formatting ──────────────────────────────────────
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
async function sendToTelegram(parsed) {
    const message = formatEmailMessage(parsed);
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

    // Update stats
    stats.emailsForwarded++;
    stats.lastEmailAt = new Date();
    stats.lastEmailSubject = parsed.subject || '(без теми)';
    stats.lastEmailFrom = parsed.from?.value?.[0]?.address || 'невідомо';

    log(`✅ "${parsed.subject}" від ${stats.lastEmailFrom}`);

    if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
            if (att.size > 50 * 1024 * 1024) {
                await bot.sendMessage(chatId,
                    `⚠️ Вкладення "${att.filename}" занадто велике (${(att.size / 1024 / 1024).toFixed(1)} МБ)`
                );
                continue;
            }
            await bot.sendDocument(chatId, att.content, {}, {
                filename: att.filename || 'attachment',
                contentType: att.contentType,
            });
            log(`📎 Вкладення: ${att.filename}`);
        }
    }
}

// ─── Bot Commands ────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    bot.sendMessage(msg.chat.id, [
        `🤖 <b>Email → Telegram Bot</b>`,
        ``,
        `Пересилаю листи з пошти`,
        `<code>${esc(EMAIL_USER)}</code> сюди в чат.`,
        ``,
        `📋 <b>Команди:</b>`,
        `• /status — стан бота і пошти`,
        `• /last — останній пересланий лист`,
        `• /help — довідка`,
    ].join('\n'), { parse_mode: 'HTML' });
});

bot.onText(/\/help/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    bot.sendMessage(msg.chat.id, [
        `📋 <b>Команди:</b>`,
        ``,
        `/status — 📊 стан бота, пошти, статистика`,
        `/last — 📩 інфо про останній лист`,
        `/help — 📋 ця довідка`,
    ].join('\n'), { parse_mode: 'HTML' });
});

bot.onText(/\/status/, async (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;

    const uptime = formatUptime(Date.now() - stats.startedAt.getTime());
    const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

    bot.sendMessage(msg.chat.id, [
        `📊 <b>Стан бота</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `📧 <b>Пошта:</b> <code>${esc(EMAIL_USER)}</code>`,
        `✅ <b>Статус:</b> працює`,
        `⏱ <b>Аптайм:</b> ${uptime}`,
        `📬 <b>Листів переслано:</b> ${stats.emailsForwarded}`,
        `⏰ <b>Час:</b> ${now}`,
        stats.lastEmailAt ? `\n📩 <b>Останній лист:</b> ${stats.lastEmailAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}` : '',
    ].join('\n'), { parse_mode: 'HTML' });
});

bot.onText(/\/last/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;

    if (!stats.lastEmailAt) {
        bot.sendMessage(msg.chat.id, '📭 Ще не було пересланих листів з моменту запуску.', { parse_mode: 'HTML' });
        return;
    }

    bot.sendMessage(msg.chat.id, [
        `📩 <b>Останній пересланий лист</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `📋 <b>Тема:</b> ${esc(stats.lastEmailSubject)}`,
        `👤 <b>Від:</b> <code>${esc(stats.lastEmailFrom)}</code>`,
        `📅 <b>Коли:</b> ${stats.lastEmailAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`,
    ].join('\n'), { parse_mode: 'HTML' });
});

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}д`);
    if (h > 0) parts.push(`${h}г`);
    parts.push(`${m}хв`);
    return parts.join(' ');
}

// ─── IMAP Connection (persistent with IDLE) ──────────────────────
function startIMAP() {
    const imap = new Imap({
        user: EMAIL_USER,
        password: EMAIL_PASSWORD,
        host: IMAP_HOST,
        port: parseInt(IMAP_PORT),
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true },
    });

    let startUid = null;

    function processNewEmails() {
        if (startUid === null) return;

        imap.search([['UID', `${startUid + 1}:*`]], (err, results) => {
            if (err) { log(`❌ Пошук: ${err.message}`); return; }

            const newResults = results ? results.filter(uid => uid > startUid) : [];
            if (newResults.length === 0) return;

            log(`📬 ${newResults.length} нових листів`);

            const fetch = imap.fetch(newResults, { bodies: '', markSeen: true, struct: true });

            fetch.on('message', (msg) => {
                let rawEmail = '';
                let msgUid = null;

                msg.on('attributes', (attrs) => { msgUid = attrs.uid; });
                msg.on('body', (stream) => {
                    stream.on('data', (chunk) => { rawEmail += chunk.toString('utf8'); });
                });
                msg.on('end', async () => {
                    try {
                        const parsed = await simpleParser(rawEmail);
                        await sendToTelegram(parsed);
                        if (msgUid && msgUid > startUid) startUid = msgUid;
                    } catch (err) {
                        log(`❌ Парсинг: ${err.message}`);
                    }
                });
            });

            fetch.once('error', (err) => log(`❌ Fetch: ${err.message}`));
            fetch.once('end', () => log('✅ Оброблено'));
        });
    }

    imap.once('ready', () => {
        log('✅ Підключено до IMAP');
        imap.openBox('INBOX', false, (err, box) => {
            if (err) { log(`❌ INBOX: ${err.message}`); return; }

            startUid = box.uidnext - 1;
            log(`📭 INBOX: ${box.messages.total} листів | UID: ${startUid}`);
            log('👂 Чекаю на нові листи...');

            imap.on('mail', (n) => {
                log(`📨 +${n} лист(ів)`);
                processNewEmails();
            });
        });
    });

    imap.once('error', (err) => { log(`❌ IMAP: ${err.message}`); scheduleReconnect(); });
    imap.once('end', () => { log('⚠️ IMAP закрито'); scheduleReconnect(); });

    let reconnecting = false;
    function scheduleReconnect() {
        if (reconnecting) return;
        reconnecting = true;
        const delay = parseInt(RECONNECT_DELAY);
        log(`🔄 Перепідключення через ${delay / 1000}с...`);
        setTimeout(() => { reconnecting = false; startIMAP(); }, delay);
    }

    log('🔌 Підключення до IMAP...');
    imap.connect();
}

// ─── Startup ──────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║   📧 → 💬  Email to Telegram Bot  v2.0   ║');
    console.log('║   UKR.NET → Telegram                     ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('');
    log(`📧 ${EMAIL_USER}`);
    log(`💬 Chat ID: ${TELEGRAM_CHAT_ID}`);
    log(`🤖 Telegram polling запущено`);

    try {
        await bot.sendMessage(chatId, [
            `🤖 <b>Бот запущено!</b>`,
            ``,
            `📧 <code>${esc(EMAIL_USER)}</code>`,
            `⏰ ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`,
            ``,
            `Нові листи будуть з'являтися тут.`,
            `Введіть /help для списку команд.`,
        ].join('\n'), { parse_mode: 'HTML' });
        log('✅ Telegram OK');
    } catch (err) {
        log(`❌ Telegram: ${err.message}`);
        process.exit(1);
    }

    startIMAP();
}

main();

process.on('SIGINT', () => { log('👋 Вихід'); process.exit(0); });
process.on('uncaughtException', (err) => log(`❌ Exception: ${err.message}`));
process.on('unhandledRejection', (err) => log(`❌ Rejection: ${err.message}`));
