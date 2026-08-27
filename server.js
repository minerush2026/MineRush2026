import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

/* =====================================================
   APP
===================================================== */

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const PORT = Number(process.env.PORT || 10000);

/* =====================================================
   CONFIG
===================================================== */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

const APP_URL =
  process.env.APP_URL ||
  "https://minerush2026-1.onrender.com";

const BOT_USERNAME =
  process.env.BOT_USERNAME ||
  "MineRush2026_bot";

const ADMIN_KEY =
  process.env.ADMIN_KEY || "";

/* =====================================================
   ADSTERRA
===================================================== */

const AD_URL =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";

const AD_WATCH_SECONDS = 30;
const AD_COOLDOWN_MS = 5 * 60 * 1000;

/* =====================================================
   GAME SETTINGS
===================================================== */

const MRX_PER_HOUR =
  Number(process.env.MRX_PER_HOUR || 10);

const AD_REWARD =
  Number(process.env.MRX_PER_AD || 25);

const DAILY_REWARD =
  Number(process.env.DAILY_REWARD_MRX || 100);

const REFERRAL_BONUS =
  Number(process.env.REFERRAL_BONUS_MRX || 500);

const MIN_WITHDRAW_USDT =
  Number(process.env.MIN_WITHDRAW_USDT || 10);

const MRX_PER_USDT = 1000;

const MAX_MINING_HOURS = 12;

/* =====================================================
   DATABASE
===================================================== */

const db = new Database(
  process.env.DB_FILE || "./minerush.sqlite"
);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

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

    referral_paid INTEGER DEFAULT 0,

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

  CREATE INDEX IF NOT EXISTS idx_users_telegram_id
  ON users(telegram_id);

  CREATE INDEX IF NOT EXISTS idx_transactions_user
  ON transactions(telegram_id);

  CREATE INDEX IF NOT EXISTS idx_ad_sessions_token
  ON ad_sessions(token);

  CREATE INDEX IF NOT EXISTS idx_withdrawals_user
  ON withdrawals(telegram_id);
`);

/* =====================================================
   MIGRATION
===================================================== */

function addColumnIfMissing(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all();

  const exists = columns.some(
    (item) => item.name === column
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

addColumnIfMissing(
  "users",
  "referral_paid",
  "INTEGER DEFAULT 0"
);

/* =====================================================
   HELPERS
===================================================== */

function now() {
  return Date.now();
}

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

function createOrUpdateUser(tgUser) {
  if (!tgUser || !tgUser.id) {
    throw new Error("Invalid Telegram user");
  }

  const telegramId = String(tgUser.id);

  const existing = getUser(telegramId);

  if (!existing) {
    db.prepare(`
      INSERT INTO users (
        telegram_id,
        username,
        first_name,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `).run(
      telegramId,
      tgUser.username || "",
      tgUser.first_name || "",
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
      tgUser.username || existing.username || "",
      tgUser.first_name || existing.first_name || "",
      telegramId
    );
  }

  return getUser(telegramId);
}

function addTransaction(
  telegramId,
  type,
  amount,
  note = ""
) {
  db.prepare(`
    INSERT INTO transactions (
      telegram_id,
      type,
      amount,
      note,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    String(telegramId),
    type,
    Number(amount),
    note,
    now()
  );
}

/* =====================================================
   REFERRAL
===================================================== */

function processReferral(newUserId, startParameter) {
  const newId = String(newUserId);

  const user = getUser(newId);

  if (!user) {
    return {
      success: false,
      reason: "User not found"
    };
  }

  if (user.referred_by) {
    return {
      success: false,
      reason: "Already referred"
    };
  }

  if (!startParameter) {
    return {
      success: false,
      reason: "No referral"
    };
  }

  let referrerId = String(startParameter);

  if (referrerId.startsWith("ref_")) {
    referrerId = referrerId.substring(4);
  }

  referrerId = referrerId.trim();

  if (!/^\d+$/.test(referrerId)) {
    return {
      success: false,
      reason: "Invalid referral"
    };
  }

  if (referrerId === newId) {
    return {
      success: false,
      reason: "Self referral blocked"
    };
  }

  const referrer = getUser(referrerId);

  if (!referrer) {
    return {
      success: false,
      reason: "Referrer not found"
    };
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET referred_by = ?
      WHERE telegram_id = ?
      AND referred_by IS NULL
    `).run(
      referrerId,
      newId
    );

    db.prepare(`
      UPDATE users
      SET
        balance = balance + ?,
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

    addTransaction(
      referrerId,
      "referral",
      REFERRAL_BONUS,
      `Referral from ${newId}`
    );
  });

  transaction();

  return {
    success: true,
    referrerId,
    bonus: REFERRAL_BONUS
  };
}

/* =====================================================
   MINING
===================================================== */

function startMiningIfNeeded(telegramId) {
  const id = String(telegramId);

  const user = getUser(id);

  if (!user) {
    throw new Error("User not found");
  }

  if (!user.mining_started_at) {
    db.prepare(`
      UPDATE users
      SET mining_started_at = ?
      WHERE telegram_id = ?
    `).run(
      now(),
      id
    );
  }

  return getUser(id);
}

function claimMining(telegramId) {
  const id = String(telegramId);

  const user = getUser(id);

  if (!user) {
    throw new Error("User not found");
  }

  if (!user.mining_started_at) {
    return startMiningIfNeeded(id);
  }

  const current = now();

  const elapsedMs =
    current - Number(user.mining_started_at);

  if (elapsedMs < 0) {
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

  const maxMs =
    MAX_MINING_HOURS * 60 * 60 * 1000;

  const effectiveMs =
    Math.min(elapsedMs, maxMs);

  const earned =
    Math.floor(
      effectiveMs / 3600000 * MRX_PER_HOUR
    );

  if (earned <= 0) {
    return getUser(id);
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET
        balance = balance + ?,
        mining_started_at = ?
      WHERE telegram_id = ?
    `).run(
      earned,
      current,
      id
    );

    addTransaction(
      id,
      "mining",
      earned,
      `Mining reward for ${Math.floor(
        effectiveMs / 3600000
      )} hour(s)`
    );
  });

  transaction();

  return getUser(id);
}

/* =====================================================
   TELEGRAM API
===================================================== */

async function telegram(method, body) {
  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      "Telegram API request failed"
    );
  }

  return data;
}

/* =====================================================
   TELEGRAM WEBHOOK
===================================================== */

app.post(
  "/telegram/webhook",
  async (req, res) => {
    res.sendStatus(200);

    try {
      const message = req.body?.message;

      if (!message) {
        return;
      }

      const tgUser = message.from;

      if (!tgUser?.id) {
        return;
      }

      const text =
        String(message.text || "").trim();

      if (
        text === "/start" ||
        text.startsWith("/start ")
      ) {
        const parts = text.split(/\s+/);

        const startParameter =
          parts.length > 1
            ? parts[1]
            : "";

        const user =
          createOrUpdateUser(tgUser);

        let referralResult = null;

        if (startParameter) {
          referralResult =
            processReferral(
              user.telegram_id,
              startParameter
            );
        }

        const updatedUser =
          getUser(user.telegram_id);

        await telegram(
          "sendMessage",
          {
            chat_id: tgUser.id,

            text:
              `👋 Welcome to MineRush2026, ${tgUser.first_name || "Miner"}!\n\n` +
              `⛏️ Start mining MRX and collect rewards.\n\n` +
              `💰 Balance: ${Number(
                updatedUser.balance || 0
              ).toLocaleString()} MRX\n` +
              `👥 Referrals: ${Number(
                updatedUser.referral_count || 0
              ).toLocaleString()}\n\n` +
              `🎁 Daily Bonus: ${DAILY_REWARD} MRX\n` +
              `📺 Ad Reward: ${AD_REWARD} MRX\n` +
              `💱 1000 MRX = 1 USDT`,

            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "⛏️ Open MineRush2026",

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
   HOME
===================================================== */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =====================================================
   HEALTH
===================================================== */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "MineRush2026",
    status: "online",
    time: new Date().toISOString()
  });
});

/* =====================================================
   BOOTSTRAP
===================================================== */

app.post(
  "/api/bootstrap",
  (req, res) => {
    try {
      const tgUser = req.body?.user;

      if (!tgUser?.id) {
        return res.status(400).json({
          ok: false,
          error: "Telegram user is required"
        });
      }

      const user =
        createOrUpdateUser(tgUser);

      const miningUser =
        startMiningIfNeeded(
          user.telegram_id
        );

      res.json({
        ok: true,

        user: miningUser,

        miningRate: MRX_PER_HOUR,

        maxMiningHours:
          MAX_MINING_HOURS,

        adReward: AD_REWARD,

        adWatchSeconds:
          AD_WATCH_SECONDS,

        dailyReward:
          DAILY_REWARD,

        referralBonus:
          REFERRAL_BONUS,

        minWithdraw:
          MIN_WITHDRAW_USDT,

        mrxPerUsdt:
          MRX_PER_USDT
      });
    } catch (error) {
      console.error(
        "Bootstrap error:",
        error
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
        );

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "Telegram ID is required"
        });
      }

      const user =
        claimMining(id);

      res.json({
        ok: true,
        user
      });
    } catch (error) {
      console.error(
        "Mining claim error:",
        error
      );

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
        );

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "Telegram ID is required"
        });
      }

      const user = getUser(id);

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "User not found"
        });
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

      const transaction =
        db.transaction(() => {
          db.prepare(`
            UPDATE users
            SET
              balance = balance + ?,
              last_daily_bonus = ?
            WHERE telegram_id = ?
          `).run(
            DAILY_REWARD,
            day,
            id
          );

          addTransaction(
            id,
            "daily",
            DAILY_REWARD,
            "Daily bonus"
          );
        });

      transaction();

      res.json({
        ok: true,

        amount: DAILY_REWARD,

        user: getUser(id)
      });
    } catch (error) {
      console.error(
        "Daily bonus error:",
        error
      );

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
        );

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "Telegram ID is required"
        });
      }

      const user = getUser(id);

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "User not found"
        });
      }

      /*
         Check cooldown
      */

      const lastReward =
        db.prepare(`
          SELECT created_at
          FROM transactions
          WHERE telegram_id = ?
          AND type = 'ad_reward'
          ORDER BY id DESC
          LIMIT 1
        `).get(id);

      if (lastReward) {
        const elapsed =
          now() -
          Number(lastReward.created_at);

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
              )} minute(s) before watching another ad.`
          });
        }
      }

      /*
         Expire old sessions
      */

      db.prepare(`
        UPDATE ad_sessions
        SET status = 'expired'
        WHERE telegram_id = ?
        AND status = 'active'
      `).run(id);

      /*
         Generate secure token
      */

      const token =
        crypto
          .randomBytes(32)
          .toString("hex");

      const startedAt = now();

      const expiresAt =
        startedAt +
        AD_WATCH_SECONDS * 1000;

      /*
         Save session
      */

      db.prepare(`
        INSERT INTO ad_sessions (
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
      console.error(
        "Ad start error:",
        error
      );

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
        );

      const token =
        String(
          req.body?.token || ""
        );

      if (!id || !token) {
        return res.status(400).json({
          ok: false,
          error: "Invalid ad session"
        });
      }

      const user = getUser(id);

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "User not found"
        });
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
        return res.status(400).json({
          ok: false,
          error: "Ad session not found"
        });
      }

      if (
        session.status !== "active"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "This ad session has already been used"
        });
      }

      const current = now();

      const expiresAt =
        Number(session.expires_at);

      if (current < expiresAt) {
        const remaining =
          Math.ceil(
            (expiresAt - current) / 1000
          );

        return res.status(400).json({
          ok: false,
          error:
            `Please wait ${remaining} more second(s)`
        });
      }

      /*
         Atomic reward transaction
      */

      const transaction =
        db.transaction(() => {
          const update =
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

          if (update.changes !== 1) {
            throw new Error(
              "Ad session already claimed"
            );
          }

          db.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE telegram_id = ?
          `).run(
            AD_REWARD,
            id
          );

          addTransaction(
            id,
            "ad_reward",
            AD_REWARD,
            `Verified ${AD_WATCH_SECONDS}-second ad session`
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
      console.error(
        "Ad claim error:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   DIRECT AD REWARD DISABLED
===================================================== */

app.post(
  "/api/ad/reward",
  (req, res) => {
    res.status(403).json({
      ok: false,
      error:
        "Direct ad reward is disabled"
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
        );

      const user = getUser(id);

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "User not found"
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
        );

      const amount =
        Number(
          req.body?.amount_usdt
        );

      const wallet =
        String(
          req.body?.wallet || ""
        ).trim();

      if (!id) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram ID is required"
        });
      }

      if (!wallet) {
        return res.status(400).json({
          ok: false,
          error:
            "Wallet address is required"
        });
      }

      /*
         Basic TRC20 address validation.
         TRON addresses normally start with T
         and contain 34 characters.
      */

      if (
        !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
          wallet
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid USDT TRC20 wallet address"
        });
      }

      if (
        !Number.isFinite(amount) ||
        amount < MIN_WITHDRAW_USDT
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Minimum withdrawal is ${MIN_WITHDRAW_USDT} USDT`
        });
      }

      const user = getUser(id);

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "User not found"
        });
      }

      const requiredMRX =
        amount * MRX_PER_USDT;

      if (
        Number(user.balance) <
        requiredMRX
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Insufficient MRX balance"
        });
      }

      /*
         Prevent multiple pending
         withdrawals for same user.
      */

      const pending =
        db.prepare(`
          SELECT id
          FROM withdrawals
          WHERE telegram_id = ?
          AND status = 'pending'
          LIMIT 1
        `).get(id);

      if (pending) {
        return res.status(400).json({
          ok: false,
          error:
            "You already have a pending withdrawal"
        });
      }

      const withdrawalId =
        db.transaction(() => {
          const update =
            db.prepare(`
              UPDATE users
              SET balance = balance - ?
              WHERE telegram_id = ?
              AND balance >= ?
            `).run(
              requiredMRX,
              id,
              requiredMRX
            );

          if (update.changes !== 1) {
            throw new Error(
              "Insufficient balance"
            );
          }

          const result =
            db.prepare(`
              INSERT INTO withdrawals (
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

          addTransaction(
            id,
            "withdrawal",
            -requiredMRX,
            `Withdrawal #${result.lastInsertRowid}`
          );

          return result.lastInsertRowid;
        })();

      res.json({
        ok: true,

        withdrawal_id:
          Number(withdrawalId),

        user:
          getUser(id)
      });
    } catch (error) {
      console.error(
        "Withdrawal error:",
        error
      );

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

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      ok: false,
      error:
        "ADMIN_KEY is not configured"
    });
  }

  const provided =
    String(
      req.headers["x-admin-key"] || ""
    );

  if (provided !== ADMIN_KEY) {
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
  requireAdmin,
  (req, res) => {
    try {
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

      const totalMRX =
        db.prepare(`
          SELECT COALESCE(
            SUM(balance), 0
          ) AS total
          FROM users
        `).get().total;

      res.json({
        ok: true,

        users:
          Number(users),

        pendingWithdrawals:
          Number(pending),

        totalMRX:
          Number(totalMRX)
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   ADMIN WITHDRAWALS
===================================================== */

app.get(
  "/api/admin/withdrawals",
  requireAdmin,
  (req, res) => {
    try {
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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =====================================================
   ADMIN WITHDRAWAL STATUS
===================================================== */

app.post(
  "/api/admin/withdrawals/:id/status",
  requireAdmin,
  (req, res) => {
    try {
      const id =
        Number(req.params.id);

      const status =
        String(
          req.body?.status || ""
        );

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid withdrawal ID"
        });
      }

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
            "Invalid withdrawal status"
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
         If rejected, refund MRX.
         Only refund once.
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
              SET balance = balance + ?
              WHERE telegram_id = ?
            `).run(
              refund,
              withdrawal.telegram_id
            );

            addTransaction(
              withdrawal.telegram_id,
              "withdrawal_refund",
              refund,
              `Refund for rejected withdrawal #${id}`
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
        ok: true,

        withdrawal:
          db.prepare(`
            SELECT *
            FROM withdrawals
            WHERE id = ?
          `).get(id)
      });
    } catch (error) {
      console.error(
        "Admin status error:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
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

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use(
  (err, req, res, next) => {
    console.error(
      "Unhandled error:",
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    res.status(500).json({
      ok: false,
      error:
        "Internal server error"
    });
  }
);

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
      "Telegram webhook: configured"
    );

    await setupTelegram();
  }
);
