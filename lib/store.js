const fs = require('fs');
const path = require('path');
const crypto = require('./crypto');
const logger = require('./logger');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const MAX_BACKUPS = 3;
const SAVE_DEBOUNCE_MS = 500;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // max once per hour

const defaults = {
    muted: false,
    muteQueue: [],
    filters: [],
    accounts: [],
    uids: {}, // { "email@addr:folder": lastUid }
    stats: {
        daily: {},
        totalForwarded: 0,
    },
};

function getDefaults() {
    return JSON.parse(JSON.stringify(defaults));
}

// ─── In-memory cache ─────────────────────────────────────────────
let _cache = null;
let _saveTimer = null;
let _lastBackupAt = 0;

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

function loadFromDisk() {
    ensureDir(path.dirname(STORE_PATH));
    try {
        if (fs.existsSync(STORE_PATH)) {
            const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
            const def = getDefaults();
            const data = { ...def, ...raw, stats: { ...def.stats, ...raw.stats } };
            data.accounts = decryptAccounts(data.accounts || []);
            return data;
        }
    } catch (e) {
        logger.error('Store load error: ' + e.message);
    }
    return getDefaults();
}

function saveToDisk() {
    if (!_cache) return;
    ensureDir(path.dirname(STORE_PATH));
    const toWrite = { ..._cache };

    // Ensure uids exists in the written object
    if (!toWrite.uids) toWrite.uids = {};

    toWrite.accounts = encryptAccounts(_cache.accounts || []);

    logger.debug(`💾 Збереження бази (${Object.keys(toWrite.uids).length} UIDs)...`);

    // Atomic write: temp file + rename
    const tmpPath = STORE_PATH + '.tmp.' + Date.now();
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2), 'utf8');
        fs.renameSync(tmpPath, STORE_PATH);
    } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch (_) { }
        logger.error('Store save error: ' + e.message);
        return;
    }

    // Backup (throttled: not more than once per hour)
    const now = Date.now();
    if (now - _lastBackupAt >= BACKUP_INTERVAL_MS) {
        try {
            ensureDir(BACKUP_DIR);
            const backupName = `store.${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            fs.copyFileSync(STORE_PATH, path.join(BACKUP_DIR, backupName));
            const files = fs.readdirSync(BACKUP_DIR).sort().reverse();
            files.slice(MAX_BACKUPS).forEach((f) => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) { } });
            _lastBackupAt = now;
        } catch (e) {
            // Non-fatal
        }
    }
}

function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        saveToDisk();
    }, SAVE_DEBOUNCE_MS);
}

function saveNow() {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
    }
    saveToDisk();
}

function ensureCache() {
    if (!_cache) {
        _cache = loadFromDisk();
    }
}

function get() {
    ensureCache();
    // Return a deep clone so callers don't accidentally mutate the cache
    return JSON.parse(JSON.stringify(_cache));
}

function update(fn) {
    ensureCache();
    fn(_cache);
    scheduleSave();
    return JSON.parse(JSON.stringify(_cache));
}

// Force immediate save (for graceful shutdown)
function flush() {
    saveNow();
}

// Reset cache (for testing)
function invalidateCache() {
    _cache = null;
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
    }
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

// ─── UID persistence ─────────────────────────────────────────────
function getLastUid(account, folder) {
    const key = `${account}:${folder}`;
    return get().uids[key] || null;
}

function setLastUid(account, folder, uid) {
    update((data) => {
        const key = `${account}:${folder}`;
        data.uids[key] = uid;
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
    getLastUid, setLastUid,
    flush, invalidateCache,
};
