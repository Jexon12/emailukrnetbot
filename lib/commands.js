const store = require('./store');
const logger = require('./logger');
const { formatEmailMessage, formatDigest, formatStats, esc } = require('./formatter');
const { check: rateLimitCheck } = require('./rateLimit');
const { getSpamStats, addSpamWord, removeSpamWord, getSpamWords, addSpamSender, removeSpamSender, getSpamSenders } = require('./spam');
const { getPeakHours, getPeakDays, getTopSenders, getCategoryBreakdown } = require('./analytics');
const { searchEmails } = require('./imap');

// ─── Helpers ─────────────────────────────────────────────────────
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

// ─── Add mail state ──────────────────────────────────────────────
const addMailState = {};

function getAddMailState() {
    return addMailState;
}

// ─── Register all commands ───────────────────────────────────────
function registerCommands(bot, config) {
    const { EMAIL_USER, chatId, startedAt, PORT } = config;

    function isAllowedChat(chatIdStr) {
        return String(chatIdStr) === String(chatId);
    }

    // /start
    bot.onText(/\/start/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
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

    // /help
    bot.onText(/\/help/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
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

    // /status
    bot.onText(/\/status/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
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

    // /stats
    bot.onText(/\/stats/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        const today = store.getStatsForPeriod(1);
        const week = store.getStatsForPeriod(7);
        const month = store.getStatsForPeriod(30);
        bot.sendMessage(msg.chat.id, formatStats(today, week, month), { parse_mode: 'HTML' });
    });

    // /digest
    bot.onText(/\/digest/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        const today = new Date().toISOString().slice(0, 10);
        const digest = store.getTodayDigest();
        bot.sendMessage(msg.chat.id, formatDigest(digest, today), { parse_mode: 'HTML' });
    });

    // /analytics
    bot.onText(/\/analytics/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
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

    // /spam
    bot.onText(/\/spam(.*)/, (msg, match) => {
        if (!isAllowedChat(msg.chat.id)) return;
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

    // /miniapp
    bot.onText(/\/miniapp/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
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

    // /mute
    bot.onText(/\/mute/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        if (msg.text === '/mute') {
            store.setMuted(true);
            bot.sendMessage(msg.chat.id, `🔕 <b>Тихий режим увімкнено.</b>\nЛисти будуть зберігатися в черзі.\nВведіть /unmute щоб отримати їх.`, { parse_mode: 'HTML' });
            logger.info('🔕 Mute ON');
        }
    });

    // /unmute
    bot.onText(/\/unmute/, async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
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
        logger.info('🔔 Mute OFF');
    });

    // /filter
    bot.onText(/\/filter(.*)/, (msg, match) => {
        if (!isAllowedChat(msg.chat.id)) return;
        const args = (match[1] || '').trim().split(' ');
        const action = args[0];
        const keyword = args.slice(1).join(' ');

        if (action === 'add' && keyword) {
            store.addFilter(keyword);
            bot.sendMessage(msg.chat.id, `✅ Фільтр додано: <b>${esc(keyword)}</b>\nЛисти з цим словом будуть ігноруватися.`, { parse_mode: 'HTML' });
            logger.info(`⚡ Filter +: ${keyword}`);
        } else if (action === 'remove' && keyword) {
            store.removeFilter(keyword);
            bot.sendMessage(msg.chat.id, `🗑 Фільтр видалено: <b>${esc(keyword)}</b>`, { parse_mode: 'HTML' });
            logger.info(`⚡ Filter -: ${keyword}`);
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

    // /search
    bot.onText(/\/search (.+)/, async (msg, match) => {
        if (!isAllowedChat(msg.chat.id)) return;
        if (!rateLimitCheck(`tg:${msg.chat.id}`, 20)) return;
        const query = match[1].trim();

        await bot.sendMessage(msg.chat.id, `🔍 Шукаю "<b>${esc(query)}</b>"...`, { parse_mode: 'HTML' });

        try {
            const results = await searchEmails(query, 20, config);
            if (results.length === 0) {
                bot.sendMessage(msg.chat.id, `🔍 Нічого не знайдено за "<b>${esc(query)}</b>"`, { parse_mode: 'HTML' });
            } else {
                const list = results.map((r, i) => {
                    const accLine = r.account && r.account !== EMAIL_USER ? ` | 📪 ${esc(r.account)}` : '';
                    return `${i + 1}. <b>${esc(r.subject)}</b>\n   📧 ${esc(r.from)} | 📅 ${esc(r.date)}${accLine}`;
                }).join('\n\n');
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

    // /accounts
    bot.onText(/\/accounts/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
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

    // /addmail
    bot.onText(/\/addmail/, (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        addMailState[msg.chat.id] = { step: 'email' };
        bot.sendMessage(msg.chat.id, [
            `📧 <b>Додавання нового акаунту</b>`,
            ``,
            `Введіть email адресу:`,
        ].join('\n'), { parse_mode: 'HTML', reply_markup: { force_reply: true } });
    });

    // /removemail
    bot.onText(/\/removemail (.+)/, (msg, match) => {
        if (!isAllowedChat(msg.chat.id)) return;
        if (!rateLimitCheck(`tg:${msg.chat.id}`, 30)) return;
        const email = match[1].trim();
        const accounts = store.getAccounts();
        if (!accounts.some(a => a.user === email)) {
            bot.sendMessage(msg.chat.id, `❌ Акаунт <code>${esc(email)}</code> не знайдено.`, { parse_mode: 'HTML' });
            return;
        }
        bot.sendMessage(msg.chat.id, `🗑 Видалити акаунт <code>${esc(email)}</code>?`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Так', callback_data: `removemail_yes_${Buffer.from(email).toString('base64')}` }],
                    [{ text: '❌ Ні', callback_data: 'removemail_no' }],
                ],
            },
        });
    });
}

module.exports = { registerCommands, getAddMailState, formatUptime };
