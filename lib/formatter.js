const { categorize } = require('./categories');

const esc = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

function formatEmailMessage(parsed, accountLabel) {
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

    // Auto-category
    const category = categorize(subject, fromEmail, body);

    let attachLine = '';
    if (parsed.attachments && parsed.attachments.length > 0) {
        const attList = parsed.attachments.map(a => {
            const size = a.size > 1024 * 1024
                ? `${(a.size / 1024 / 1024).toFixed(1)} МБ`
                : `${(a.size / 1024).toFixed(1)} КБ`;
            return `  📄 ${esc(a.filename || 'файл')} (${size})`;
        }).join('\n');
        attachLine = `\n📎 <b>Вкладення:</b>\n${attList}`;
    }

    const accountLine = accountLabel ? `\n📪 <b>Акаунт:</b> <code>${esc(accountLabel)}</code>` : '';

    return [
        `${category.emoji} <b>НОВЕ ПИСЬМО</b>  •  <i>${esc(category.name)}</i>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `👤 <b>Від:</b> ${esc(fromName)}`,
        `📧 <b>Email:</b> <code>${esc(fromEmail)}</code>`,
        `📋 <b>Тема:</b> ${esc(subject)}`,
        `📅 <b>Дата:</b> ${esc(date)}`,
        accountLine,
        ``,
        `┄┄┄┄┄ <b>Текст листа</b> ┄┄┄┄┄`,
        ``,
        esc(body) || '<i>порожнє повідомлення</i>',
        attachLine,
    ].filter(Boolean).join('\n');
}

function formatDigest(digest, date) {
    if (digest.count === 0) {
        return `📋 <b>Дайджест за ${date}</b>\n\n📭 Листів не було.`;
    }

    const topSenders = Object.entries(digest.senders)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([email, count], i) => `  ${i + 1}. <code>${esc(email)}</code> — ${count}`)
        .join('\n');

    const subjects = (digest.subjects || [])
        .slice(-10)
        .map(s => `  • ${esc(s)}`)
        .join('\n');

    return [
        `📋 <b>Дайджест за ${date}</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `📬 <b>Листів:</b> ${digest.count}`,
        ``,
        `👥 <b>Топ відправники:</b>`,
        topSenders,
        ``,
        `📄 <b>Останні теми:</b>`,
        subjects || '  —',
    ].join('\n');
}

function formatStats(today, week, month) {
    const topList = week.topSenders.length > 0
        ? week.topSenders.map(([email, count], i) =>
            `  ${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} <code>${esc(email)}</code> — ${count}`
        ).join('\n')
        : '  —';

    return [
        `📊 <b>Статистика</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `📅 <b>Сьогодні:</b> ${today.totalCount} листів`,
        `📆 <b>За тиждень:</b> ${week.totalCount} листів`,
        `🗓 <b>За місяць:</b> ${month.totalCount} листів`,
        `📈 <b>Всього:</b> ${month.totalAll} листів`,
        ``,
        `👥 <b>Топ за тиждень:</b>`,
        topList,
    ].join('\n');
}

module.exports = { formatEmailMessage, formatDigest, formatStats, esc };
