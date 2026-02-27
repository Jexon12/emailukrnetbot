const express = require('express');
const store = require('./store');
const { CATEGORIES } = require('./categories');

function createWebPanel(botInfo) {
    const app = express();
    app.use(express.json());

    // ─── Dashboard ─────────────────────────────────────────────
    app.get('/', (req, res) => {
        const data = store.get();
        const today = new Date().toISOString().slice(0, 10);
        const todayStats = data.stats.daily[today] || { count: 0, senders: {}, subjects: [] };

        // Calculate week stats
        let weekCount = 0;
        const now = new Date();
        for (let i = 0; i < 7; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            weekCount += (data.stats.daily[key]?.count || 0);
        }

        // Chart data (last 7 days)
        const chartLabels = [];
        const chartData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            chartLabels.push(key.slice(5)); // MM-DD
            chartData.push(data.stats.daily[key]?.count || 0);
        }

        const topSenders = Object.entries(todayStats.senders)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const html = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📧 Email Bot Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 24px; }
    h1 {
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .card {
      background: linear-gradient(145deg, #1a1a2e, #16213e);
      border: 1px solid #2a2a4a;
      border-radius: 16px;
      padding: 24px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(102, 126, 234, 0.15);
    }
    .card-value {
      font-size: 36px;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .card-label { color: #888; font-size: 13px; margin-top: 4px; }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #ccc;
    }
    .panel {
      background: linear-gradient(145deg, #1a1a2e, #16213e);
      border: 1px solid #2a2a4a;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #2a2a4a;
    }
    .status-row:last-child { border-bottom: none; }
    .status-label { color: #888; }
    .status-value { font-weight: 500; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-green { background: rgba(52,211,153,0.15); color: #34d399; }
    .badge-red { background: rgba(248,113,113,0.15); color: #f87171; }
    .badge-yellow { background: rgba(251,191,36,0.15); color: #fbbf24; }
    .filter-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .filter-tag {
      background: rgba(102,126,234,0.15);
      color: #667eea;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 13px;
    }
    .chart-container {
      height: 200px;
      display: flex;
      align-items: flex-end;
      gap: 12px;
      padding: 16px 0;
    }
    .chart-bar-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .chart-bar {
      width: 100%;
      border-radius: 6px 6px 0 0;
      background: linear-gradient(180deg, #667eea, #764ba2);
      min-height: 4px;
      transition: height 0.5s;
    }
    .chart-label { font-size: 11px; color: #888; }
    .chart-value { font-size: 12px; color: #ccc; font-weight: 600; }
    .account-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #2a2a4a;
    }
    .account-row:last-child { border-bottom: none; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; }
    @media (max-width: 600px) {
      .grid { grid-template-columns: 1fr 1fr; }
      .card-value { font-size: 28px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📧 Email → Telegram Bot</h1>
    <p class="subtitle">Дашборд для моніторингу роботи бота</p>

    <div class="grid">
      <div class="card">
        <div class="card-value">${todayStats.count}</div>
        <div class="card-label">📅 Сьогодні</div>
      </div>
      <div class="card">
        <div class="card-value">${weekCount}</div>
        <div class="card-label">📆 За тиждень</div>
      </div>
      <div class="card">
        <div class="card-value">${data.stats.totalForwarded}</div>
        <div class="card-label">📈 Всього</div>
      </div>
      <div class="card">
        <div class="card-value">${data.accounts.length + 1}</div>
        <div class="card-label">📧 Акаунтів</div>
      </div>
    </div>

    <div class="section-title">📊 Листів за тиждень</div>
    <div class="panel">
      <div class="chart-container">
        ${chartLabels.map((label, i) => {
            const max = Math.max(...chartData, 1);
            const height = Math.max((chartData[i] / max) * 150, 4);
            return `<div class="chart-bar-wrap">
            <div class="chart-value">${chartData[i]}</div>
            <div class="chart-bar" style="height: ${height}px"></div>
            <div class="chart-label">${label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="section-title">⚙️ Стан бота</div>
    <div class="panel">
      <div class="status-row">
        <span class="status-label">Статус</span>
        <span class="badge badge-green">🟢 Працює</span>
      </div>
      <div class="status-row">
        <span class="status-label">Тихий режим</span>
        <span class="badge ${data.muted ? 'badge-yellow' : 'badge-green'}">${data.muted ? '🔕 Увімкнено' : '🔔 Вимкнено'}</span>
      </div>
      <div class="status-row">
        <span class="status-label">Фільтри</span>
        <span class="status-value">${data.filters.length > 0
                ? `<div class="filter-list">${data.filters.map(f => `<span class="filter-tag">${f}</span>`).join('')}</div>`
                : '<span style="color:#888">немає</span>'
            }</span>
      </div>
      <div class="status-row">
        <span class="status-label">В черзі (мute)</span>
        <span class="status-value">${data.muteQueue.length} листів</span>
      </div>
    </div>

    <div class="section-title">📧 Підключені акаунти</div>
    <div class="panel">
      <div class="account-row">
        <span class="dot"></span>
        <span>${botInfo.mainEmail} <span style="color:#888">(основний)</span></span>
      </div>
      ${data.accounts.map(a => `
        <div class="account-row">
          <span class="dot"></span>
          <span>${a.user}</span>
        </div>
      `).join('')}
    </div>

    <p style="text-align:center; color:#555; font-size:12px; margin-top:32px;">
      Оновлено: ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}
      &nbsp;|&nbsp; <a href="/" style="color:#667eea">🔄 Оновити</a>
    </p>
  </div>
</body>
</html>`;

        res.send(html);
    });

    // ─── API endpoints ─────────────────────────────────────────
    app.get('/api/stats', (req, res) => {
        const data = store.get();
        res.json({
            totalForwarded: data.stats.totalForwarded,
            muted: data.muted,
            filters: data.filters,
            accounts: data.accounts.map(a => a.user),
        });
    });

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
    });

    return app;
}

module.exports = { createWebPanel };
