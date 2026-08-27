import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

dotenv.config();

const app = express();

/* =====================================================
   PATH
===================================================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =====================================================
   CONFIG
===================================================== */

const PORT = Number(process.env.PORT || 10000);

const BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || ""
).trim();

const APP_URL = String(
  process.env.APP_URL ||
  "https://minerush2026-1.onrender.com"
).replace(/\/+$/, "");

const BOT_USERNAME = String(
  process.env.BOT_USERNAME ||
  "MineRush2026_bot"
).replace(/^@/, "");

/* =====================================================
   GAME SETTINGS
===================================================== */

const MRX_PER_HOUR = Number(
  process.env.MRX_PER_HOUR || 10
);

const AD_REWARD = Number(
  process.env.MRX_PER_AD || 25
);

const REFERRAL_BONUS = Number(
  process.env.REFERRAL_BONUS_MRX || 500
);

const MIN_WITHDRAW_USDT = Number(
  process.env.MIN_WITHDRAW_USDT || 10
);

const MRX_PER_USDT = 1000;

const DAILY_BONUS = 100;

const AD_WATCH_SECONDS = 30;

const AD_COOLDOWN_MS = 5 * 60 * 1000;

const MAX_MINING_SECONDS = 12 * 60 * 60;

/*
   Adsterra SmartLink
*/
const AD_URL =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";

/* =====================================================
   MIDDLEWARE
===================================================== */

app.disable("x-powered-by");

app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

/*
   Basic security headers
*/
app.use((req, res, next) => {
  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  res.setHeader(
    "X-Frame-Options",
    "SAMEORIGIN"
  );

  res.setHeader(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );

  next();
});

/* =====================================================
   DATABASE
===================================================== */

const db = new Database(
  process.env.DB_FILE || "./minerush.sqlite"
);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const now = () => Date.now();

/* =====================================================
   DATABASE TABLES
===================================================== */

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

  referral_count INTEGER DEFAULT 0,

  referral_earnings REAL DEFAULT 0,

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

CREATE TABLE IF NOT EXISTS ad_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  telegram_id TEXT NOT NULL,

  token TEXT UNIQUE NOT NULL,

  started_at INTEGER NOT NULL,

  expires_at INTEGER NOT NULL,

  claimed_at INTEGER,

  status TEXT DEFAULT 'active'
);
`);

/* =====================================================
   DATABASE MIGRATION
===================================================== */

function addColumnIfMissing(
  table,
  column,
  definition
) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all();

  const exists = columns.some(
    item => item.name === column
  );

  if (!exists) {
    db.exec(
      `ALTER TABLE ${table}
       ADD COLUMN ${column} ${definition}`
    );
  }
}

addColumnIfMissing(
  "users",
  "referral_count",
  "INTEGER DEFAULT 0"
);

addColumnIfMissing(
  "users",
  "referral_earnings",
  "REAL DEFAULT 0"
);

/* =====================================================
   USER FUNCTIONS
===================================================== */

function getUser(telegramId) {
  return db
    .prepare(`
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
    `)
    .get(String(telegramId));
}

function upsertUser(tg) {
  if (!tg || !tg.id) {
    throw new Error(
      "Telegram user is required"
    );
  }

  const id = String(tg.id);

  const username =
    String(tg.username || "");

  const firstName =
    String(tg.first_name || "Miner");

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
      username,
      firstName,
      now()
    );
  } else {
    db.prepare(`
      UPDATE users
      SET
        username = ?,
        first_name = ?
      WHERE telegram_id = ?
    `).run(
      username || existing.username || "",
      firstName || existing.first_name || "Miner",
      id
    );
  }

  return getUser(id);
}

/* =====================================================
   REFERRAL
===================================================== */

function processReferral(
  newUserId,
  startParameter
) {
  if (!startParameter) {
    return null;
  }

  const newId = String(newUserId);

  const newUser = getUser(newId);

  if (!newUser) {
    return {
      success: false,
      reason: "New user not found"
    };
  }

  if (newUser.referred_by) {
    return {
      success: false,
      reason: "Already referred"
    };
  }

  let referrerId =
    String(startParameter).trim();

  if (referrerId.startsWith("ref_")) {
    referrerId =
      referrerId.substring(4);
  }

  if (!/^\d+$/.test(referrerId)) {
    return {
      success: false,
      reason: "Invalid referral code"
    };
  }

  if (referrerId === newId) {
    return {
      success: false,
      reason: "Self referral blocked"
    };
  }

  const referrer =
    getUser(referrerId);

  if (!referrer) {
    return {
      success: false,
      reason: "Referrer not found"
    };
  }

  const transaction =
    db.transaction(() => {

      const update =
        db.prepare(`
          UPDATE users
          SET referred_by = ?
          WHERE telegram_id = ?
          AND referred_by IS NULL
        `).run(
          referrerId,
          newId
        );

      if (update.changes !== 1) {
        return false;
      }

      db.prepare(`
        UPDATE users
        SET
          balance =
            COALESCE(balance, 0) + ?,

          referral_count =
            COALESCE(referral_count, 0) + 1,

          referral_earnings =
            COALESCE(referral_earnings, 0) + ?

        WHERE telegram_id = ?
      `).run(
        REFERRAL_BONUS,
        REFERRAL_BONUS,
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
        REFERRAL_BONUS,
        `Referral from ${newId}`,
        now()
      );

      return true;
    });

  const success = transaction();

  if (!success) {
    return {
      success: false,
      reason: "Referral already processed"
    };
  }

  return {
    success: true,
    referrerId,
    bonus: REFERRAL_BONUS
  };
}

/* =====================================================
   MINING
===================================================== */

function claimMining(telegramId) {
  const id = String(telegramId);

  const user = getUser(id);

  if (!user) {
    throw new Error(
      "User not found"
    );
  }

  const current = now();

  /*
     First mining request:
     only starts the cycle.
  */

  if (!user.mining_started_at) {
    db.prepare(`
      UPDATE users
      SET mining_started_at = ?
      WHERE telegram_id = ?
    `).run(
      current,
      id
    );

    return getUser(id);
  }

  const elapsedSeconds =
    Math.floor(
      (
        current -
        Number(user.mining_started_at)
      ) / 1000
    );

  const cappedSeconds =
    Math.min(
      MAX_MINING_SECONDS,
      Math.max(0, elapsedSeconds)
    );

  const earned =
    (
      cappedSeconds / 3600
    ) * MRX_PER_HOUR;

  if (earned > 0) {

    db.prepare(`
      UPDATE users
      SET
        balance =
          COALESCE(balance, 0) + ?,

        mining_started_at = ?

      WHERE telegram_id = ?
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
      "Mining reward",
      current
    );
  }

  return getUser(id);
}

/* =====================================================
   TELEGRAM API
===================================================== */

async function telegram(
  method,
  body
) {
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

        body:
          JSON.stringify(body)
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

/* =====================================================
   FRONTEND
===================================================== */

/*
   ONLY these 3 frontend files are exposed.
*/

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

app.get(
  "/index.html",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

app.get(
  "/style.css",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "style.css"
      )
    );
  }
);

app.get(
  "/app.js",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "app.js"
      )
    );
  }
);

/* =====================================================
   BLOCK SENSITIVE FILES
===================================================== */

const blockedFiles = new Set([
  "/server.js",
  "/package.json",
  "/package-lock.json",
  "/yarn.lock",
  "/.env",
  "/minerush.sqlite",
  "/minerush.sqlite-shm",
  "/minerush.sqlite-wal"
]);

app.use(
  (req, res, next) => {

    if (
      blockedFiles.has(
        req.path
      )
    ) {
      return res
        .status(404)
        .send("Not Found");
    }

    next();
  }
);

/* =====================================================
   TELEGRAM WEBHOOK
===================================================== */

app.post(
  "/telegram/webhook",
  async (req, res) => {

    /*
       Telegram must receive 200 quickly.
    */

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
        ).trim();

      if (
        text === "/start" ||
        text.startsWith("/start ")
      ) {

        const parts =
          text.split(/\s+/);

        const startParameter =
          parts.length > 1
            ? parts[1]
            : "";

        const user =
          upsertUser(tgUser);

        let referralResult = null;

        if (startParameter) {

          referralResult =
            processReferral(
              user.telegram_id,
              startParameter
            );
        }

        const updatedUser =
          getUser(
            user.telegram_id
          );

        await telegram(
          "sendMessage",
          {
            chat_id:
              tgUser.id,

            text:
              `👋 Welcome to MineRush2026, ${tgUser.first_name || "Miner"}!\n\n` +
              `⛏️ Mining rate: ${MRX_PER_HOUR} MRX/hour\n` +
              `🎁 Daily bonus: ${DAILY_BONUS} MRX\n` +
              `👥 Referral bonus: ${REFERRAL_BONUS} MRX\n` +
              `💱 1000 MRX = 1 USDT\n\n` +
              `💰 Balance: ${Number(
                updatedUser.balance || 0
              ).toLocaleString()} MRX`,

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

        console.log(
          "Telegram /start:",
          tgUser.id,
          referralResult
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

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      service: "MineRush2026",
      status: "online"
    });
  }
);

/* =====================================================
   BOOTSTRAP
===================================================== */

app.post(
  "/api/bootstrap",
  (req, res) => {

    try {

      const body =
        req.body || {};

      /*
         Telegram Mini App normally sends:

         {
           user: {
             id,
             username,
             first_name
           }
         }

         The fallback is kept for testing.
      */

      let tgUser =
        body.user;

      if (
        (!tgUser || !tgUser.id) &&
        body.telegram_id
      ) {

        tgUser = {
          id:
            String(
              body.telegram_id
            ),

          username:
            body.username || "",

          first_name:
            body.first_name || "Miner"
        };
      }

      if (!tgUser?.id) {

        return res.status(400).json({
          ok: false,

          error:
            "Telegram user is required",

          hint:
            "Open MineRush2026 from the Telegram bot."
        });
      }

      const user =
        upsertUser(tgUser);

      /*
         Start mining only if needed.
         Do not accidentally reward every bootstrap.
      */

      if (!user.mining_started_at) {

        db.prepare(`
          UPDATE users
          SET mining_started_at = ?
          WHERE telegram_id = ?
        `).run(
          now(),
          user.telegram_id
        );
      }

      const updated =
        getUser(
          user.telegram_id
        );

      res.json({
        ok: true,

        user: updated,

        miningRate:
          MRX_PER_HOUR,

        miningCycleHours:
          12,

        adReward:
          AD_REWARD,

        referralBonus:
          REFERRAL_BONUS,

        dailyBonus:
          DAILY_BONUS,

        minWithdrawUSDT:
          MIN_WITHDRAW_USDT,

        mrxPerUSDT:
          MRX_PER_USDT
      });

    } catch (error) {

      console.error(
        "Bootstrap error:",
        error.message
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   MINING CLAIM
===================================================== */

app.post(
  "/api/mining/claim",
  (req, res) => {

    try {

      const id =
        String(
          req.body?.telegram_id || ""
        ).trim();

      if (!id) {
        throw new Error(
          "Telegram ID is required"
        );
      }

      const user =
        claimMining(id);

      res.json({
        ok: true,
        user
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   DAILY BONUS
===================================================== */

app.post(
  "/api/daily",
  (req, res) => {

    try {

      const id =
        String(
          req.body?.telegram_id || ""
        ).trim();

      if (!id) {
        throw new Error(
          "Telegram ID is required"
        );
      }

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
            "Daily bonus already claimed",

          user
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET
              balance =
                COALESCE(balance, 0) + ?,

              last_daily_bonus = ?

            WHERE telegram_id = ?
          `).run(
            DAILY_BONUS,
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
            DAILY_BONUS,
            "Daily bonus",
            now()
          );
        });

      transaction();

      res.json({
        ok: true,

        amount:
          DAILY_BONUS,

        user:
          getUser(id)
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   AD START
===================================================== */

app.post(
  "/api/ad/start",
  (req, res) => {

    try {

      const id =
        String(
          req.body?.telegram_id || ""
        ).trim();

      if (!id) {
        throw new Error(
          "Telegram ID is required"
        );
      }

      const user =
        getUser(id);

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      const recent =
        db.prepare(`
          SELECT created_at
          FROM transactions
          WHERE telegram_id = ?
          AND type = 'ad_reward'
          ORDER BY id DESC
          LIMIT 1
        `).get(id);

      if (recent) {

        const elapsed =
          now() -
          Number(
            recent.created_at
          );

        if (
          elapsed < AD_COOLDOWN_MS
        ) {

          const remaining =
            Math.ceil(
              (
                AD_COOLDOWN_MS -
                elapsed
              ) / 1000
            );

          return res.json({
            ok: false,

            cooldown: true,

            remainingSeconds:
              remaining,

            error:
              `Please wait ${Math.ceil(
                remaining / 60
              )} minute(s).`
          });
        }
      }

      /*
         Remove old active sessions
      */

      db.prepare(`
        UPDATE ad_sessions
        SET status = 'expired'
        WHERE telegram_id = ?
        AND status = 'active'
      `).run(id);

      const token =
        crypto
          .randomBytes(32)
          .toString("hex");

      const startedAt =
        now();

      const expiresAt =
        startedAt +
        AD_WATCH_SECONDS * 1000;

      db.prepare(`
        INSERT INTO ad_sessions
        (
          telegram_id,
          token,
          started_at,
          expires_at,
          status
        )
        VALUES (?, ?, ?, ?, 'active')
      `).run(
        id,
        token,
        startedAt,
        expiresAt
      );

      res.json({
        ok: true,

        token,

        startedAt,

        expiresAt,

        watchSeconds:
          AD_WATCH_SECONDS,

        reward:
          AD_REWARD,

        adUrl:
          AD_URL
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   AD CLAIM
===================================================== */

app.post(
  "/api/ad/claim",
  (req, res) => {

    try {

      const id =
        String(
          req.body?.telegram_id || ""
        ).trim();

      const token =
        String(
          req.body?.token || ""
        ).trim();

      if (!id || !token) {
        throw new Error(
          "Invalid ad session"
        );
      }

      const user =
        getUser(id);

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      const session =
        db.prepare(`
          SELECT *
          FROM ad_sessions
          WHERE token = ?
          AND telegram_id = ?
          LIMIT 1
        `).get(
          token,
          id
        );

      if (!session) {
        throw new Error(
          "Ad session not found"
        );
      }

      if (
        session.status !== "active"
      ) {
        throw new Error(
          "Ad session already used"
        );
      }

      const current =
        now();

      if (
        current <
        Number(session.expires_at)
      ) {

        const remaining =
          Math.ceil(
            (
              Number(
                session.expires_at
              ) -
              current
            ) / 1000
          );

        throw new Error(
          `Please wait ${remaining} more second(s)`
        );
      }

      const transaction =
        db.transaction(() => {

          const updated =
            db.prepare(`
              UPDATE ad_sessions
              SET
                status = 'claimed',
                claimed_at = ?
              WHERE id = ?
              AND status = 'active'
            `).run(
              current,
              session.id
            );

          if (
            updated.changes !== 1
          ) {
            throw new Error(
              "Ad session already claimed"
            );
          }

          db.prepare(`
            UPDATE users
            SET
              balance =
                COALESCE(balance, 0) + ?
            WHERE telegram_id = ?
          `).run(
            AD_REWARD,
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
            AD_REWARD,
            "Verified ad session",
            current
          );
        });

      transaction();

      res.json({
        ok: true,

        amount:
          AD_REWARD,

        user:
          getUser(id)
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   DIRECT AD REWARD BLOCK
===================================================== */

app.post(
  "/api/ad/reward",
  (req, res) => {

    res.status(403).json({
      ok: false,

      error:
        "Direct ad reward is disabled."
    });
  }
);

/* =====================================================
   REFERRAL INFO
===================================================== */

app.get(
  "/api/referral/:telegram_id",
  (req, res) => {

    try {

      const id =
        String(
          req.params.telegram_id || ""
        ).trim();

      const user =
        getUser(id);

      if (!user) {

        return res.status(404).json({
          ok: false,
          error:
            "User not found"
        });
      }

      const referralLink =
        `https://t.me/${BOT_USERNAME}?start=ref_${id}`;

      res.json({
        ok: true,

        referralCount:
          Number(
            user.referral_count || 0
          ),

        referralEarnings:
          Number(
            user.referral_earnings || 0
          ),

        referralBonus:
          REFERRAL_BONUS,

        referralLink
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   WITHDRAW
===================================================== */

app.post(
  "/api/withdraw",
  (req, res) => {

    try {

      const id =
        String(
          req.body?.telegram_id || ""
        ).trim();

      const amount =
        Number(
          req.body?.amount_usdt
        );

      const wallet =
        String(
          req.body?.wallet || ""
        ).trim();

      if (!id) {
        throw new Error(
          "Telegram ID is required"
        );
      }

      if (!wallet) {
        throw new Error(
          "Wallet is required"
        );
      }

      if (
        !Number.isFinite(amount) ||
        amount < MIN_WITHDRAW_USDT
      ) {
        throw new Error(
          `Minimum withdrawal is ${MIN_WITHDRAW_USDT} USDT`
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
        amount * MRX_PER_USDT;

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

          const updated =
            db.prepare(`
              UPDATE users
              SET
                balance =
                  balance - ?
              WHERE telegram_id = ?
              AND balance >= ?
            `).run(
              required,
              id,
              required
            );

          if (
            updated.changes !== 1
          ) {
            throw new Error(
              "Insufficient MRX balance"
            );
          }

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
              VALUES (?, ?, ?, 'pending', ?)
            `).run(
              id,
              amount,
              wallet,
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
            `Withdrawal #${result.lastInsertRowid}`,
            now()
          );

          return result.lastInsertRowid;
        });

      const withdrawalId =
        transaction();

      res.json({
        ok: true,

        withdrawal_id:
          withdrawalId,

        user:
          getUser(id)
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   ADMIN AUTH
===================================================== */

function admin(req, res, next) {

  const adminKey =
    String(
      process.env.ADMIN_KEY || ""
    );

  if (
    !adminKey ||
    req.headers["x-admin-key"] !== adminKey
  ) {

    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  next();
}

/* =====================================================
   ADMIN STATS
===================================================== */

app.get(
  "/api/admin/stats",
  admin,
  (req, res) => {

    const users =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM users
      `).get().count;

    const pending =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM withdrawals
        WHERE status = 'pending'
      `).get().count;

    const balance =
      db.prepare(`
        SELECT
          COALESCE(
            SUM(balance),
            0
          ) AS total
        FROM users
      `).get().total;

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

/* =====================================================
   ADMIN WITHDRAWALS
===================================================== */

app.get(
  "/api/admin/withdrawals",
  admin,
  (req, res) => {

    const items =
      db.prepare(`
        SELECT *
        FROM withdrawals
        ORDER BY id DESC
        LIMIT 200
      `).all();

    res.json({
      ok: true,
      items
    });
  }
);

/* =====================================================
   ADMIN WITHDRAWAL STATUS
===================================================== */

app.post(
  "/api/admin/withdrawals/:id/status",
  admin,
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      const status =
        String(
          req.body?.status || ""
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

      const withdrawal =
        db.prepare(`
          SELECT *
          FROM withdrawals
          WHERE id = ?
        `).get(id);

      if (!withdrawal) {

        return res.status(404).json({
          ok: false,
          error:
            "Withdrawal not found"
        });
      }

      /*
         Prevent duplicate refunds.
      */

      const transaction =
        db.transaction(() => {

          if (
            status === "rejected" &&
            withdrawal.status === "pending"
          ) {

            const refund =
              Number(
                withdrawal.amount_usdt
              ) * MRX_PER_USDT;

            db.prepare(`
              UPDATE users
              SET
                balance =
                  COALESCE(balance, 0) + ?
              WHERE telegram_id = ?
            `).run(
              refund,
              withdrawal.telegram_id
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
              withdrawal.telegram_id,
              "withdrawal_refund",
              refund,
              `Refund for withdrawal #${id}`,
              now()
            );
          }

          db.prepare(`
            UPDATE withdrawals
            SET
              status = ?,

              processed_at = ?

            WHERE id = ?
          `).run(
            status,
            status === "pending"
              ? null
              : now(),
            id
          );
        });

      transaction();

      res.json({
        ok: true
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   404
===================================================== */

app.use(
  (req, res) => {

    res.status(404).json({
      ok: false,
      error: "Not Found"
    });
  }
);

/* =====================================================
   TELEGRAM WEBHOOK SETUP
===================================================== */

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

    await telegram(
      "setWebhook",
      {
        url: webhookUrl
      }
    );

    console.log(
      "Telegram webhook: configured"
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

/* =====================================================
   START SERVER
===================================================== */

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

    console.log(
      `Mining rate: ${MRX_PER_HOUR} MRX/hour`
    );

    console.log(
      `Ad reward: ${AD_REWARD} MRX`
    );

    console.log(
      `Ad watch time: ${AD_WATCH_SECONDS} seconds`
    );

    console.log(
      "Ad cooldown: 5 minutes"
    );

    console.log(
      "Exchange rate: 1000 MRX = 1 USDT"
    );

    console.log(
      "Adsterra SmartLink enabled"
    );

    console.log(
      `Database: ${process.env.DB_FILE || "./minerush.sqlite"}`
    );

    await setupTelegram();
  }
);
