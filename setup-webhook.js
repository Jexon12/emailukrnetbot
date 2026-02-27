// Run this ONCE after deploying to Vercel to register the Telegram webhook
// Usage: node setup-webhook.js <your-vercel-url>
// Example: node setup-webhook.js https://email-telegram-bot.vercel.app

require('dotenv').config();

const VERCEL_URL = process.argv[2];

if (!VERCEL_URL) {
    console.error('❌ Вкажіть URL вашого Vercel додатку:');
    console.error('   node setup-webhook.js https://your-app.vercel.app');
    process.exit(1);
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN не знайдено в .env');
    process.exit(1);
}

const webhookUrl = `${VERCEL_URL}/api/webhook`;

async function setup() {
    console.log(`🔗 Встановлюю webhook: ${webhookUrl}`);

    const response = await fetch(
        `https://api.telegram.org/bot${TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    const data = await response.json();

    if (data.ok) {
        console.log('✅ Webhook встановлено!');
        console.log(`   URL: ${webhookUrl}`);
    } else {
        console.error('❌ Помилка:', data.description);
    }

    // Get webhook info
    const infoRes = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
    const info = await infoRes.json();
    console.log('\n📋 Webhook Info:', JSON.stringify(info.result, null, 2));
}

setup().catch(console.error);
