# 📧 → 💬 Email to Telegram Bot

Telegram-бот, який пересилає листи з **UKR.NET** у ваш Telegram-чат.

## ✨ Можливості

- 📨 Миттєва пересилка нових листів (IMAP IDLE)
- 📎 Вкладення як документи в Telegram
- 🤖 Команди: `/status`, `/last`, `/help`
- 📊 Статистика роботи
- 🔄 Автоматичне перепідключення

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

## ☁️ Деплой на Render.com

1. Залийте код на **GitHub**
2. Зайдіть на [render.com](https://render.com) → **New → Background Worker**
3. Підключіть ваш GitHub репозиторій
4. Налаштування:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Додайте **Environment Variables** (як у `.env`)
6. Натисніть **Create Background Worker**

> 💡 Або натисніть "Blueprint" і Render автоматично візьме `render.yaml`

## 🤖 Команди бота

| Команда | Опис |
|---------|------|
| `/start` | Привітання |
| `/status` | Стан бота і статистика |
| `/last` | Останній пересланий лист |
| `/help` | Довідка |
