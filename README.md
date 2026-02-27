# 📧 → 💬 Email to Telegram Bot

Telegram-бот, який пересилає листи з **UKR.NET** у ваш Telegram-чат.

## 🚀 Два режими роботи

### Локальний (`npm start`)
Постійне IMAP-підключення з IDLE — миттєве отримання листів.

### Vercel (serverless)
Cron кожні 2 хв → перевіряє UNSEEN листи → відправляє в Telegram.

---

## 📦 Встановлення

```bash
npm install
```

## 🔧 Налаштування `.env`

```env
EMAIL_USER=your@ukr.net
EMAIL_PASSWORD=your_imap_password
IMAP_HOST=imap.ukr.net
IMAP_PORT=993
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## ▶️ Локальний запуск

```bash
npm start
```

## ☁️ Деплой на Vercel

1. **Встановіть Vercel CLI**: `npm i -g vercel`
2. **Деплой**: `vercel --prod`
3. **Environment Variables**: додайте всі змінні з `.env` у Vercel Dashboard → Settings → Environment Variables
4. **Webhook**: `node setup-webhook.js https://your-app.vercel.app`

## 🤖 Команди бота

| Команда | Опис |
|---------|------|
| `/start` | Привітання та список команд |
| `/status` | Статус пошти (всього/непрочитаних) |
| `/last` | Показати останній лист |
| `/help` | Довідка |

## 📁 Структура

```
email-telegram-bot/
├── api/
│   ├── check-email.js   # Cron: перевірка пошти
│   └── webhook.js       # Telegram команди
├── bot.js               # Локальний режим (IMAP IDLE)
├── setup-webhook.js     # Реєстрація webhook
├── vercel.json          # Cron конфіг
├── package.json
├── .env
└── .gitignore
```
