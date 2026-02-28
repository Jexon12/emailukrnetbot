const { categorize } = require('./categories');

const esc = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

// ─── URL Cleaning ────────────────────────────────────────────────
function isTrackingUrl(url) {
    if (!url) return false;
    return /[?&](utm_|xnpe_|mc_|oly_|sc_|fbclid|gclid|msclkid|_ga|vero_|hs_|mkt_tok)/i.test(url);
}

function cleanUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        const keepParams = [];
        for (const [key, val] of u.searchParams) {
            if (!/^(utm_|xnpe_|mc_|oly_|sc_|fbclid|gclid|msclkid|_ga|vero_|hs_|mkt_tok)/i.test(key)) {
                keepParams.push([key, val]);
            }
        }
        u.search = '';
        keepParams.forEach(([k, v]) => u.searchParams.set(k, v));
        return u.toString();
    } catch {
        return url;
    }
}

// ─── HTML → Telegram HTML ────────────────────────────────────────
function htmlToTelegramHtml(html) {
    if (!html) return '';

    let result = html
        // Remove style, script, head
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')

        // Images → emoji with alt text
        .replace(/<img[^>]*alt=["']([^"']{2,})["'][^>]*>/gi, '🖼 <i>$1</i> ')
        .replace(/<img[^>]*>/gi, '')

        // Headings → bold with nice formatting
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n<b>$1</b>\n')
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n<b>$1</b>\n')
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n<b>$1</b>\n')
        .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n<b>$1</b>\n')

        // Bold
        .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '<b>$2</b>')

        // Italic
        .replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '<i>$2</i>')

        // Underline
        .replace(/<(u|ins)[^>]*>([\s\S]*?)<\/\1>/gi, '<u>$2</u>')

    // Handle links — convert to clean clickable links
    result = result.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, url, text) => {
        const cleanText = text.replace(/<[^>]+>/g, '').trim();
        if (!cleanText || /^\s*$/.test(cleanText)) return '';
        // Skip if link text is just a long URL itself
        if (/^https?:\/\//i.test(cleanText) && cleanText.length > 50) return '';

        const cleaned = cleanUrl(url);
        if (!cleaned || cleaned === '#' || cleaned.startsWith('mailto:')) {
            return cleanText;
        }

        // Make meaningful text into a clickable link
        if (cleanText.length > 1 && cleanText.length < 80) {
            return `🔗 <a href="${cleaned}">${cleanText}</a>`;
        }
        return cleanText;
    });

    result = result
        // Line breaks
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/td>/gi, '  ')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/table>/gi, '\n')

        // Lists
        .replace(/<li[^>]*>/gi, '\n   • ')
        .replace(/<\/li>/gi, '')
        .replace(/<\/?[ou]l[^>]*>/gi, '\n')

        // Blockquote in the email → Telegram blockquote
        .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
            const text = c.replace(/<[^>]+>/g, '').trim();
            return `\n<blockquote>${text}</blockquote>\n`;
        })

        // Horizontal rule
        .replace(/<hr[^>]*\/?>/gi, '\n───────────\n')

        // Protect Telegram-compatible tags before stripping all HTML
        .replace(/<(\/?(b|i|u|s|a|code|pre|blockquote|tg-spoiler)(?:\s[^>]*)?)>/gi, '§T§$1§/T§')
        // Remove all other HTML tags
        .replace(/<[^>]+>/g, '')
        // Restore Telegram tags
        .replace(/§T§(.*?)§\/T§/g, '<$1>')

        // Decode entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
        .replace(/&[a-z]+;/gi, ' ')

        // Clean whitespace
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^[ \t]+|[ \t]+$/gm, '')
        .trim();

    // Remove standalone long tracking URLs
    result = result
        .replace(/^\s*https?:\/\/[^\s]{80,}\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return result;
}

// ─── Fallback: plain text cleanup ────────────────────────────────
function cleanPlainText(text) {
    if (!text) return '';
    return text
        .replace(/^\s*\[?\s*https?:\/\/[^\s\]]{80,}\s*\]?\s*$/gm, '')
        .replace(/\[?\s*https?:\/\/[^\s\]]*[?&](utm_|xnpe_|campaign=|source=email)[^\s\]]*\s*\]?/gi, '')
        .replace(/https?:\/\/([^\/\s?#]+)[^\s]{60,}/g, (m, d) => `[${d}]`)
        .replace(/\[\s*\]/g, '')
        .replace(/^\s*\d{1,3}\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^[ \t]+|[ \t]+$/gm, '')
        .trim();
}

// ─── Format Email ────────────────────────────────────────────────
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

    // Build body
    let body = '';
    if (parsed.html) {
        body = htmlToTelegramHtml(parsed.html);
    } else if (parsed.text) {
        body = esc(cleanPlainText(parsed.text));
    }

    // Auto-category
    const plainBody = body.replace(/<[^>]+>/g, '');
    const category = categorize(subject, fromEmail, plainBody);

    // Attachments
    let attachLine = '';
    if (parsed.attachments && parsed.attachments.length > 0) {
        const attList = parsed.attachments.map(a => {
            const size = a.size > 1024 * 1024
                ? `${(a.size / 1024 / 1024).toFixed(1)} МБ`
                : `${(a.size / 1024).toFixed(1)} КБ`;
            return `   📄 ${esc(a.filename || 'файл')}  <i>${size}</i>`;
        }).join('\n');
        attachLine = `\n\n📎 <b>Вкладення:</b>\n${attList}`;
    }

    const accountLine = accountLabel
        ? `📪 <code>${esc(accountLabel)}</code>`
        : '';

    // ── Build the beautiful message ──

    // Wrap body in expandable blockquote if long, regular blockquote if shorter
    let bodyBlock = '';
    if (body.length > 800) {
        // Use expandable blockquote for long emails
        const trimmed = body.length > 2500
            ? body.substring(0, 2500) + '\n\n✂️ ...обрізано'
            : body;
        bodyBlock = `<blockquote expandable>${trimmed}</blockquote>`;
    } else if (body.length > 0) {
        bodyBlock = `<blockquote>${body}</blockquote>`;
    } else {
        bodyBlock = '<i>порожнє повідомлення</i>';
    }

    const header = [
        `${category.emoji} <b>${esc(subject)}</b>`,
        ``,
        `👤 ${esc(fromName)}  ·  <code>${esc(fromEmail)}</code>`,
        accountLine ? `${accountLine}  ·  ` : '',
        `🗓 ${esc(date)}`,
    ].filter(Boolean).join('\n');

    return [
        header,
        ``,
        bodyBlock,
        attachLine,
    ].filter(Boolean).join('\n');
}

// ─── Digest ──────────────────────────────────────────────────────
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

// ─── Stats ───────────────────────────────────────────────────────
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
