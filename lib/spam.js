const store = require('./store');

// ─── Spam patterns ───────────────────────────────────────────────
const SPAM_PATTERNS = [
    // Excessive urgency
    { pattern: /терміново|urgent|срочно|act now|негайно/i, weight: 2, reason: 'Терміновість' },
    // Money/lottery scams
    { pattern: /виграли|congratulations.*won|lottery|лотере|мільйон|million|prize|приз.*отрим/i, weight: 5, reason: 'Лотерея/приз' },
    // Suspicious links
    { pattern: /(https?:\/\/[^\s]+){5,}/i, weight: 3, reason: 'Багато посилань' },
    // Nigerian prince style
    { pattern: /спадщина|inheritance|beneficiary|бенефіціар|transfer.*funds|переказ.*кошт/i, weight: 5, reason: 'Шахрайство' },
    // Pharma spam
    { pattern: /viagra|cialis|pharmacy|фармац|таблетк|pills|medication/i, weight: 5, reason: 'Фарма-спам' },
    // Crypto scam
    { pattern: /bitcoin.*invest|crypto.*profit|заробіт.*крипт|blockchain.*opportunit/i, weight: 4, reason: 'Крипто-скам' },
    // Unsubscribe bait
    { pattern: /click here to unsubscribe|натисніть.*відписатися.*http/i, weight: 1, reason: 'Розсилка' },
    // ALL CAPS subject
    { pattern: /^[A-ZА-ЯІЇЄҐ\s!?]{20,}$/m, weight: 2, reason: 'ВЕЛИКІ ЛІТЕРИ' },
    // Suspicious sender patterns
    { pattern: /noreply.*@(?!google|apple|facebook|microsoft|amazon|github)/i, weight: 1, reason: 'No-reply' },
    // Weight loss
    { pattern: /weight loss|схуднен|похудe|diet pill/i, weight: 3, reason: 'Сумнівна реклама' },
    // Get rich quick
    { pattern: /earn.*\$.*day|заробляй.*день|work from home.*\$/i, weight: 4, reason: 'Швидкий заробіток' },
    // Suspicious attachments
    { pattern: /\.exe|\.bat|\.cmd|\.scr|\.pif|\.vbs/i, weight: 5, reason: 'Підозріле вкладення' },
];

// ─── Spam score calculation ──────────────────────────────────────
function calculateSpamScore(subject, from, body, attachments) {
    const text = `${subject}\n${from}\n${body || ''}`;
    let score = 0;
    const reasons = [];

    // Check built-in patterns
    for (const { pattern, weight, reason } of SPAM_PATTERNS) {
        if (pattern.test(text)) {
            score += weight;
            reasons.push(reason);
        }
    }

    // Check suspicious attachments
    if (attachments && attachments.length > 0) {
        for (const att of attachments) {
            if (/\.(exe|bat|cmd|scr|pif|vbs|js|jar)$/i.test(att.filename || '')) {
                score += 5;
                reasons.push(`Підозрілий файл: ${att.filename}`);
            }
        }
    }

    // Check user-defined spam words
    const spamWords = getSpamWords();
    const textLower = text.toLowerCase();
    for (const word of spamWords) {
        if (textLower.includes(word.toLowerCase())) {
            score += 3;
            reasons.push(`Спам-слово: ${word}`);
        }
    }

    // Check spam senders
    const spamSenders = getSpamSenders();
    const fromLower = from.toLowerCase();
    for (const sender of spamSenders) {
        if (fromLower.includes(sender.toLowerCase())) {
            score += 10;
            reasons.push('Заблокований відправник');
        }
    }

    return { score, reasons, isSpam: score >= 5 };
}

// ─── Spam storage ────────────────────────────────────────────────
function getSpamWords() {
    const data = store.get();
    return data.spamWords || [];
}

function addSpamWord(word) {
    store.update((data) => {
        if (!data.spamWords) data.spamWords = [];
        const w = word.toLowerCase().trim();
        if (!data.spamWords.includes(w)) {
            data.spamWords.push(w);
        }
    });
}

function removeSpamWord(word) {
    store.update((data) => {
        if (!data.spamWords) return;
        data.spamWords = data.spamWords.filter(w => w !== word.toLowerCase().trim());
    });
}

function getSpamSenders() {
    const data = store.get();
    return data.spamSenders || [];
}

function addSpamSender(sender) {
    store.update((data) => {
        if (!data.spamSenders) data.spamSenders = [];
        const s = sender.toLowerCase().trim();
        if (!data.spamSenders.includes(s)) {
            data.spamSenders.push(s);
        }
    });
}

function removeSpamSender(sender) {
    store.update((data) => {
        if (!data.spamSenders) return;
        data.spamSenders = data.spamSenders.filter(s => s !== sender.toLowerCase().trim());
    });
}

// Record spam stats
function recordSpam(from, subject) {
    store.update((data) => {
        if (!data.spamStats) data.spamStats = { total: 0, recent: [] };
        data.spamStats.total++;
        data.spamStats.recent.unshift({ from, subject, date: new Date().toISOString() });
        if (data.spamStats.recent.length > 20) {
            data.spamStats.recent = data.spamStats.recent.slice(0, 20);
        }
    });
}

function getSpamStats() {
    const data = store.get();
    return data.spamStats || { total: 0, recent: [] };
}

module.exports = {
    calculateSpamScore, recordSpam, getSpamStats,
    addSpamWord, removeSpamWord, getSpamWords,
    addSpamSender, removeSpamSender, getSpamSenders,
};
