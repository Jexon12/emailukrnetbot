require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const TelegramBot = require('node-telegram-bot-api');

const store = require('./lib/store');
const { formatEmailMessage, formatDigest, formatStats, esc } = require('./lib/formatter');
const { sendReply } = require('./lib/smtp');
const { createWebPanel } = require('./lib/web');
const { calculateSpamScore, recordSpam, getSpamStats, addSpamWord, removeSpamWord, getSpamWords, addSpamSender, removeSpamSender, getSpamSenders } = require('./lib/spam');
const { recordAnalytics, getPeakHours, getPeakDays, getTopSenders, getCategoryBreakdown, getDailyTrend } = require('./lib/analytics');
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
} = process.env;

const required = ['EMAIL_USER', 'EMAIL_PASSWORD', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
for (const key of required) {
    if (!process.env[key]) {
        console.error(`❌ Missing: ${key}`);
        process.exit(1);
    }
}
// Don't start polling yet — will start in main() after cleanup
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Handle 409 conflicts gracefully (deploy transitions)
bot.on('polling_error', (err) => {
    if (err.message && err.message.includes('409')) {
        // Another instance — silently wait
        return;
    }
    console.error('Polling error:', err.message);
});
const chatId = TELEGRAM_CHAT_ID;

// Store pending replies: messageId -> { to, subject, account }
const pendingReplies = new Map();

function log(msg) {
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    console.log(`[${time}] ${msg}`);
}

// ─── Quiet mode check ────────────────────────────────────────────
function isQuietHours() {
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getHours();
    return hour >= 23 || hour < 7;
}

// ─── Send email to Telegram ──────────────────────────────────────
async function sendToTelegram(parsed, accountLabel) {
    const fromEmail = parsed.from?.value?.[0]?.address || 'невідомо';
    const subject = parsed.subject || '(без теми)';
    const body = parsed.text || '';

    // Check filters
    if (store.isFiltered(subject, fromEmail)) {
        log(`🚫 Відфільтровано: "${subject}" від ${fromEmail}`);
        return;
    }

    // Spam detection
    const spamResult = calculateSpamScore(subject, fromEmail, body, parsed.attachments);
    if (spamResult.isSpam) {
        recordSpam(fromEmail, subject);
        const reasons = spamResult.reasons.join(', ');
        log(`🛡️ СПАМ (${spamResult.score}): "${subject}" від ${fromEmail} [${reasons}]`);
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
                    { text: '🚫 Блокувати відправника', callback_data: `blocksender_${fromEmail}` },
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
        log(`🔕 В чергу (тихий режим): "${subject}"`);
        return;
    }

    const message = formatEmailMessage(parsed, accountLabel);

    const cbReply = `reply_${Date.now()}`;
    const keyboard = {
        reply_markup: {
            inline_keyboard: [[
                { text: '✉️ Відповісти', callback_data: cbReply },
                { text: '🛡️ Спам', callback_data: `markspam_${fromEmail}_${Date.now()}` },
            ]],
        },
        parse_mode: 'HTML',
    };

    const sent = await bot.sendMessage(chatId, message, keyboard);

    // Store reply info
    const account = accountLabel
        ? store.getAccounts().find(a => a.user === accountLabel) || { user: EMAIL_USER, password: EMAIL_PASSWORD }
        : { user: EMAIL_USER, password: EMAIL_PASSWORD };

    pendingReplies.set(cbReply, { to: fromEmail, subject, account });

    log(`✅ "${subject}" від ${fromEmail}`);

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
            log(`📎 ${att.filename}`);
        }
    }
}

// ─── Callback: Reply button ──────────────────────────────────────
bot.on('callback_query', async (query) => {
    const data = query.data;

    // Reply button
    if (data.startsWith('reply_')) {
        const replyInfo = pendingReplies.get(data);
        if (!replyInfo) {
            await bot.answerCallbackQuery(query.id, { text: '⏰ Дані застаріли' });
            return;
        }
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, [
            `✉️ <b>Відповідь на лист:</b>`,
            `📧 <b>Кому:</b> <code>${esc(replyInfo.to)}</code>`,
            `📋 <b>Тема:</b> Re: ${esc(replyInfo.subject)}`,
            ``, `Напишіть текст відповіді:`,
        ].join('\n'), { parse_mode: 'HTML', reply_markup: { force_reply: true } });

        bot.once('message', async (msg) => {
            if (String(msg.chat.id) !== String(chatId) || !msg.text || msg.text.startsWith('/')) return;
            try {
                await sendReply(replyInfo.account, replyInfo.to, replyInfo.subject, msg.text);
                await bot.sendMessage(chatId, `✅ Відправлено на <code>${esc(replyInfo.to)}</code>`, { parse_mode: 'HTML' });
            } catch (err) {
                await bot.sendMessage(chatId, `❌ SMTP: <code>${esc(err.message)}</code>`, { parse_mode: 'HTML' });
            }
        });
    }

    // Mark as spam
    if (data.startsWith('markspam_')) {
        const sender = data.split('_')[1];
        addSpamSender(sender);
        await bot.answerCallbackQuery(query.id, { text: '🛡️ Відправника заблоковано' });
        await bot.sendMessage(chatId, `🛡️ <code>${esc(sender)}</code> додано до спам-списку`, { parse_mode: 'HTML' });
        log(`🛡️ Spam sender: ${sender}`);
    }

    // Not spam
    if (data.startsWith('notspam_')) {
        await bot.answerCallbackQuery(query.id, { text: '✅ Позначено як не спам' });
    }

    // Block sender
    if (data.startsWith('blocksender_')) {
        const sender = data.replace('blocksender_', '');
        addSpamSender(sender);
        await bot.answerCallbackQuery(query.id, { text: '🚫 Відправника заблоковано' });
        await bot.sendMessage(chatId, `🚫 <code>${esc(sender)}</code> заблоковано`, { parse_mode: 'HTML' });
    }

    // IMAP host selection for addmail
    if (data.startsWith('imaphost_')) {
        const host = data.replace('imaphost_', '');
        await bot.answerCallbackQuery(query.id);
        finishAddMail(query.message.chat.id, host);
    }
});

// ─── Bot Commands ────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    bot.sendMessage(msg.chat.id, [
        `🤖 <b>Email → Telegram Bot v4</b>`,
        ``,
        `📋 <b>Команди:</b>`,
        `/status — стан бота`,
        `/stats — статистика листів`,
        `/analytics — аналітика (піки, тренди)`,
        `/digest — дайджест за сьогодні`,
        `/search &lt;слово&gt; — пошук листів`,
        `/filter — керування фільтрами`,
        `/spam — спам-фільтр`,
        `/mute / /unmute — тихий режим`,
        `/accounts — підключені акаунти`,
        `/miniapp — 📱 Mini App`,
        `/help — довідка`,
    ].join('\n'), { parse_mode: 'HTML' });
});

bot.onText(/\/help/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    bot.sendMessage(msg.chat.id, [
        `📋 <b>Усі команди:</b>`,
        ``,
        `📊 <b>Інформація:</b>`,
        `/status — стан бота і пошти`,
        `/stats — статистика за сьогодні/тиждень/місяць`,
        `/analytics — аналітика (піки, тренди, категорії)`,
        `/digest — дайджест за сьогодні`,
        `/search &lt;слово&gt; — пошук за темою/відправником`,
        ``,
        `⚙️ <b>Налаштування:</b>`,
        `/mute — 🔕 тихий режим (листи в чергу)`,
        `/unmute — 🔔 вимкнути тихий`,
        `/filter add &lt;слово&gt; — ігнорувати листи`,
        `/filter remove &lt;слово&gt; — прибрати фільтр`,
        `/filter list — список фільтрів`,
        ``,
        `🛡️ <b>Спам-фільтр:</b>`,
        `/spam — статус фільтра`,
        `/spam add &lt;слово&gt; — додати спам-слово`,
        `/spam block &lt;email&gt; — заблокувати відправника`,
        ``,
        `📧 <b>Акаунти:</b>`,
        `/accounts — список підключених`,
        `/addmail — додати акаунт`,
        `/removemail &lt;email&gt; — видалити акаунт`,
        ``,
        `📱 <b>Інше:</b>`,
        `/miniapp — відкрити Mini App`,
        `✉️ Кнопка "Відповісти" під кожним листом`,
        `🛡️ Кнопка "Спам" — заблокувати в 1 клік`,
    ].join('\n'), { parse_mode: 'HTML' });
});

bot.onText(/\/status/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const data = store.get();
    const uptime = formatUptime(Date.now() - startedAt);
    const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    const accounts = data.accounts.map(a => a.user);

    bot.sendMessage(msg.chat.id, [
        `📊 <b>Стан бота</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `✅ <b>Статус:</b> працює`,
        `⏱ <b>Аптайм:</b> ${uptime}`,
        `📧 <b>Основна пошта:</b> <code>${esc(EMAIL_USER)}</code>`,
        accounts.length > 0 ? `📧 <b>Додаткові:</b> ${accounts.map(a => `<code>${esc(a)}</code>`).join(', ')}` : '',
        `🔕 <b>Тихий режим:</b> ${data.muted ? 'увімкнено' : 'вимкнено'}`,
        `⚡ <b>Фільтри:</b> ${data.filters.length > 0 ? data.filters.join(', ') : 'немає'}`,
        `📬 <b>Переслано:</b> ${data.stats.totalForwarded}`,
        `⏰ <b>Час:</b> ${now}`,
    ].filter(Boolean).join('\n'), { parse_mode: 'HTML' });
});

bot.onText(/\/stats/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const today = store.getStatsForPeriod(1);
    const week = store.getStatsForPeriod(7);
    const month = store.getStatsForPeriod(30);
    bot.sendMessage(msg.chat.id, formatStats(today, week, month), { parse_mode: 'HTML' });
});

bot.onText(/\/digest/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const today = new Date().toISOString().slice(0, 10);
    const digest = store.getTodayDigest();
    bot.sendMessage(msg.chat.id, formatDigest(digest, today), { parse_mode: 'HTML' });
});

// ── Analytics
bot.onText(/\/analytics/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const peaks = getPeakHours();
    const days = getPeakDays();
    const topS = getTopSenders(5);
    const cats = getCategoryBreakdown();

    const peakStr = peaks.map(p => `${p.hour}:00 (${p.count})`).join(', ');
    const dayStr = days.slice(0, 3).map(d => `${d.day} (${d.count})`).join(', ');
    const senderStr = topS.length > 0
        ? topS.map((s, i) => `  ${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} <code>${esc(s.email)}</code> — ${s.count}`).join('\n')
        : '  —';
    const catStr = cats.length > 0
        ? cats.slice(0, 5).map(c => `  ${c.name} — ${c.count} (${c.pct}%)`).join('\n')
        : '  —';

    bot.sendMessage(msg.chat.id, [
        `📈 <b>Аналітика</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🕐 <b>Пік годин:</b> ${peakStr || '—'}`,
        `📅 <b>Пік днів:</b> ${dayStr || '—'}`,
        ``,
        `👥 <b>Топ відправники:</b>`,
        senderStr,
        ``,
        `🏷️ <b>Категорії:</b>`,
        catStr,
    ].join('\n'), { parse_mode: 'HTML' });
});

// ── Spam commands
bot.onText(/\/spam(.*)/, (msg, match) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const args = (match[1] || '').trim().split(' ');
    const action = args[0];
    const value = args.slice(1).join(' ');

    if (action === 'add' && value) {
        addSpamWord(value);
        bot.sendMessage(msg.chat.id, `🛡️ Спам-слово додано: <b>${esc(value)}</b>`, { parse_mode: 'HTML' });
    } else if (action === 'remove' && value) {
        removeSpamWord(value);
        bot.sendMessage(msg.chat.id, `🗑 Спам-слово видалено: <b>${esc(value)}</b>`, { parse_mode: 'HTML' });
    } else if (action === 'block' && value) {
        addSpamSender(value);
        bot.sendMessage(msg.chat.id, `🚫 Відправника заблоковано: <code>${esc(value)}</code>`, { parse_mode: 'HTML' });
    } else if (action === 'unblock' && value) {
        removeSpamSender(value);
        bot.sendMessage(msg.chat.id, `✅ Відправника розблоковано: <code>${esc(value)}</code>`, { parse_mode: 'HTML' });
    } else if (action === 'list' || !action) {
        const words = getSpamWords();
        const senders = getSpamSenders();
        const stats = getSpamStats();
        bot.sendMessage(msg.chat.id, [
            `🛡️ <b>Спам-фільтр</b>`,
            `━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `🚫 <b>Заблоковано:</b> ${stats.total} листів`,
            ``,
            `📝 <b>Спам-слова:</b> ${words.length > 0 ? words.join(', ') : 'немає'}`,
            `🚫 <b>Заблоковані:</b> ${senders.length > 0 ? senders.map(s => `<code>${esc(s)}</code>`).join(', ') : 'немає'}`,
            ``,
            `/spam add &lt;слово&gt;`,
            `/spam remove &lt;слово&gt;`,
            `/spam block &lt;email&gt;`,
            `/spam unblock &lt;email&gt;`,
        ].join('\n'), { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(msg.chat.id, [
            '🛡️ <b>Спам-команди:</b>',
            '/spam — список і статистика',
            '/spam add &lt;слово&gt; — додати спам-слово',
            '/spam remove &lt;слово&gt; — видалити',
            '/spam block &lt;email&gt; — заблокувати відправника',
            '/spam unblock &lt;email&gt; — розблокувати',
        ].join('\n'), { parse_mode: 'HTML' });
    }
});

// ── Mini App command
bot.onText(/\/miniapp/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    bot.sendMessage(msg.chat.id, `📱 <b>Mini App:</b>`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: '📱 Відкрити Mini App', web_app: { url: `${url}/miniapp` } },
            ]],
        },
    });
});

// ── Mute/Unmute
bot.onText(/\/mute/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    if (msg.text === '/mute') {
        store.setMuted(true);
        bot.sendMessage(msg.chat.id, `🔕 <b>Тихий режим увімкнено.</b>\nЛисти будуть зберігатися в черзі.\nВведіть /unmute щоб отримати їх.`, { parse_mode: 'HTML' });
        log('🔕 Mute ON');
    }
});

bot.onText(/\/unmute/, async (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    store.setMuted(false);
    const queue = store.flushMuteQueue();

    if (queue.length > 0) {
        let summary = queue.map((e, i) => `  ${i + 1}. <b>${esc(e.subject)}</b> від <code>${esc(e.from)}</code>`).join('\n');
        await bot.sendMessage(msg.chat.id, [
            `🔔 <b>Тихий режим вимкнено!</b>`,
            ``,
            `📬 Пропущено ${queue.length} листів:`,
            summary,
        ].join('\n'), { parse_mode: 'HTML' });
    } else {
        await bot.sendMessage(msg.chat.id, `🔔 <b>Тихий режим вимкнено.</b> Пропущених листів немає.`, { parse_mode: 'HTML' });
    }
    log('🔔 Mute OFF');
});

// ── Filters
bot.onText(/\/filter(.*)/, (msg, match) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const args = (match[1] || '').trim().split(' ');
    const action = args[0];
    const keyword = args.slice(1).join(' ');

    if (action === 'add' && keyword) {
        store.addFilter(keyword);
        bot.sendMessage(msg.chat.id, `✅ Фільтр додано: <b>${esc(keyword)}</b>\nЛисти з цим словом будуть ігноруватися.`, { parse_mode: 'HTML' });
        log(`⚡ Filter +: ${keyword}`);
    } else if (action === 'remove' && keyword) {
        store.removeFilter(keyword);
        bot.sendMessage(msg.chat.id, `🗑 Фільтр видалено: <b>${esc(keyword)}</b>`, { parse_mode: 'HTML' });
        log(`⚡ Filter -: ${keyword}`);
    } else if (action === 'list' || !action) {
        const filters = store.getFilters();
        bot.sendMessage(msg.chat.id, filters.length > 0
            ? `⚡ <b>Фільтри:</b>\n${filters.map(f => `  • ${esc(f)}`).join('\n')}`
            : '⚡ Фільтрів немає.\n\nДодати: /filter add &lt;слово&gt;',
            { parse_mode: 'HTML' }
        );
    } else {
        bot.sendMessage(msg.chat.id, [
            '⚡ <b>Використання:</b>',
            '/filter add &lt;слово&gt; — додати',
            '/filter remove &lt;слово&gt; — видалити',
            '/filter list — список',
        ].join('\n'), { parse_mode: 'HTML' });
    }
});

// ── Search
bot.onText(/\/search (.+)/, async (msg, match) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const query = match[1].trim();

    await bot.sendMessage(msg.chat.id, `🔍 Шукаю "<b>${esc(query)}</b>"...`, { parse_mode: 'HTML' });

    try {
        const results = await searchEmails(query);
        if (results.length === 0) {
            bot.sendMessage(msg.chat.id, `🔍 Нічого не знайдено за "<b>${esc(query)}</b>"`, { parse_mode: 'HTML' });
        } else {
            const list = results.slice(0, 10).map((r, i) =>
                `${i + 1}. <b>${esc(r.subject)}</b>\n   📧 ${esc(r.from)} | 📅 ${esc(r.date)}`
            ).join('\n\n');
            bot.sendMessage(msg.chat.id, [
                `🔍 <b>Результати (${results.length}):</b>`,
                ``,
                list,
            ].join('\n'), { parse_mode: 'HTML' });
        }
    } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Помилка пошуку: <code>${esc(err.message)}</code>`, { parse_mode: 'HTML' });
    }
});

// ── Accounts
bot.onText(/\/accounts/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const accounts = store.getAccounts();
    bot.sendMessage(msg.chat.id, [
        `📧 <b>Підключені акаунти:</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🟢 <code>${esc(EMAIL_USER)}</code> <i>(основний)</i>`,
        ...accounts.map(a => `🟢 <code>${esc(a.user)}</code>`),
        ``,
        `Додати: /addmail`,
        accounts.length > 0 ? `Видалити: /removemail &lt;email&gt;` : '',
    ].filter(Boolean).join('\n'), { parse_mode: 'HTML' });
});

// ── Add mail — step by step
const addMailState = {};

bot.onText(/\/addmail/, (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    addMailState[msg.chat.id] = { step: 'email' };
    bot.sendMessage(msg.chat.id, [
        `📧 <b>Додавання нового акаунту</b>`,
        ``,
        `Введіть email адресу:`,
    ].join('\n'), { parse_mode: 'HTML', reply_markup: { force_reply: true } });
});

bot.on('message', async (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    const state = addMailState[msg.chat.id];
    if (!state) return;

    if (state.step === 'email') {
        state.user = msg.text.trim();
        state.step = 'password';
        bot.sendMessage(msg.chat.id, `🔑 Введіть IMAP пароль для <code>${esc(state.user)}</code>:`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
    } else if (state.step === 'password') {
        state.password = msg.text.trim();
        state.step = 'host';
        // Try to auto-detect host
        const domain = state.user.split('@')[1];
        const guessHost = `imap.${domain}`;
        bot.sendMessage(msg.chat.id, `🌐 IMAP сервер (натисніть кнопку або введіть свій):`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `📧 ${guessHost}`, callback_data: `imaphost_${guessHost}` }],
                    [{ text: '📧 imap.gmail.com', callback_data: 'imaphost_imap.gmail.com' }],
                    [{ text: '📧 outlook.office365.com', callback_data: 'imaphost_outlook.office365.com' }],
                ],
            },
        });
    } else if (state.step === 'host') {
        finishAddMail(msg.chat.id, msg.text.trim());
    }
});

// imaphost callback is handled in the main callback_query handler above

function finishAddMail(chatIdFrom, host) {
    const state = addMailState[chatIdFrom];
    if (!state || !state.user || !state.password) return;

    const account = {
        user: state.user,
        password: state.password,
        imapHost: host,
        imapPort: '993',
        smtpHost: `smtp.${state.user.split('@')[1]}`,
        smtpPort: '465',
    };

    store.addAccount(account);
    delete addMailState[chatIdFrom];

    bot.sendMessage(chatIdFrom, [
        `✅ <b>Акаунт додано!</b>`,
        `📧 ${esc(account.user)}`,
        `🌐 ${esc(host)}`,
        ``,
        `Підключаюсь до IMAP...`,
    ].join('\n'), { parse_mode: 'HTML' });

    log(`📧 Акаунт додано: ${account.user}`);
    startIMAPForAccount(account);
}

bot.onText(/\/removemail (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    const email = match[1].trim();
    store.removeAccount(email);
    bot.sendMessage(msg.chat.id, `🗑 Акаунт <code>${esc(email)}</code> видалено.`, { parse_mode: 'HTML' });
    log(`🗑 Акаунт видалено: ${email}`);
});

// ─── IMAP Search ─────────────────────────────────────────────────
function searchEmails(query) {
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

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err) => {
                if (err) { imap.end(); return reject(err); }

                imap.search([['OR', ['SUBJECT', query], ['FROM', query]]], (err, results) => {
                    if (err) { imap.end(); return reject(err); }

                    if (!results || results.length === 0) {
                        imap.end();
                        return resolve([]);
                    }

                    // Get last 10
                    const ids = results.slice(-10);
                    const emails = [];

                    const fetch = imap.fetch(ids, { bodies: 'HEADER.FIELDS (FROM SUBJECT DATE)', struct: true });

                    fetch.on('message', (msg) => {
                        let header = '';
                        msg.on('body', (stream) => {
                            stream.on('data', (chunk) => { header += chunk.toString('utf8'); });
                        });
                        msg.on('end', () => {
                            const fromMatch = header.match(/From: (.+)/i);
                            const subjectMatch = header.match(/Subject: (.+)/i);
                            const dateMatch = header.match(/Date: (.+)/i);
                            emails.push({
                                from: fromMatch ? fromMatch[1].trim() : '?',
                                subject: subjectMatch ? subjectMatch[1].trim() : '?',
                                date: dateMatch ? dateMatch[1].trim() : '?',
                            });
                        });
                    });

                    fetch.once('end', () => {
                        imap.end();
                        resolve(emails.reverse());
                    });

                    fetch.once('error', (err) => {
                        imap.end();
                        reject(err);
                    });
                });
            });
        });

        imap.once('error', reject);
        imap.connect();
    });
}

// ─── IMAP Persistent Connection ──────────────────────────────────
function startIMAPForAccount(account) {
    const imap = new Imap({
        user: account.user,
        password: account.password,
        host: account.imapHost || IMAP_HOST,
        port: parseInt(account.imapPort || IMAP_PORT),
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true },
    });

    let startUid = null;
    const label = account.user;

    function processNew() {
        if (startUid === null) return;
        imap.search([['UID', `${startUid + 1}:*`]], (err, results) => {
            if (err) { log(`❌ [${label}] Пошук: ${err.message}`); return; }
            const newR = results ? results.filter(uid => uid > startUid) : [];
            if (newR.length === 0) return;

            log(`📬 [${label}] ${newR.length} нових`);
            const fetch = imap.fetch(newR, { bodies: '', markSeen: true, struct: true });

            fetch.on('message', (msg) => {
                let raw = '';
                let uid = null;
                msg.on('attributes', (a) => { uid = a.uid; });
                msg.on('body', (s) => { s.on('data', (c) => { raw += c.toString('utf8'); }); });
                msg.on('end', async () => {
                    try {
                        const parsed = await simpleParser(raw);
                        await sendToTelegram(parsed, label);
                        if (uid && uid > startUid) startUid = uid;
                    } catch (e) { log(`❌ [${label}] Parse: ${e.message}`); }
                });
            });

            fetch.once('error', (e) => log(`❌ [${label}] Fetch: ${e.message}`));
            fetch.once('end', () => log(`✅ [${label}] Оброблено`));
        });
    }

    imap.once('ready', () => {
        log(`✅ [${label}] IMAP підключено`);
        imap.openBox('INBOX', false, (err, box) => {
            if (err) { log(`❌ [${label}] INBOX: ${err.message}`); return; }
            startUid = box.uidnext - 1;
            log(`📭 [${label}] ${box.messages.total} листів | UID: ${startUid}`);
            imap.on('mail', (n) => { log(`📨 [${label}] +${n}`); processNew(); });
        });
    });

    imap.once('error', (e) => { log(`❌ [${label}] IMAP: ${e.message}`); reconnect(); });
    imap.once('end', () => { log(`⚠️ [${label}] IMAP закрито`); reconnect(); });

    let reco = false;
    function reconnect() {
        if (reco) return;
        reco = true;
        setTimeout(() => { reco = false; startIMAPForAccount(account); }, parseInt(RECONNECT_DELAY));
    }

    log(`🔌 [${label}] Підключення...`);
    imap.connect();
}

// ─── Mute queue flush timer ──────────────────────────────────────
setInterval(async () => {
    // Flush queue at 07:00 Kyiv time
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getHours();
    const min = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getMinutes();
    if (hour === 7 && min === 0 && store.isMuted()) {
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
            log(`☀️ Flush: ${queue.length} leaves`);
        }
    }
}, 60000);

// ─── Helpers ─────────────────────────────────────────────────────
const startedAt = Date.now();

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

// ─── Startup ──────────────────────────────────────────────────────
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
        log(`🌐 Веб-панель: http://0.0.0.0:${PORT}`);
    });

    // Delete webhook and start polling
    try {
        await bot.deleteWebHook();
        log('✅ Webhook видалено');
    } catch (e) {
        log(`⚠️ Webhook: ${e.message}`);
    }
    bot.startPolling();
    log('✅ Polling запущено');

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
    log('✅ Команди зареєстровано');

    log(`📧 Main: ${EMAIL_USER}`);
    log(`💬 Chat: ${TELEGRAM_CHAT_ID}`);

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
        log(`❌ Telegram: ${err.message}`);
        process.exit(1);
    }

    // Start main IMAP
    startIMAPForAccount({
        user: EMAIL_USER,
        password: EMAIL_PASSWORD,
        imapHost: IMAP_HOST,
        imapPort: IMAP_PORT,
    });

    // Start extra accounts
    const extraAccounts = store.getAccounts();
    for (const acc of extraAccounts) {
        startIMAPForAccount(acc);
    }

    log(`🚀 Запущено ${1 + extraAccounts.length} IMAP з'єднань`);

    // ─── Keep-alive: self-ping every 14 min to prevent Render from sleeping ───
    const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutes
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
        setInterval(() => {
            fetch(`${renderUrl}/api/health`)
                .then(res => res.json())
                .then(data => log(`🏓 Keep-alive ping OK (uptime: ${Math.floor(data.uptime / 60)}хв)`))
                .catch(err => log(`⚠️ Keep-alive ping failed: ${err.message}`));
        }, KEEP_ALIVE_INTERVAL);
        log(`🏓 Keep-alive увімкнено (кожні 14 хв → ${renderUrl})`);
    } else {
        log(`⚠️ RENDER_EXTERNAL_URL не встановлено — keep-alive вимкнено`);
    }
}

main();

process.on('SIGINT', () => { log('👋 Вихід'); process.exit(0); });
process.on('uncaughtException', (err) => log(`❌ Exception: ${err.message}`));
process.on('unhandledRejection', (err) => log(`❌ Rejection: ${err.message}`));
