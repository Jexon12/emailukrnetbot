const fs = require('fs');
const path = require('path');
const crypto = require('./crypto');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const MAX_BACKUPS = 3;

const defaults = {
    muted: false,
    muteQueue: [],
    filters: [],
    accounts: [],
    stats: {
        daily: {},
        totalForwarded: 0,
    },
};

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function decryptAccounts(accounts) {
    if (!Array.isArray(accounts)) return [];
    return accounts.map((a) => ({
        ...a,
        password: a.password && String(a.password).startsWith('enc:') ? crypto.decrypt(a.password) : a.password,
    }));
}

function encryptAccounts(accounts) {
    if (!Array.isArray(accounts)) return [];
    const key = crypto.getKey();
    return accounts.map((a) => ({
        ...a,
        password: key && a.password ? crypto.encrypt(String(a.password)) : a.password,
    }));
}

function load() {
    ensureDir(path.dirname(STORE_PATH));
    try {
        if (fs.existsSync(STORE_PATH)) {
            const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
            const data = { ...defaults, ...raw, stats: { ...defaults.stats, ...raw.stats } };
            data.accounts = decryptAccounts(data.accounts || []);
            return data;
        }
    } catch (e) {
        console.error('Store load error:', e.message);
    }
    return { ...defaults };
}

function save(data) {
    ensureDir(path.dirname(STORE_PATH));
    const toWrite = { ...data };
    toWrite.accounts = encryptAccounts(data.accounts || []);

    // Atomic write: temp file + rename
    const tmpPath = STORE_PATH + '.tmp.' + Date.now();
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2), 'utf8');
        fs.renameSync(tmpPath, STORE_PATH);
    } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        console.error('Store save error:', e.message);
        return;
    }

    // Backup
    try {
        ensureDir(BACKUP_DIR);
        const backupName = `store.${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.copyFileSync(STORE_PATH, path.join(BACKUP_DIR, backupName));
        const files = fs.readdirSync(BACKUP_DIR).sort().reverse();
        files.slice(MAX_BACKUPS).forEach((f) => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {} });
    } catch (e) {
        // Non-fatal
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
