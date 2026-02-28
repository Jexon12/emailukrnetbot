# 📧 Email → Telegram Bot

Бот для пересилання IMAP-пошти в Telegram. Підтримка UKR.NET, Gmail, Outlook та інших IMAP-провайдерів.

## Можливості

- 📬 Пересилання листів в Telegram
- ✉️ Відповіді на листи з Telegram
- 🛡️ Спам-фільтр (патерни, слова, блокування відправників)
- ⚡ Фільтри за ключовими словами
- 🔕 Тихий режим (розклад QUIET_START–QUIET_END)
- 📊 Аналітика, дашборд, Mini App
- 📧 Кілька IMAP-акаунтів
- 🔍 Пошук по всіх акаунтах

## Швидкий старт

```bash
cp .env.example .env
# Заповніть .env
npm install
npm start
```

## Змінні середовища

| Змінна | Обовʼязкова | Опис |
|--------|-------------|------|
| EMAIL_USER | ✅ | Email для IMAP |
| EMAIL_PASSWORD | ✅ | IMAP-пароль |
| TELEGRAM_BOT_TOKEN | ✅ | Токен бота |
| TELEGRAM_CHAT_ID | ✅ | ID чату для пересилання |
| IMAP_HOST | | imap.ukr.net |
| IMAP_PORT | | 993 |
| QUIET_START | | 23 (година початку тихого режиму) |
| QUIET_END | | 7 (година кінця) |
| PORT | | 3000 |
| ENCRYPTION_KEY | | 32 байти hex для шифрування паролів у store |
| API_KEY | | Ключ для /api/export |
| RENDER_EXTERNAL_URL | | URL для Render.com keep-alive |

## Команди бота

- `/status` — стан
- `/stats` — статистика
- `/analytics` — аналітика
- `/digest` — дайджест за сьогодні
- `/search <слово>` — пошук
- `/filter add/remove/list` — фільтри
- `/spam` — спам-фільтр
- `/mute` / `/unmute` — тихий режим
- `/accounts` — акаунти
- `/addmail` — додати акаунт
- `/removemail <email>` — видалити (з підтвердженням)
- `/miniapp` — Mini App

## API

- `GET /` — дашборд
- `GET /miniapp` — Mini App
- `GET /api/stats` — статистика
- `GET /api/analytics` — аналітика
- `GET /api/spam` — спам-дані
- `GET /api/health` — health check
- `GET /api/export?format=json|csv` — експорт (потрібен API_KEY якщо встановлено)

## Тести

```bash
npm test
```

## Безпека

- Встановіть `ENCRYPTION_KEY` для шифрування паролів акаунтів у store
- Встановіть `API_KEY` для захисту експорту
- Rate limiting на API та команди Telegram

## Render.com

`render.yaml` налаштовано для деплою. Вкажіть `RENDER_EXTERNAL_URL` для keep-alive.
