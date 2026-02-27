const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

const defaults = {
    muted: false,
    muteQueue: [],
    filters: [],
    accounts: [],
    stats: {
        daily: {},    // { "2026-02-27": { count: 5, senders: { "a@b.com": 2 } } }
        totalForwarded: 0,
    },
};

function ensureDir() {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function load() {
    ensureDir();
    try {
        if (fs.existsSync(STORE_PATH)) {
            const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
            return { ...defaults, ...data, stats: { ...defaults.stats, ...data.stats } };
        }
    } catch (e) {
        console.error('Store load error:', e.message);
    }
    return { ...defaults };
}

function save(data) {
    ensureDir();
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Store save error:', e.message);
    }
}

function get() {
    return load();
}

function update(fn) {
    const data = load();
    fn(data);
    save(data);
    return data;
}

// ─── Stats helpers ───────────────────────────────────────────────
function recordEmail(sender, subject) {
    update((data) => {
        const today = new Date().toISOString().slice(0, 10);
        if (!data.stats.daily[today]) {
            data.stats.daily[today] = { count: 0, senders: {}, subjects: [] };
        }
        data.stats.daily[today].count++;
        data.stats.daily[today].senders[sender] = (data.stats.daily[today].senders[sender] || 0) + 1;
        data.stats.daily[today].subjects.push(subject);
        data.stats.totalForwarded++;
    });
}

function getStatsForPeriod(days) {
    const data = get();
    const now = new Date();
    let totalCount = 0;
    const senders = {};

    for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const key = date.toISOString().slice(0, 10);
        const day = data.stats.daily[key];
        if (day) {
            totalCount += day.count;
            for (const [s, c] of Object.entries(day.senders)) {
                senders[s] = (senders[s] || 0) + c;
            }
        }
    }

    const topSenders = Object.entries(senders)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    return { totalCount, topSenders, totalAll: data.stats.totalForwarded };
}

function getTodayDigest() {
    const data = get();
    const today = new Date().toISOString().slice(0, 10);
    return data.stats.daily[today] || { count: 0, senders: {}, subjects: [] };
}

// ─── Filters ─────────────────────────────────────────────────────
function addFilter(keyword) {
    const kw = keyword.toLowerCase().trim();
    return update((data) => {
        if (!data.filters.includes(kw)) {
            data.filters.push(kw);
        }
    });
}

function removeFilter(keyword) {
    const kw = keyword.toLowerCase().trim();
    return update((data) => {
        data.filters = data.filters.filter(f => f !== kw);
    });
}

function getFilters() {
    return get().filters;
}

function isFiltered(subject, from) {
    const filters = getFilters();
    if (filters.length === 0) return false;
    const text = `${subject} ${from}`.toLowerCase();
    return filters.some(f => text.includes(f));
}

// ─── Mute ────────────────────────────────────────────────────────
function setMuted(value) {
    update((data) => { data.muted = value; });
}

function isMuted() {
    return get().muted;
}

function addToMuteQueue(emailData) {
    update((data) => {
        data.muteQueue.push(emailData);
        // Keep max 50 queued
        if (data.muteQueue.length > 50) {
            data.muteQueue = data.muteQueue.slice(-50);
        }
    });
}

function flushMuteQueue() {
    const data = get();
    const queue = [...data.muteQueue];
    update((d) => { d.muteQueue = []; });
    return queue;
}

// ─── Extra accounts ──────────────────────────────────────────────
function addAccount(account) {
    update((data) => {
        // Prevent duplicates
        const exists = data.accounts.find(a => a.user === account.user);
        if (!exists) {
            data.accounts.push(account);
        }
    });
}

function removeAccount(email) {
    update((data) => {
        data.accounts = data.accounts.filter(a => a.user !== email);
    });
}

function getAccounts() {
    return get().accounts;
}

module.exports = {
    get, update, recordEmail, getStatsForPeriod, getTodayDigest,
    addFilter, removeFilter, getFilters, isFiltered,
    setMuted, isMuted, addToMuteQueue, flushMuteQueue,
    addAccount, removeAccount, getAccounts,
};
