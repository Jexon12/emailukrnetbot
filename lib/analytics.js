const store = require('./store');

// ─── Record detailed analytics per email ─────────────────────────
function recordAnalytics(from, subject, category, date) {
    store.update((data) => {
        if (!data.analytics) {
            data.analytics = {
                hourly: new Array(24).fill(0),       // emails per hour
                weekday: new Array(7).fill(0),       // emails per day of week
                categories: {},                       // count per category
                senderHistory: {},                    // { email: [dates] }
                timeline: [],                         // last 100 emails for trend
            };
        }

        const d = date || new Date();
        const hour = d.getHours();
        const day = d.getDay(); // 0=Sun

        data.analytics.hourly[hour]++;
        data.analytics.weekday[day]++;

        // Category count
        const cat = category || 'Інше';
        data.analytics.categories[cat] = (data.analytics.categories[cat] || 0) + 1;

        // Sender history
        if (!data.analytics.senderHistory[from]) {
            data.analytics.senderHistory[from] = [];
        }
        data.analytics.senderHistory[from].push(d.toISOString());
        // Keep last 50 per sender
        if (data.analytics.senderHistory[from].length > 50) {
            data.analytics.senderHistory[from] = data.analytics.senderHistory[from].slice(-50);
        }

        // Timeline
        data.analytics.timeline.push({
            from, subject, category: cat,
            date: d.toISOString(),
            hour, day,
        });
        if (data.analytics.timeline.length > 200) {
            data.analytics.timeline = data.analytics.timeline.slice(-200);
        }
    });
}

// ─── Get analytics data ──────────────────────────────────────────
function getAnalytics() {
    const data = store.get();
    return data.analytics || {
        hourly: new Array(24).fill(0),
        weekday: new Array(7).fill(0),
        categories: {},
        senderHistory: {},
        timeline: [],
    };
}

// ─── Peak hours ──────────────────────────────────────────────────
function getPeakHours() {
    const a = getAnalytics();
    const indexed = a.hourly.map((count, hour) => ({ hour, count }));
    return indexed.sort((a, b) => b.count - a.count).slice(0, 3);
}

// ─── Peak days ───────────────────────────────────────────────────
function getPeakDays() {
    const a = getAnalytics();
    const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return a.weekday.map((count, i) => ({ day: dayNames[i], count }))
        .sort((a, b) => b.count - a.count);
}

// ─── Top senders (all time) ──────────────────────────────────────
function getTopSenders(limit = 5) {
    const a = getAnalytics();
    return Object.entries(a.senderHistory)
        .map(([email, dates]) => ({ email, count: dates.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

// ─── Category breakdown ──────────────────────────────────────────
function getCategoryBreakdown() {
    const a = getAnalytics();
    const total = Object.values(a.categories).reduce((s, c) => s + c, 0) || 1;
    return Object.entries(a.categories)
        .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }))
        .sort((a, b) => b.count - a.count);
}

// ─── Recent trend (emails per day, last 14 days) ─────────────────
function getDailyTrend(days = 14) {
    const a = getAnalytics();
    const result = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const count = a.timeline.filter(t => t.date.startsWith(key)).length;
        result.push({ date: key.slice(5), count }); // MM-DD
    }

    return result;
}

module.exports = {
    recordAnalytics, getAnalytics,
    getPeakHours, getPeakDays, getTopSenders,
    getCategoryBreakdown, getDailyTrend,
};
