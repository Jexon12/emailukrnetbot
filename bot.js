require('dotenv').config();
require('./lib/patch-utf7')(); // 🛠️ Fix for utf7 Node.js > 14 Buffer deprecation
const TelegramBot = require('node-telegram-bot-api');

const store = require('./lib/store');
const logger = require('./lib/logger');
const { formatEmailMessage, esc } = require('./lib/formatter');
const { createWebPanel } = require('./lib/web');
const { registerCommands } = require('./lib/commands');
const { registerCallbacks, pendingReplies, prunePendingReplies } = require('./lib/callbacks');
const { startIMAPForAccount } = require('./lib/imap');
const { calculateSpamScore, recordSpam } = require('./lib/spam');
const { recordAnalytics } = require('./lib/analytics');
const { categorize } = require('./lib/categories');

// ─── Config ───────────────────────────────────────────────────────
const {
    EMAIL_USER,
    EMAIL_PASSWORD,
    IMAP_HOST = 'imap.ukr.net',
    IMAP_PORT = '993',
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    RECONNECT_DELAY = 5000,
    PORT = 3000,
    QUIET_START = 23,
    QUIET_END = 7,
    TLS_REJECT_UNAUTHORIZED = 'true',
    IMAP_MAX_RECONNECT_ATTEMPTS = 10,
} = process.env;

// ─── Env validation ──────────────────────────────────────────────
const required = ['EMAIL_USER', 'EMAIL_PASSWORD', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
for (const key of required) {
    if (!process.env[key]) {
        logger.error(`❌ Missing: ${key}`);
        process.exit(1);
    }
}

if (!process.env.ENCRYPTION_KEY) {
    logger.warn('⚠️ ENCRYPTION_KEY не встановлено — паролі акаунтів зберігаються відкритим текстом');
}

// ─── Bot instance ────────────────────────────────────────────────
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

bot.on('polling_error', (err) => {
    if (err.message && err.message.includes('409')) return;
    logger.error('Polling error: ' + err.message);
});

const chatId = TELEGRAM_CHAT_ID;
const startedAt = Date.now();

// ─── Shared config object ────────────────────────────────────────
const config = {
    EMAIL_USER, EMAIL_PASSWORD, IMAP_HOST, IMAP_PORT,
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
    RECONNECT_DELAY, PORT, QUIET_START, QUIET_END,
    TLS_REJECT_UNAUTHORIZED, IMAP_MAX_RECONNECT_ATTEMPTS,
    chatId, startedAt,
    onNewEmail: null, // set below
};

// ─── Quiet hours ─────────────────────────────────────────────────
function isQuietHours() {
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getHours();
    const start = parseInt(QUIET_START, 10) || 23;
    const end = parseInt(QUIET_END, 10) || 7;
    if (start > end) return hour >= start || hour < end;
    return hour >= start && hour < end;
}

// ─── Send email to Telegram ──────────────────────────────────────
async function sendToTelegram(parsed, accountLabel) {
    const fromEmail = parsed.from?.value?.[0]?.address || 'невідомо';
    const subject = parsed.subject || '(без теми)';
    const body = parsed.text || '';

    // Check filters
    if (store.isFiltered(subject, fromEmail)) {
        logger.info(`🚫 Відфільтровано: "${subject}" від ${fromEmail}`);
        return;
    }

    // Spam detection
    const spamResult = calculateSpamScore(subject, fromEmail, body, parsed.attachments);
    if (spamResult.isSpam) {
        recordSpam(fromEmail, subject);
        const reasons = spamResult.reasons.join(', ');
        logger.info(`🛡️ СПАМ (${spamResult.score}): "${subject}" від ${fromEmail} [${reasons}]`);
        await bot.sendMessage(chatId, [
            `🛡️ <b>Спам заблоковано</b>`,
            ``,
            `📧 <code>${esc(fromEmail)}</code>`,
            `📋 ${esc(subject)}`,
            `⚠️ Причини: ${esc(reasons)}`,
            `🎯 Рейтинг: ${spamResult.score}/5`,
        ].join('\n'), {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Не спам', callback_data: `notspam_${Date.now()}` },
                    { text: '🚫 Блокувати відправника', callback_data: `blocksender_${Buffer.from(fromEmail).toString('base64')}` },
                ]],
            },
        });
        return;
    }

    // Record stats & analytics
    store.recordEmail(fromEmail, subject);
    const category = categorize(subject, fromEmail, body);
    recordAnalytics(fromEmail, subject, category.name, parsed.date || new Date());

    // Check mute / quiet hours
    if (store.isMuted() || isQuietHours()) {
        store.addToMuteQueue({ from: fromEmail, subject, date: new Date().toISOString() });
        logger.info(`🔕 В чергу (тихий режим): "${subject}"`);
        return;
    }

    const message = formatEmailMessage(parsed, accountLabel);

    const cbReply = `reply_${Date.now()}`;
    const keyboard = {
        reply_markup: {
            inline_keyboard: [[
                { text: '✉️ Відповісти', callback_data: cbReply },
                { text: '🛡️ Спам', callback_data: `markspam_${Buffer.from(fromEmail).toString('base64')}_${Date.now()}` },
            ]],
        },
        parse_mode: 'HTML',
    };

    let sent;
    try {
        sent = await bot.sendMessage(chatId, message, keyboard);
    } catch (err) {
        if (err.message.includes('can\'t parse entities') || err.message.includes('Bad Request')) {
            logger.warn(`⚠️ Telegram HTML error, falling back to plain text for "${subject}"`);
            const plainMessage = [
                `📧 ${subject}`,
                `від: ${fromEmail}`,
                '',
                body.substring(0, 3000),
                parsed.attachments?.length > 0 ? `📎 Вкладень: ${parsed.attachments.length}` : ''
            ].filter(Boolean).join('\n');
            sent = await bot.sendMessage(chatId, plainMessage);
        } else {
            throw err;
        }
    }

    // Store reply info (only email, lookup account when sending reply for security)
    const replyEmail = accountLabel || EMAIL_USER;
    pendingReplies.set(cbReply, { to: fromEmail, subject, replyEmail, createdAt: Date.now() });
    prunePendingReplies();

    logger.info(`✅ "${subject}" від ${fromEmail}`);

    // Send attachments
    if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
            if (att.size > 50 * 1024 * 1024) {
                await bot.sendMessage(chatId, `⚠️ "${att.filename}" занадто велике`);
                continue;
            }
            await bot.sendDocument(chatId, att.content, {}, {
                filename: att.filename || 'attachment',
                contentType: att.contentType,
            });
            logger.info(`📎 ${att.filename}`);
        }
    }
}

// Set the onNewEmail callback
config.onNewEmail = sendToTelegram;

// ─── Register handlers ──────────────────────────────────────────
registerCommands(bot, config);
registerCallbacks(bot, config);

// ─── Mute queue flush timer ─────────────────────────────────────
setInterval(async () => {
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getHours();
    const min = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getMinutes();
    if (hour === 7 && min < 2 && store.isMuted()) {
        const queue = store.flushMuteQueue();
        if (queue.length > 0) {
            const summary = queue.map((e, i) =>
                `${i + 1}. <b>${esc(e.subject)}</b> від <code>${esc(e.from)}</code>`
            ).join('\n');
            await bot.sendMessage(chatId, [
                `☀️ <b>Доброго ранку! Ось пропущені листи:</b>`,
                ``,
                summary,
            ].join('\n'), { parse_mode: 'HTML' });
            logger.info(`☀️ Flush: ${queue.length} листів`);
        }
    }
}, 60000);

// ─── Startup ─────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║   📧 → 💬  Email to Telegram Bot  v4.0   ║');
    console.log('║   Full-featured Email Bot                 ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('');

    // Start web panel FIRST so Render detects the port
    const app = createWebPanel({ mainEmail: EMAIL_USER });
    app.listen(parseInt(PORT), '0.0.0.0', () => {
        logger.info(`🌐 Веб-панель: http://0.0.0.0:${PORT}`);
    });

    // Delete webhook and start polling
    try {
        await bot.deleteWebHook();
        logger.info('✅ Webhook видалено');
    } catch (e) {
        logger.warn(`⚠️ Webhook: ${e.message}`);
    }
    bot.startPolling();
    logger.info('✅ Polling запущено');

    // Register command hints in Telegram
    await bot.setMyCommands([
        { command: 'status', description: '📊 Стан бота' },
        { command: 'stats', description: '📈 Статистика листів' },
        { command: 'analytics', description: '📈 Аналітика (піки, тренди)' },
        { command: 'digest', description: '📋 Дайджест за сьогодні' },
        { command: 'search', description: '🔍 Пошук листів' },
        { command: 'filter', description: '⚡ Керування фільтрами' },
        { command: 'spam', description: '🛡️ Спам-фільтр' },
        { command: 'mute', description: '🔕 Тихий режим' },
        { command: 'unmute', description: '🔔 Вимкнути тихий' },
        { command: 'accounts', description: '📧 Підключені акаунти' },
        { command: 'addmail', description: '📧 Додати акаунт' },
        { command: 'miniapp', description: '📱 Відкрити Mini App' },
        { command: 'help', description: '📋 Довідка' },
    ]);
    logger.info('✅ Команди зареєстровано');

    logger.info(`📧 Main: ${EMAIL_USER}`);
    logger.info(`💬 Chat: ${TELEGRAM_CHAT_ID}`);

    // Notify on Telegram
    try {
        const accounts = store.getAccounts();
        await bot.sendMessage(chatId, [
            `🤖 <b>Bot v4.0 запущено!</b>`,
            ``,
            `📧 <code>${esc(EMAIL_USER)}</code>`,
            accounts.length > 0 ? `📧 + ${accounts.length} додаткових акаунтів` : '',
            `⏰ ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`,
            ``,
            `Введіть /help для списку команд.`,
        ].filter(Boolean).join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
        logger.error(`❌ Telegram: ${err.message}`);
        process.exit(1);
    }

    // Start main IMAP
    startIMAPForAccount({
        user: EMAIL_USER,
        password: EMAIL_PASSWORD,
        imapHost: IMAP_HOST,
        imapPort: IMAP_PORT,
    }, config, sendToTelegram);

    // Start extra accounts
    const extraAccounts = store.getAccounts();
    for (const acc of extraAccounts) {
        startIMAPForAccount(acc, config, sendToTelegram);
    }

    logger.info(`🚀 Запущено ${1 + extraAccounts.length} IMAP з'єднань`);

    // ─── Keep-alive: self-ping every 14 min ──────────────────────
    const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000;
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
        setInterval(() => {
            fetch(`${renderUrl}/api/health`)
                .then(res => res.json())
                .then(data => logger.info(`🏓 Keep-alive ping OK (uptime: ${Math.floor(data.uptime / 60)}хв)`))
                .catch(err => logger.warn(`⚠️ Keep-alive ping failed: ${err.message}`));
        }, KEEP_ALIVE_INTERVAL);
        logger.info(`🏓 Keep-alive увімкнено (кожні 14 хв → ${renderUrl})`);
    } else {
        logger.warn(`⚠️ RENDER_EXTERNAL_URL не встановлено — keep-alive вимкнено`);
    }
}

main();

// ─── Graceful shutdown ──────────────────────────────────────────
process.on('SIGINT', () => { store.flush(); logger.info('👋 Вихід'); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); logger.info('👋 Вихід'); process.exit(0); });
process.on('uncaughtException', (err) => logger.error(`❌ Exception:\n${err.stack || err.message}`));
process.on('unhandledRejection', (err) => logger.error(`❌ Rejection:\n${err.stack || err.message}`));
