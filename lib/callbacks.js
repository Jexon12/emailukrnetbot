const store = require('./store');
const logger = require('./logger');
const { esc } = require('./formatter');
const { sendReply } = require('./smtp');
const { addSpamSender } = require('./spam');
const { getAddMailState } = require('./commands');
const { startIMAPForAccount } = require('./imap');

const MAX_PENDING_REPLIES = 100;
const REPLY_TIMEOUT_MS = 5 * 60 * 1000;

const pendingReplies = new Map();
const replyState = new Map();

function prunePendingReplies() {
    if (pendingReplies.size <= MAX_PENDING_REPLIES) return;
    const entries = [...pendingReplies.entries()].sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    entries.slice(0, entries.length - MAX_PENDING_REPLIES).forEach(([k]) => pendingReplies.delete(k));
}

function registerCallbacks(bot, config) {
    const { chatId, EMAIL_USER, EMAIL_PASSWORD } = config;

    function isAllowedChat(chatIdStr) {
        return String(chatIdStr) === String(chatId);
    }

    // ─── Callback queries ────────────────────────────────────────
    bot.on('callback_query', async (query) => {
        if (!isAllowedChat(query.message?.chat?.id)) return;
        const data = query.data;

        // Reply button
        if (data.startsWith('reply_')) {
            const replyInfo = pendingReplies.get(data);
            if (!replyInfo) {
                await bot.answerCallbackQuery(query.id, { text: '⏰ Дані застаріли' });
                return;
            }
            await bot.answerCallbackQuery(query.id);
            const cid = String(query.message.chat.id);

            const timeoutId = setTimeout(() => {
                replyState.delete(cid);
                pendingReplies.delete(data);
                bot.sendMessage(chatId, '⏰ Час вийшов. Натисніть "Відповісти" знову.', { parse_mode: 'HTML' }).catch(() => { });
            }, REPLY_TIMEOUT_MS);

            replyState.set(cid, { cbReply: data, replyInfo, timeoutId });
            await bot.sendMessage(chatId, [
                `✉️ <b>Відповідь на лист:</b>`,
                `📧 <b>Кому:</b> <code>${esc(replyInfo.to)}</code>`,
                `📋 <b>Тема:</b> Re: ${esc(replyInfo.subject)}`,
                ``,
                `Напишіть текст відповіді (або /cancel):`,
            ].join('\n'), { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }

        // Cancel reply
        if (data.startsWith('cancelreply_')) {
            const cbReply = data.replace('cancelreply_', '');
            const cid = String(query.message.chat.id);
            const state = replyState.get(cid);
            if (state && state.cbReply === cbReply) {
                clearTimeout(state.timeoutId);
                replyState.delete(cid);
                pendingReplies.delete(cbReply);
                await bot.answerCallbackQuery(query.id, { text: '❌ Скасовано' });
                await bot.sendMessage(chatId, '❌ Відповідь скасовано.', { parse_mode: 'HTML' });
            }
        }

        // Mark as spam
        if (data.startsWith('markspam_')) {
            const sender = data.split('_')[1];
            addSpamSender(sender);
            await bot.answerCallbackQuery(query.id, { text: '🛡️ Відправника заблоковано' });
            await bot.sendMessage(chatId, `🛡️ <code>${esc(sender)}</code> додано до спам-списку`, { parse_mode: 'HTML' });
            logger.info(`🛡️ Spam sender: ${sender}`);
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
            finishAddMail(bot, query.message.chat.id, host, config);
        }

        // Remove mail confirmation
        if (data === 'removemail_no') {
            await bot.answerCallbackQuery(query.id, { text: 'Скасовано' });
            await bot.editMessageText('❌ Скасовано.', { chat_id: query.message.chat.id, message_id: query.message.message_id });
        }
        if (data.startsWith('removemail_yes_')) {
            const email = Buffer.from(data.replace('removemail_yes_', ''), 'base64').toString('utf8');
            store.removeAccount(email);
            await bot.answerCallbackQuery(query.id, { text: 'Видалено' });
            await bot.editMessageText(`🗑 Акаунт <code>${esc(email)}</code> видалено.`, {
                chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
            });
            logger.info(`🗑 Акаунт видалено: ${email}`);
        }
    });

    // ─── Message handler (reply flow + addmail flow) ─────────────
    bot.on('message', async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        if (!msg.text) return;

        // Reply flow: user typed reply text or /cancel
        const replyStateEntry = replyState.get(String(msg.chat.id));
        if (replyStateEntry) {
            if (msg.text === '/cancel') {
                clearTimeout(replyStateEntry.timeoutId);
                replyState.delete(String(msg.chat.id));
                pendingReplies.delete(replyStateEntry.cbReply);
                await bot.sendMessage(chatId, '❌ Відповідь скасовано.', { parse_mode: 'HTML' });
                return;
            }
            if (msg.text.startsWith('/')) return;
            const { cbReply, replyInfo, timeoutId } = replyStateEntry;
            clearTimeout(timeoutId);
            replyState.delete(String(msg.chat.id));
            pendingReplies.delete(cbReply);
            try {
                await sendReply(replyInfo.account, replyInfo.to, replyInfo.subject, msg.text);
                await bot.sendMessage(chatId, `✅ Відправлено на <code>${esc(replyInfo.to)}</code>`, { parse_mode: 'HTML' });
            } catch (err) {
                await bot.sendMessage(chatId, `❌ SMTP: <code>${esc(err.message)}</code>`, { parse_mode: 'HTML' });
            }
            return;
        }

        if (msg.text.startsWith('/')) return;

        // Add mail flow
        const addMailState = getAddMailState();
        const state = addMailState[msg.chat.id];
        if (!state) return;

        if (state.step === 'email') {
            state.user = msg.text.trim();
            state.step = 'password';
            bot.sendMessage(msg.chat.id, `🔑 Введіть IMAP пароль для <code>${esc(state.user)}</code>:`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        } else if (state.step === 'password') {
            state.password = msg.text.trim();
            state.step = 'host';
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
            finishAddMail(bot, msg.chat.id, msg.text.trim(), config);
        }
    });
}

function finishAddMail(bot, chatIdFrom, host, config) {
    const addMailState = getAddMailState();
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
    if (state.password) state.password = '';

    bot.sendMessage(chatIdFrom, [
        `✅ <b>Акаунт додано!</b>`,
        `📧 ${esc(account.user)}`,
        `🌐 ${esc(host)}`,
        ``,
        `Підключаюсь до IMAP...`,
    ].join('\n'), { parse_mode: 'HTML' });

    logger.info(`📧 Акаунт додано: ${account.user}`);
    if (config.onNewEmail) {
        startIMAPForAccount(account, config, config.onNewEmail);
    }
}

module.exports = { registerCallbacks, pendingReplies, prunePendingReplies };
