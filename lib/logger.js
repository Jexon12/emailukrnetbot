const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level) {
    return (LEVELS[level] || 1) >= (LEVELS[LOG_LEVEL] || 1);
}

function log(level, msg, meta = {}) {
    if (!shouldLog(level)) return;
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    const line = `[${time}] [${level.toUpperCase()}] ${msg}${metaStr}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

module.exports = {
    debug: (m, o) => log('debug', m, o),
    info: (m, o) => log('info', m, o),
    warn: (m, o) => log('warn', m, o),
    error: (m, o) => log('error', m, o),
};
