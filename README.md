# MineRush2026

Telegram Mini App + Bot MVP for a virtual mining/reward points system.

## Stack
- Node.js + Express
- SQLite
- Telegram Web App SDK
- Vanilla HTML/CSS/JS
- Admin API

## Important
MRX is a virtual in-app points balance, not real cryptocurrency mining.
Never put BOT_TOKEN or database secrets in frontend code.

## Setup
1. Install Node.js 20+.
2. Copy `backend/.env.example` to `backend/.env`.
3. Put your BotFather token in `TELEGRAM_BOT_TOKEN`.
4. Set `WEBAPP_URL` to the public HTTPS URL of the frontend.
5. From `backend/`: `npm install`
6. Run: `npm start`
7. Configure the bot's menu button/web app URL in BotFather.
8. Open the bot in Telegram and launch the Mini App.

For production, put the app behind HTTPS and use a persistent database volume.
