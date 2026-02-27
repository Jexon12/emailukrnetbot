# 📧 → 💬 Email to Telegram Bot v4.0

Telegram-бот, який пересилає листи з **UKR.NET** (та інших IMAP-поштових сервісів) у ваш Telegram-чат. З аналітикою, спам-фільтром, міні-додатком і веб-панеллю.

---

## ✨ Можливості

| Фіча | Опис |
|-------|------|
| 📨 **Миттєва пересилка** | IMAP IDLE — листи приходять за секунди |
| 🏷️ **Авто-категорії** | 🏦 Банк, 🛒 Покупки, 📢 Розсилки, 🔑 OTP, 💼 Робота, 🎓 Навчання, 🌐 Соцмережі |
| 🛡️ **Спам-детектор** | 12 вбудованих правил + власні слова та відправники |
| 📈 **Аналітика** | Піки годин, дні тижня, категорії, топ відправники |
| 📱 **Telegram Mini App** | Повноцінний дашборд прямо в Telegram |
| 🌐 **Веб-панель** | Статистика, графіки, стан бота через браузер |
| ✉️ **Відповідь на лист** | Відповідайте на email прямо з Telegram |
| 📧 **Мульти-акаунти** | Підключайте Gmail, Outlook, будь-яку IMAP-пошту |
| 🔕 **Тихий режим** | Вимкніть сповіщення, листи збережуться в черзі |
| ⚡ **Фільтри** | Ігноруйте листи за ключовими словами |
| 📋 **Дайджест** | Щоденна зведення листів |
| 🔍 **Пошук** | Шукайте листи за темою або відправником |

---

## 🤖 Команди бота

| Команда | Опис |
|---------|------|
| `/status` | 📊 Стан бота |
| `/stats` | 📈 Статистика листів |
| `/analytics` | 📈 Аналітика (піки, тренди) |
| `/digest` | 📋 Дайджест за сьогодні |
| `/search <слово>` | 🔍 Пошук листів |
| `/filter add/remove/list` | ⚡ Керування фільтрами |
| `/spam add/block/list` | 🛡️ Спам-фільтр |
| `/mute` / `/unmute` | 🔕 Тихий режим |
| `/accounts` | 📧 Підключені акаунти |
| `/addmail` | 📧 Додати новий акаунт |
| `/miniapp` | 📱 Відкрити Mini App |
| `/help` | 📋 Довідка |

---

## 📦 Структура проекту

```
email-telegram-bot/
├── bot.js              # Головний файл: IMAP + Telegram + команди
├── lib/
│   ├── store.js        # Хранилище (JSON)
│   ├── categories.js   # Авто-категорії
│   ├── formatter.js    # Форматування повідомлень
│   ├── smtp.js         # Відправка відповідей (SMTP)
│   ├── spam.js         # Спам-детектор
│   ├── analytics.js    # Аналітика
│   └── web.js          # Express: веб-панель + API
├── public/
│   └── miniapp.html    # Telegram Mini App
├── data/
│   └── store.json      # Дані (створюється автоматично)
├── render.yaml         # Конфіг Render.com
├── package.json
├── .env                # Змінні середовища (НЕ завантажувати на GitHub!)
└── .gitignore
```

---

## 🔧 Налаштування

### 1. Клонуйте репозиторій

```bash
git clone https://github.com/<ваш_username>/email-telegram-bot.git
cd email-telegram-bot
npm install
```

### 2. Створіть `.env`

```env
EMAIL_USER=your@ukr.net
EMAIL_PASSWORD=your_imap_password
IMAP_HOST=imap.ukr.net
IMAP_PORT=993
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
RECONNECT_DELAY=5000
PORT=3000
```

### 3. Локальний запуск

```bash
npm start
```

---

## ☁️ Деплой на Render.com

1. Залийте код на **GitHub** (`.env` та `node_modules` в `.gitignore`!)
2. Зайдіть на [render.com](https://render.com) → **New → Web Service**
3. Підключіть GitHub репозиторій
4. Налаштування:
   - **Build Command:** `npm install`
   - **Start Command:** `node bot.js`
5. Додайте **Environment Variables:**
   - `EMAIL_USER`, `EMAIL_PASSWORD`, `IMAP_HOST`, `IMAP_PORT`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `PORT` = `10000`
   - `RENDER_EXTERNAL_URL` = URL вашого сервісу _(для Mini App)_
6. **Create Web Service** 🚀

> 💡 Або використовуйте Blueprint — Render автоматично візьме `render.yaml`

---

## 🛡️ Безпека

- ⚠️ **Ніколи** не завантажуйте `.env` на GitHub
- 🔒 Паролі зберігаються тільки у змінних середовища Render
- 🔑 Для UKR.NET використовуйте IMAP-пароль (не пароль від акаунту)

---

## 📄 Ліцензія

MIT
