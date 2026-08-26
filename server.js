import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = Number(process.env.PORT || 3000);

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const APP_URL =
  process.env.APP_URL ||
  "https://minerush2026-1.onrender.com";

const BOT_USERNAME =
  process.env.BOT_USERNAME ||
  "MineRush2026_bot";

const db = new Database(
  process.env.DB_FILE || "./minerush.sqlite"
);

/* =========================
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  balance REAL DEFAULT 0,
  mining_started_at INTEGER,
  last_daily_bonus TEXT,
  referred_by TEXT,
  referral_paid INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount_usdt REAL NOT NULL,
  wallet TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);
`);

const now = () => Date.now();

const mrXPerHour =
  Number(process.env.MRX_PER_HOUR || 10);

const adReward =
  Number(process.env.MRX_PER_AD || 25);

const referralBonus =
  Number(process.env.REFERRAL_BONUS_MRX || 500);

const minWithdraw =
  Number(process.env.MIN_WITHDRAW_USDT || 10);

/* =========================
   USER FUNCTIONS
========================= */

function getUser(id) {
  return db
    .prepare(
      "SELECT * FROM users WHERE telegram_id=?"
    )
    .get(String(id));
}

function upsertUser(tg) {
  if (!tg?.id) {
    throw new Error("Missing Telegram user");
  }

  const id = String(tg.id);

  const existing = getUser(id);

  if (!existing) {
    db.prepare(`
      INSERT INTO users
      (
        telegram_id,
        username,
        first_name,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `).run(
      id,
      tg.username || "",
      tg.first_name || "",
      now()
    );
  } else {
    db.prepare(`
      UPDATE users
      SET username=?, first_name=?
      WHERE telegram_id=?
    `).run(
      tg.username || "",
      tg.first_name || "",
      id
    );
  }

  return getUser(id);
}

/* =========================
   REFERRAL
========================= */

function processReferral(newUserId, referralCode) {

  if (!referralCode) {
    return;
  }

  const newUser =
    getUser(newUserId);

  if (!newUser) {
    return;
  }

  // Already referred
  if (newUser.referred_by) {
    return;
  }

  // Referral code format:
  // ref_123456789

  const referrerId =
    String(referralCode)
      .replace(/^ref_/, "")
      .trim();

  if (!referrerId) {
    return;
  }

  // Cannot refer yourself
  if (
    referrerId ===
    String(newUserId)
  ) {
    return;
  }

  const referrer =
    getUser(referrerId);

  if (!referrer) {
    return;
  }

  // Save referrer
  db.prepare(`
    UPDATE users
    SET referred_by=?
    WHERE telegram_id=?
  `).run(
    referrerId,
    String(newUserId)
  );

  /*
    Referral bonus is paid only once.
    The bonus is given to the referrer.
  */

  if (
    Number(referrer.referral_paid || 0) === 0
  ) {

    db.prepare(`
      UPDATE users
      SET
        balance=balance+?,
        referral_paid=1
      WHERE telegram_id=?
    `).run(
      referralBonus,
      referrerId
    );

    db.prepare(`
      INSERT INTO transactions
      (
        telegram_id,
        type,
        amount,
        note,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      referrerId,
      "referral",
      referralBonus,
      `Referral from ${newUserId}`,
      now()
    );
  }
}

/* =========================
   MINING
========================= */

function claimMining(userId) {

  const id = String(userId);

  const user = getUser(id);

  if (!user) {
    throw new Error("User not found");
  }

  const current = now();

  if (!user.mining_started_at) {

    db.prepare(`
      UPDATE users
      SET mining_started_at=?
      WHERE telegram_id=?
    `).run(
      current,
      id
    );

    return getUser(id);
  }

  const elapsedHours =
    Math.min(
      12,
      Math.floor(
        (
          current -
          Number(user.mining_started_at)
        ) / 3600000
      )
    );

  const earned =
    elapsedHours * mrXPerHour;

  if (earned > 0) {

    db.prepare(`
      UPDATE users
      SET
        balance=balance+?,
        mining_started_at=?
      WHERE telegram_id=?
    `).run(
      earned,
      current,
      id
    );

    db.prepare(`
      INSERT INTO transactions
      (
        telegram_id,
        type,
        amount,
        note,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      "mining",
      earned,
      `${elapsedHours} hour(s)`,
      current
    );
  }

  return getUser(id);
}

/* =========================
   TELEGRAM API
========================= */

async function telegram(method, body) {

  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(body)
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      "Telegram API error"
    );
  }

  return data;
}

/* =========================
   TELEGRAM WEBHOOK
========================= */

app.post(
  "/telegram/webhook",
  async (req, res) => {

    res.sendStatus(200);

    try {

      const message =
        req.body?.message;

      if (!message) {
        return;
      }

      const tgUser =
        message.from;

      if (!tgUser?.id) {
        return;
      }

      const text =
        String(
          message.text || ""
        );

      /*
        /start
        /start ref_123456
      */

      if (
        text === "/start" ||
        text.startsWith("/start ")
      ) {

        const parts =
          text.split(" ");

        const startParameter =
          parts.length > 1
            ? parts[1]
            : "";

        const user =
          upsertUser(tgUser);

        if (
          startParameter &&
          startParameter.startsWith("ref_")
        ) {

          processReferral(
            user.telegram_id,
            startParameter
          );
        }

        await telegram(
          "sendMessage",
          {
            chat_id:
              tgUser.id,

            text:
              `👋 Welcome to MineRush2026, ${tgUser.first_name || "Miner"}!\n\n⛏️ Start mining MRX and collect your rewards.\n\n💰 Your current balance: ${Number(getUser(tgUser.id).balance || 0)} MRX`,

            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      "⛏️ Open MineRush2026",

                    web_app: {
                      url: APP_URL
                    }
                  }
                ]
              ]
            }
          }
        );

      }

    } catch (error) {

      console.error(
        "Telegram webhook error:",
        error.message
      );

    }
  }
);

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

/* =========================
   HEALTH
========================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      service:
        "MineRush2026",
      status:
        "online"
    });

  }
);

/* =========================
   BOOTSTRAP
========================= */

app.post(
  "/api/bootstrap",
  (req, res) => {

    try {

      const user =
        upsertUser(
          req.body.user
        );

      const claimed =
        claimMining(
          user.telegram_id
        );

      res.json({
        ok: true,
        user: claimed,
        miningRate:
          mrXPerHour
      });

    } catch (e) {

      res.status(400).json({
        ok: false,
        error:
          e.message
      });

    }
  }
);

/* =========================
   MINING CLAIM
========================= */

app.post(
  "/api/mining/claim",
  (req, res) => {

    try {

      const user =
        claimMining(
          req.body.telegram_id
        );

      res.json({
        ok: true,
        user
      });

    } catch (e) {

      res.status(400).json({
        ok: false,
        error:
          e.message
      });

    }
  }
);

/* =========================
   DAILY BONUS
========================= */

app.post(
  "/api/daily",
  (req, res) => {

    try {

      const id =
        String(
          req.body.telegram_id
        );

      const user =
        getUser(id);

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      const day =
        new Date()
          .toISOString()
          .slice(0, 10);

      if (
        user.last_daily_bonus === day
      ) {

        return res.json({
          ok: false,
          error:
            "Daily bonus already claimed"
        });
      }

      const amount = 100;

      db.prepare(`
        UPDATE users
        SET
          balance=balance+?,
          last_daily_bonus=?
        WHERE telegram_id=?
      `).run(
        amount,
        day,
        id
      );

      db.prepare(`
        INSERT INTO transactions
        (
          telegram_id,
          type,
          amount,
          note,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        "daily",
        amount,
        "Daily bonus",
        now()
      );

      res.json({
        ok: true,
        amount,
        user:
          getUser(id)
      });

    } catch (e) {

      res.status(400).json({
        ok: false,
        error:
          e.message
      });

    }
  }
);

/* =========================
   AD REWARD
========================= */

app.post(
  "/api/ad/reward",
  (req, res) => {

    try {

      const id =
        String(
          req.body.telegram_id
        );

      const user =
        getUser(id);

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      const amount =
        adReward;

      db.prepare(`
        UPDATE users
        SET balance=balance+?
        WHERE telegram_id=?
      `).run(
        amount,
        id
      );

      db.prepare(`
        INSERT INTO transactions
        (
          telegram_id,
          type,
          amount,
          note,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        "ad_reward",
        amount,
        "Ad reward MVP",
        now()
      );

      res.json({
        ok: true,
        amount,
        user:
          getUser(id)
      });

    } catch (e) {

      res.status(400).json({
        ok: false,
        error:
          e.message
      });

    }
  }
);

/* =========================
   WITHDRAW
========================= */

app.post(
  "/api/withdraw",
  (req, res) => {

    try {

      const id =
        String(
          req.body.telegram_id
        );

      const amount =
        Number(
          req.body.amount_usdt
        );

      const wallet =
        String(
          req.body.wallet || ""
        ).trim();

      if (!wallet) {
        throw new Error(
          "Wallet is required"
        );
      }

      if (
        !Number.isFinite(amount) ||
        amount < minWithdraw
      ) {

        throw new Error(
          `Minimum withdrawal is ${minWithdraw} USDT`
        );
      }

      const user =
        getUser(id);

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      const required =
        amount * 1000;

      if (
        Number(user.balance) <
        required
      ) {

        throw new Error(
          "Insufficient MRX balance"
        );
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET balance=balance-?
            WHERE telegram_id=?
          `).run(
            required,
            id
          );

          const result =
            db.prepare(`
              INSERT INTO withdrawals
              (
                telegram_id,
                amount_usdt,
                wallet,
                status,
                created_at
              )
              VALUES (?, ?, ?, ?, ?)
            `).run(
              id,
              amount,
              wallet,
              "pending",
              now()
            );

          db.prepare(`
            INSERT INTO transactions
            (
              telegram_id,
              type,
              amount,
              note,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `).run(
            id,
            "withdrawal",
            -required,
            `Withdrawal request #${result.lastInsertRowid}`,
            now()
          );

          return result.lastInsertRowid;
        });

      res.json({
        ok: true,
        withdrawal_id:
          transaction(),
        user:
          getUser(id)
      });

    } catch (e) {

      res.status(400).json({
        ok: false,
        error:
          e.message
      });

    }
  }
);

/* =========================
   ADMIN AUTH
========================= */

function admin(req, res, next) {

  const key =
    process.env.ADMIN_KEY;

  if (
    !key ||
    req.headers["x-admin-key"] !== key
  ) {

    return res.status(401).json({
      ok: false,
      error:
        "Unauthorized"
    });
  }

  next();
}

/* =========================
   ADMIN STATS
========================= */

app.get(
  "/api/admin/stats",
  admin,
  (req, res) => {

    const users =
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM users"
        )
        .get().c;

    const pending =
      db
        .prepare(`
          SELECT COUNT(*) AS c
          FROM withdrawals
          WHERE status='pending'
        `)
        .get().c;

    const balance =
      db
        .prepare(`
          SELECT
            COALESCE(
              SUM(balance),
              0
            ) AS s
          FROM users
        `)
        .get().s;

    res.json({
      ok: true,
      users,
      pendingWithdrawals:
        pending,
      totalMRX:
        balance
    });
  }
);

/* =========================
   ADMIN WITHDRAWALS
========================= */

app.get(
  "/api/admin/withdrawals",
  admin,
  (req, res) => {

    const items =
      db
        .prepare(`
          SELECT *
          FROM withdrawals
          ORDER BY id DESC
          LIMIT 200
        `)
        .all();

    res.json({
      ok: true,
      items
    });
  }
);

/* =========================
   ADMIN STATUS
========================= */

app.post(
  "/api/admin/withdrawals/:id/status",
  admin,
  (req, res) => {

    const id =
      Number(req.params.id);

    const status =
      String(
        req.body.status
      );

    if (
      ![
        "pending",
        "paid",
        "rejected"
      ].includes(status)
    ) {

      return res.status(400).json({
        ok: false,
        error:
          "Invalid status"
      });
    }

    db.prepare(`
      UPDATE withdrawals
      SET
        status=?,
        processed_at=?
      WHERE id=?
    `).run(
      status,
      status === "pending"
        ? null
        : now(),
      id
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   SET TELEGRAM WEBHOOK
========================= */

async function setupTelegram() {

  if (!BOT_TOKEN) {

    console.log(
      "TELEGRAM_BOT_TOKEN not configured"
    );

    return;
  }

  try {

    const webhookUrl =
      `${APP_URL}/telegram/webhook`;

    const result =
      await telegram(
        "setWebhook",
        {
          url: webhookUrl
        }
      );

    console.log(
      "Telegram webhook:",
      result.ok
        ? "configured"
        : "failed"
    );

    console.log(
      "Webhook URL:",
      webhookUrl
    );

  } catch (error) {

    console.error(
      "Telegram webhook setup failed:",
      error.message
    );
  }
}

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  async () => {

    console.log(
      `MineRush2026 API listening on :${PORT}`
    );

    console.log(
      "MineRush2026 frontend enabled"
    );

    await setupTelegram();
  }
);
