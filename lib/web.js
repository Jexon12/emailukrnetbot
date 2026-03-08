const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { getPeakHours, getPeakDays, getTopSenders, getCategoryBreakdown, getDailyTrend, getAnalytics } = require('./analytics');
const { getSpamStats, getSpamWords, getSpamSenders } = require('./spam');
const { middleware: rateLimit } = require('./rateLimit');

const API_KEY = process.env.API_KEY;
const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

function apiAuth(req, res, next) {
    if (!API_KEY) return next();
    const authHeader = req.headers['authorization'];
    const key = (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null)
        || req.headers['x-api-key']
        || req.query.api_key;
    if (key === API_KEY) return next();
    return res.status(401).json({ error: 'Unauthorized' });
}

if (!API_KEY) {
    // Log warning once at module load time
    const logger = require('./logger');
    logger.warn('⚠️  API_KEY не встановлено — /api/* ендпоінти загальнодоступні без автентифікації');
}


function createWebPanel(botInfo) {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use(rateLimit(100));

    app.get('/miniapp', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'miniapp.html'));
    });

    app.get('/', (req, res) => {
        const data = store.get();
        const today = new Date().toISOString().slice(0, 10);
        const todayStats = data.stats.daily[today] || { count: 0 };
        const spamStats = getSpamStats();

        let weekCount = 0;
        const now = new Date();
        for (let i = 0; i < 7; i++) {
            const d = new Date(now); d.setDate(d.getDate() - i);
            weekCount += (data.stats.daily[d.toISOString().slice(0, 10)]?.count || 0);
        }

        const chartLabels = [], chartData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now); d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            chartLabels.push(key.slice(5));
            chartData.push(data.stats.daily[key]?.count || 0);
        }

        res.send(`<!DOCTYPE html>
<html lang="uk"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>📧 Email Bot Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#faf7f2;color:#1a1a1a;min-height:100vh}
.container{max-width:900px;margin:0 auto;padding:24px}
h1{font-size:28px;font-weight:800;background:linear-gradient(135deg,#f97316,#ea580c);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
.subtitle{color:#8a8178;font-size:14px;margin-bottom:32px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:32px}
.card{background:#fff;border:1px solid #f0e6d8;border-radius:16px;padding:24px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,0.04);transition:transform .2s,box-shadow .2s}
.card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(249,115,22,.12)}
.card-value{font-size:36px;font-weight:800;background:linear-gradient(135deg,#f97316,#ea580c);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.card-label{color:#8a8178;font-size:13px;margin-top:4px}
.section-title{font-size:18px;font-weight:600;margin-bottom:16px;color:#444}
.panel{background:#fff;border:1px solid #f0e6d8;border-radius:16px;padding:24px;margin-bottom:24px;box-shadow:0 1px 6px rgba(0,0,0,0.04)}
.chart-container{height:200px;display:flex;align-items:flex-end;gap:12px;padding:16px 0}
.chart-bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px}
.chart-bar{width:100%;border-radius:6px 6px 0 0;background:linear-gradient(180deg,#f97316,#ea580c);min-height:4px;transition:height .5s}
.chart-label{font-size:11px;color:#8a8178}
.chart-value{font-size:12px;color:#555;font-weight:600}
.status-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f0e6d8}
.status-row:last-child{border-bottom:none}
.status-label{color:#8a8178}
.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}
.badge-green{background:rgba(34,197,94,.1);color:#16a34a}
.badge-red{background:rgba(239,68,68,.1);color:#ef4444}
.badge-yellow{background:rgba(234,179,8,.1);color:#ca8a04}
.filter-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.filter-tag{background:rgba(249,115,22,.1);color:#ea580c;padding:4px 12px;border-radius:12px;font-size:13px}
.miniapp-link{display:inline-block;margin-top:16px;padding:12px 24px;background:linear-gradient(135deg,#f97316,#ea580c);color:white;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;transition:transform .2s;box-shadow:0 4px 12px rgba(249,115,22,.25)}
.miniapp-link:hover{transform:scale(1.05)}
a{color:#f97316}
@media(max-width:600px){.grid{grid-template-columns:1fr 1fr}.card-value{font-size:28px}}
</style></head><body><div class="container">
<h1>📧 Email → Telegram Bot</h1>
<p class="subtitle">Дашборд моніторингу бота</p>
<div class="grid">
<div class="card"><div class="card-value">${todayStats.count}</div><div class="card-label">📅 Сьогодні</div></div>
<div class="card"><div class="card-value">${weekCount}</div><div class="card-label">📆 Тиждень</div></div>
<div class="card"><div class="card-value">${data.stats.totalForwarded}</div><div class="card-label">📈 Всього</div></div>
<div class="card"><div class="card-value">${spamStats.total}</div><div class="card-label">🛡️ Спам</div></div>
<div class="card"><div class="card-value">${data.accounts.length + 1}</div><div class="card-label">📧 Акаунтів</div></div>
</div>
<div class="section-title">📊 Листів за тиждень</div>
<div class="panel"><div class="chart-container">
${chartLabels.map((l, i) => { const max = Math.max(...chartData, 1); const h = Math.max((chartData[i] / max) * 150, 4); return `<div class="chart-bar-wrap"><div class="chart-value">${chartData[i]}</div><div class="chart-bar" style="height:${h}px"></div><div class="chart-label">${l}</div></div>` }).join('')}
</div></div>
<div class="section-title">⚙️ Стан</div>
<div class="panel">
<div class="status-row"><span class="status-label">Статус</span><span class="badge badge-green">🟢 Працює</span></div>
<div class="status-row"><span class="status-label">Тихий режим</span><span class="badge ${data.muted ? 'badge-yellow' : 'badge-green'}">${data.muted ? '🔕 Увімкнено' : '🔔 Вимкнено'}</span></div>
<div class="status-row"><span class="status-label">Фільтри</span><span>${data.filters.length > 0 ? `<div class="filter-list">${data.filters.map(f => `<span class="filter-tag">${f}</span>`).join('')}</div>` : '<span style="color:#8a8178">немає</span>'}</span></div>
</div>
<p style="text-align:center"><a href="/miniapp" class="miniapp-link">📱 Відкрити Mini App</a></p>
<p style="text-align:center;color:#aaa;font-size:12px;margin-top:16px">
${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })} | <a href="/" style="color:#f97316">🔄</a> | <a href="/api/export?format=json" style="color:#f97316">📥 JSON</a> | <a href="/api/export?format=csv" style="color:#f97316">📥 CSV</a></p>
</div></body></html>`);
    });

    app.get('/api/stats', apiAuth, (req, res) => {
        const data = store.get();
        const today = new Date().toISOString().slice(0, 10);
        const todayStats = data.stats.daily[today] || { count: 0 };
        let weekCount = 0;
        const now = new Date();
        for (let i = 0; i < 7; i++) {
            const d = new Date(now); d.setDate(d.getDate() - i);
            weekCount += (data.stats.daily[d.toISOString().slice(0, 10)]?.count || 0);
        }
        res.json({
            email: botInfo.mainEmail,
            today: todayStats.count,
            week: weekCount,
            total: data.stats.totalForwarded,
            accounts: data.accounts.length + 1,
            muted: data.muted,
            filters: data.filters,
        });
    });

    app.get('/api/analytics', apiAuth, (req, res) => {
        const analytics = getAnalytics();
        res.json({
            hourly: analytics.hourly,
            weekday: analytics.weekday,
            categories: getCategoryBreakdown(),
            topSenders: getTopSenders(10),
            peakHours: getPeakHours(),
            peakDays: getPeakDays(),
            trend: getDailyTrend(14),
        });
    });

    app.get('/api/spam', apiAuth, (req, res) => {
        const stats = getSpamStats();
        res.json({
            totalBlocked: stats.total,
            recent: stats.recent,
            words: getSpamWords(),
            senders: getSpamSenders(),
        });
    });

    app.get('/api/export', apiAuth, (req, res) => {
        const format = (req.query.format || 'json').toLowerCase();
        const data = store.get();
        const analytics = getAnalytics();
        const spamStats = getSpamStats();

        const payload = {
            exported: new Date().toISOString(),
            stats: {
                totalForwarded: data.stats.totalForwarded,
                daily: data.stats.daily,
                filters: data.filters,
                muted: data.muted,
            },
            analytics: {
                hourly: analytics.hourly,
                weekday: analytics.weekday,
                categories: analytics.categories,
                topSenders: getTopSenders(20),
            },
            spam: {
                total: spamStats.total,
                words: getSpamWords(),
                senders: getSpamSenders(),
            },
        };

        if (format === 'csv') {
            const rows = [
                ['Дата', 'Кількість', 'Відправники'].join(','),
                ...Object.entries(data.stats.daily || {}).map(([d, v]) =>
                    [d, v.count, Object.keys(v.senders || {}).join(';')].join(',')
                ),
            ];
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="email-stats.csv"');
            return res.send('\uFEFF' + rows.join('\n'));
        }

        res.json(payload);
    });

    app.get('/api/health', (req, res) => {
        let diskFree = null;
        try {
            if (fs.existsSync(STORE_PATH)) {
                const stat = fs.statSync(STORE_PATH);
                const dir = path.dirname(STORE_PATH);
                const free = require('os').freemem();
                diskFree = Math.round(free / 1024 / 1024);
            }
        } catch (_) { }

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            diskFreeMB: diskFree,
            memory: process.memoryUsage(),
        });
    });

    return app;
}

module.exports = { createWebPanel };
