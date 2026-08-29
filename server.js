"use strict";

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.disable("x-powered-by");

app.use(cors());

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

/* =========================================================
   ENV
========================================================= */

const PORT = Number(process.env.PORT || 10000);

function cleanEnv(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

const BOT_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
const ADMIN_KEY = cleanEnv(process.env.ADMIN_KEY);

const APP_URL =
  cleanEnv(process.env.APP_URL) ||
  "https://minerush2026-1.onrender.com";

const BOT_USERNAME =
  cleanEnv(process.env.BOT_USERNAME)
    .replace(/^@/, "") ||
  "MineRush2026_bot";

const DB_FILE =
  cleanEnv(process.env.DB_FILE) ||
  path.join(__dirname, "minerush.sqlite");

/* =========================================================
   GAME SETTINGS
========================================================= */

const MINING_RATE = 10;
const MINING_CYCLE_SECONDS = 12 * 60 * 60;

const DAILY_BONUS = 100;
const AD_REWARD = 25;
const REFERRAL_BONUS = 500;

const MRX_PER_USDT = 1000;
const MIN_WITHDRAW_USDT = 10;

const AD_WATCH_SECONDS = 30;
const AD_COOLDOWN_MS = 5 * 60 * 1000;

const AD_URL =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";

/* =========================================================
   DATABASE
========================================================= */

const db = new Database(DB_FILE);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  mining_started_at INTEGER,
  mining_last_update INTEGER,
  mining_cycle_ends_at INTEGER,
  last_daily_bonus TEXT,
  referred_by TEXT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  referral_earnings REAL NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount_usdt REAL NOT NULL,
  wallet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE TABLE IF NOT EXISTS ad_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_user
ON transactions(telegram_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
ON withdrawals(telegram_id);

CREATE INDEX IF NOT EXISTS idx_ad_sessions_user
ON ad_sessions(telegram_id);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token
ON admin_sessions(token);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created
ON admin_logs(created_at);
`);

/* =========================================================
   MIGRATION
========================================================= */

function addColumnIfMissing(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all();

  if (!columns.some((x) => x.name === column)) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}

addColumnIfMissing("users", "last_name", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("users", "photo_url", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("users", "mining_last_update", "INTEGER");
addColumnIfMissing("users", "mining_cycle_ends_at", "INTEGER");
addColumnIfMissing("users", "updated_at", "INTEGER");
addColumnIfMissing("users", "referral_count", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "referral_earnings", "REAL NOT NULL DEFAULT 0");
addColumnIfMissing("users", "blocked", "INTEGER NOT NULL DEFAULT 0");

/* =========================================================
   HELPERS
========================================================= */

function now() {
  return Date.now();
}

function roundNumber(value, decimals = 8) {
  const n = Number(value);

  if (!Number.isFinite(n)) return 0;

  const factor = 10 ** decimals;

  return Math.round(n * factor) / factor;
}

function getUser(id) {
  return db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
      `
    )
    .get(String(id));
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: Number(user.id),
    uid: String(user.telegram_id),
    telegram_id: String(user.telegram_id),
    username: user.username || "",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    photo_url: user.photo_url || "",
    balance: roundNumber(user.balance || 0),

    mining_started_at:
      user.mining_started_at
        ? Number(user.mining_started_at)
        : null,

    mining_last_update:
      user.mining_last_update
        ? Number(user.mining_last_update)
        : null,

    mining_cycle_ends_at:
      user.mining_cycle_ends_at
        ? Number(user.mining_cycle_ends_at)
        : null,

    last_daily_bonus:
      user.last_daily_bonus || null,

    referral_count:
      Number(user.referral_count || 0),

    referral_earnings:
      roundNumber(user.referral_earnings || 0),

    blocked:
      Boolean(user.blocked),

    created_at:
      Number(user.created_at || 0),

    updated_at:
      Number(user.updated_at || 0)
  };
}

/* =========================================================
   USER CREATE / UPDATE
========================================================= */

function createOrUpdateUser(tgUser) {
  if (!tgUser?.id) {
    throw new Error("Telegram user not found");
  }

  const telegramId = String(tgUser.id);

  const username = String(tgUser.username || "");
  const firstName = String(tgUser.first_name || "Miner");
  const lastName = String(tgUser.last_name || "");
  const photoUrl = String(tgUser.photo_url || "");

  const existing = getUser(telegramId);

  if (!existing) {
    const timestamp = now();

    db.prepare(
      `
      INSERT INTO users (
        telegram_id,
        username,
        first_name,
        last_name,
        photo_url,
        balance,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `
    ).run(
      telegramId,
      username,
      firstName,
      lastName,
      photoUrl,
      timestamp,
      timestamp
    );
  } else {
    db.prepare(
      `
      UPDATE users
      SET
        username = ?,
        first_name = ?,
        last_name = ?,
        photo_url = ?,
        updated_at = ?
      WHERE telegram_id = ?
      `
    ).run(
      username,
      firstName,
      lastName,
      photoUrl,
      now(),
      telegramId
    );
  }

  return getUser(telegramId);
}

/* =========================================================
   TELEGRAM AUTH
========================================================= */

function verifyTelegram(initData) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  if (!initData) {
    throw new Error("Telegram initData is required");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram hash is missing");
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (
    receivedHash.length !== calculatedHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(receivedHash, "hex"),
      Buffer.from(calculatedHash, "hex")
    )
  ) {
    throw new Error("Invalid Telegram initData");
  }

  const authDate = Number(params.get("auth_date"));

  if (!Number.isFinite(authDate)) {
    throw new Error("Invalid Telegram auth_date");
  }

  const age =
    Math.floor(Date.now() / 1000) - authDate;

  if (age < -60 || age > 86400) {
    throw new Error("Telegram initData expired");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("Telegram user data missing");
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error("Invalid Telegram user JSON");
  }

  if (!user.id) {
    throw new Error("Telegram user ID missing");
  }

  return {
    user,
    startParam: params.get("start_param") || ""
  };
}

function authenticate(req) {
  return verifyTelegram(
    String(req.body?.initData || "").trim()
  );
}

/* =========================================================
   REFERRAL
========================================================= */

function processReferral(newUserId, startParam) {
  if (!startParam) return false;

  const newId = String(newUserId);
  const newUser = getUser(newId);

  if (!newUser || newUser.referred_by) {
    return false;
  }

  let referrerId = String(startParam).trim();

  if (referrerId.startsWith("ref_")) {
    referrerId = referrerId.substring(4);
  }

  if (!/^\d+$/.test(referrerId)) return false;
  if (referrerId === newId) return false;

  const referrer = getUser(referrerId);

  if (!referrer || referrer.blocked) {
    return false;
  }

  return db.transaction(() => {
    const updated = db
      .prepare(
        `
        UPDATE users
        SET
          referred_by = ?,
          updated_at = ?
        WHERE telegram_id = ?
        AND referred_by IS NULL
        `
      )
      .run(referrerId, now(), newId);

    if (updated.changes !== 1) {
      return false;
    }

    db.prepare(
      `
      UPDATE users
      SET
        balance = balance + ?,
        referral_count = referral_count + 1,
        referral_earnings = referral_earnings + ?,
        updated_at = ?
      WHERE telegram_id = ?
      `
    ).run(
      REFERRAL_BONUS,
      REFERRAL_BONUS,
      now(),
      referrerId
    );

    db.prepare(
      `
      INSERT INTO transactions
      (telegram_id, type, amount, note, created_at)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(
      referrerId,
      "referral",
      REFERRAL_BONUS,
      `Referral from ${newId}`,
      now()
    );

    return true;
  })();
}

/* =========================================================
   MINING
========================================================= */

function startMining(telegramId) {
  const user = getUser(telegramId);

  if (!user) throw new Error("User not found");

  if (user.blocked) {
    throw new Error("Account is blocked");
  }

  if (user.mining_started_at) {
    return user;
  }

  const timestamp = now();

  const endTime =
    timestamp +
    MINING_CYCLE_SECONDS * 1000;

  db.prepare(
    `
    UPDATE users
    SET
      mining_started_at = ?,
      mining_last_update = ?,
      mining_cycle_ends_at = ?,
      updated_at = ?
    WHERE telegram_id = ?
    AND mining_started_at IS NULL
    `
  ).run(
    timestamp,
    timestamp,
    endTime,
    timestamp,
    telegramId
  );

  return getUser(telegramId);
}

function settleMining(telegramId) {
  const user = getUser(telegramId);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.blocked) {
    throw new Error("Account is blocked");
  }

  if (
    !user.mining_started_at ||
    !user.mining_last_update
  ) {
    return user;
  }

  const current = now();

  const lastUpdate =
    Number(user.mining_last_update);

  const cycleEnd =
    Number(
      user.mining_cycle_ends_at ||
      Number(user.mining_started_at) +
      MINING_CYCLE_SECONDS * 1000
    );

  const effectiveNow =
    Math.min(current, cycleEnd);

  const elapsedMs =
    Math.max(
      0,
      effectiveNow - lastUpdate
    );

  if (elapsedMs <= 0) {
    return user;
  }

  const reward = roundNumber(
    (elapsedMs / 1000 / 3600) *
    MINING_RATE
  );

  const finished =
    effectiveNow >= cycleEnd;

  db.transaction(() => {
    const updated = db
      .prepare(
        `
        UPDATE users
        SET
          balance = balance + ?,
          mining_last_update = ?,
          mining_started_at =
            CASE
              WHEN ? = 1 THEN NULL
              ELSE mining_started_at
            END,
          mining_cycle_ends_at =
            CASE
              WHEN ? = 1 THEN NULL
              ELSE mining_cycle_ends_at
            END,
          updated_at = ?
        WHERE telegram_id = ?
        AND mining_last_update = ?
        `
      )
      .run(
        reward,
        effectiveNow,
        finished ? 1 : 0,
        finished ? 1 : 0,
        current,
        telegramId,
        lastUpdate
      );

    if (updated.changes === 1 && reward > 0) {
      db.prepare(
        `
        INSERT INTO transactions
        (telegram_id, type, amount, note, created_at)
        VALUES (?, ?, ?, ?, ?)
        `
      ).run(
        telegramId,
        "mining",
        reward,
        finished
          ? "Mining cycle completed"
          : "Mining reward",
        current
      );
    }
  })();

  return getUser(telegramId);
}

/* =========================================================
   FRONTEND
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/app.js", (req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "MineRush2026",
    status: "online",
    telegramConfigured: Boolean(BOT_TOKEN),
    adminConfigured: Boolean(ADMIN_KEY)
  });
});

/* =========================================================
   BOOTSTRAP
========================================================= */

app.post("/api/bootstrap", (req, res) => {
  try {
    const auth = authenticate(req);

    let user = createOrUpdateUser(auth.user);

    if (user.blocked) {
      throw new Error("Account is blocked");
    }

    if (auth.startParam && !user.referred_by) {
      processReferral(
        user.telegram_id,
        auth.startParam
      );

      user = getUser(user.telegram_id);
    }

    user = settleMining(user.telegram_id);

    if (!user.mining_started_at) {
      user = startMining(user.telegram_id);
    }

    res.json({
      ok: true,
      user: publicUser(user),

      settings: {
        miningRate: MINING_RATE,
        miningCycleHours: 12,
        miningCycleSeconds: MINING_CYCLE_SECONDS,
        dailyBonus: DAILY_BONUS,
        adReward: AD_REWARD,
        referralBonus: REFERRAL_BONUS,
        minWithdrawUSDT: MIN_WITHDRAW_USDT,
        mrxPerUSDT: MRX_PER_USDT,
        adWatchSeconds: AD_WATCH_SECONDS
      }
    });
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   MINING
========================================================= */

app.post("/api/mining/claim", (req, res) => {
  try {
    const auth = authenticate(req);

    const user = createOrUpdateUser(auth.user);

    let updated = settleMining(user.telegram_id);

    if (!updated.mining_started_at) {
      updated = startMining(user.telegram_id);
    }

    res.json({
      ok: true,
      user: publicUser(updated)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

app.post("/api/mining/status", (req, res) => {
  try {
    const auth = authenticate(req);

    const user = createOrUpdateUser(auth.user);

    const updated = settleMining(user.telegram_id);

    res.json({
      ok: true,
      user: publicUser(updated)
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   DAILY
========================================================= */

function bangladeshDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Dhaka"
    }
  ).format(new Date());
}

app.post("/api/daily", (req, res) => {
  try {
    const auth = authenticate(req);

    const user = createOrUpdateUser(auth.user);

    if (user.blocked) {
      throw new Error("Account is blocked");
    }

    const today = bangladeshDate();

    if (user.last_daily_bonus === today) {
      return res.json({
        ok: false,
        error: "Daily bonus already claimed",
        user: publicUser(user)
      });
    }

    const timestamp = now();

    db.transaction(() => {
      db.prepare(
        `
        UPDATE users
        SET
          balance = balance + ?,
          last_daily_bonus = ?,
          updated_at = ?
        WHERE telegram_id = ?
        `
      ).run(
        DAILY_BONUS,
        today,
        timestamp,
        user.telegram_id
      );

      db.prepare(
        `
        INSERT INTO transactions
        (telegram_id, type, amount, note, created_at)
        VALUES (?, ?, ?, ?, ?)
        `
      ).run(
        user.telegram_id,
        "daily",
        DAILY_BONUS,
        "Daily bonus",
        timestamp
      );
    })();

    res.json({
      ok: true,
      amount: DAILY_BONUS,
      user: publicUser(
        getUser(user.telegram_id)
      )
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   AD START
========================================================= */

app.post("/api/ad/start", (req, res) => {
  try {
    const auth = authenticate(req);

    const user = createOrUpdateUser(auth.user);

    if (user.blocked) {
      throw new Error("Account is blocked");
    }

    const lastAd = db
      .prepare(
        `
        SELECT created_at
        FROM transactions
        WHERE telegram_id = ?
        AND type = 'ad_reward'
        ORDER BY id DESC
        LIMIT 1
        `
      )
      .get(user.telegram_id);

    if (lastAd) {
      const elapsed =
        now() - Number(lastAd.created_at);

      if (elapsed < AD_COOLDOWN_MS) {
        const remaining = Math.ceil(
          (AD_COOLDOWN_MS - elapsed) / 1000
        );

        return res.json({
          ok: false,
          cooldown: true,
          remainingSeconds: remaining,
          error:
            `Please wait ${remaining} seconds`
        });
      }
    }

    db.prepare(
      `
      UPDATE ad_sessions
      SET status = 'expired'
      WHERE telegram_id = ?
      AND status = 'active'
      `
    ).run(user.telegram_id);

    const token =
      crypto.randomBytes(32).toString("hex");

    const startedAt = now();

    const expiresAt =
      startedAt +
      AD_WATCH_SECONDS * 1000;

    db.prepare(
      `
      INSERT INTO ad_sessions
      (telegram_id, token, started_at, expires_at, status)
      VALUES (?, ?, ?, ?, 'active')
      `
    ).run(
      user.telegram_id,
      token,
      startedAt,
      expiresAt
    );

    res.json({
      ok: true,
      token,
      startedAt,
      expiresAt,
      watchSeconds: AD_WATCH_SECONDS,
      reward: AD_REWARD,
      adUrl: AD_URL
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   AD CLAIM
========================================================= */

app.post("/api/ad/claim", (req, res) => {
  try {
    const auth = authenticate(req);

    const token =
      String(req.body?.token || "").trim();

    if (!token) {
      throw new Error("Ad session token missing");
    }

    const user = createOrUpdateUser(auth.user);

    if (user.blocked) {
      throw new Error("Account is blocked");
    }

    const session = db
      .prepare(
        `
        SELECT *
        FROM ad_sessions
        WHERE token = ?
        AND telegram_id = ?
        LIMIT 1
        `
      )
      .get(
        token,
        user.telegram_id
      );

    if (!session) {
      throw new Error("Ad session not found");
    }

    if (session.status !== "active") {
      throw new Error("Ad session already used");
    }

    const current = now();

    if (current < Number(session.expires_at)) {
      const remaining = Math.ceil(
        (Number(session.expires_at) - current) / 1000
      );

      throw new Error(
        `Please wait ${remaining} seconds`
      );
    }

    db.transaction(() => {
      const updated = db
        .prepare(
          `
          UPDATE ad_sessions
          SET
            status = 'claimed',
            claimed_at = ?
          WHERE id = ?
          AND status = 'active'
          `
        )
        .run(current, session.id);

      if (updated.changes !== 1) {
        throw new Error("Ad session already claimed");
      }

      db.prepare(
        `
        UPDATE users
        SET
          balance = balance + ?,
          updated_at = ?
        WHERE telegram_id = ?
        `
      ).run(
        AD_REWARD,
        current,
        user.telegram_id
      );

      db.prepare(
        `
        INSERT INTO transactions
        (telegram_id, type, amount, note, created_at)
        VALUES (?, ?, ?, ?, ?)
        `
      ).run(
        user.telegram_id,
        "ad_reward",
        AD_REWARD,
        "Ad reward",
        current
      );
    })();

    res.json({
      ok: true,
      amount: AD_REWARD,
      user: publicUser(
        getUser(user.telegram_id)
      )
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   REFERRAL
========================================================= */

app.post("/api/referral", (req, res) => {
  try {
    const auth = authenticate(req);

    const user = createOrUpdateUser(auth.user);

    res.json({
      ok: true,
      uid: user.telegram_id,
      referralCount:
        Number(user.referral_count || 0),
      referralEarnings:
        roundNumber(user.referral_earnings || 0),
      referralBonus: REFERRAL_BONUS,
      referralLink:
        `https://t.me/${BOT_USERNAME}?start=ref_${user.telegram_id}`
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   WITHDRAW
========================================================= */

function validTRC20(wallet) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet);
}

app.post("/api/withdraw", (req, res) => {
  try {
    const auth = authenticate(req);

    const user = createOrUpdateUser(auth.user);

    if (user.blocked) {
      throw new Error("Account is blocked");
    }

    const amount =
      Number(req.body?.amount_usdt);

    const wallet =
      String(req.body?.wallet || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid withdrawal amount");
    }

    if (amount < MIN_WITHDRAW_USDT) {
      throw new Error(
        `Minimum withdrawal is ${MIN_WITHDRAW_USDT} USDT`
      );
    }

    if (!validTRC20(wallet)) {
      throw new Error("Invalid TRC20 wallet address");
    }

    const requiredMRX =
      roundNumber(amount * MRX_PER_USDT);

    const withdrawalId =
      db.transaction(() => {
        const updated = db
          .prepare(
            `
            UPDATE users
            SET
              balance = balance - ?,
              updated_at = ?
            WHERE telegram_id = ?
            AND balance >= ?
            AND blocked = 0
            `
          )
          .run(
            requiredMRX,
            now(),
            user.telegram_id,
            requiredMRX
          );

        if (updated.changes !== 1) {
          throw new Error("Insufficient MRX balance");
        }

        const result = db
          .prepare(
            `
            INSERT INTO withdrawals
            (telegram_id, amount_usdt, wallet, status, created_at)
            VALUES (?, ?, ?, 'pending', ?)
            `
          )
          .run(
            user.telegram_id,
            amount,
            wallet,
            now()
          );

        db.prepare(
          `
          INSERT INTO transactions
          (telegram_id, type, amount, note, created_at)
          VALUES (?, ?, ?, ?, ?)
          `
        ).run(
          user.telegram_id,
          "withdrawal",
          -requiredMRX,
          `Withdrawal #${result.lastInsertRowid}`,
          now()
        );

        return Number(result.lastInsertRowid);
      })();

    res.json({
      ok: true,
      withdrawal_id: withdrawalId,
      status: "pending",
      amount_usdt: amount,
      required_mrx: requiredMRX,
      user: publicUser(
        getUser(user.telegram_id)
      )
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   TRANSACTIONS
========================================================= */

app.post("/api/transactions", (req, res) => {
  try {
    const auth = authenticate(req);

    const user = createOrUpdateUser(auth.user);

    const items = db
      .prepare(
        `
        SELECT
          id,
          type,
          amount,
          note,
          created_at
        FROM transactions
        WHERE telegram_id = ?
        ORDER BY id DESC
        LIMIT 100
        `
      )
      .all(user.telegram_id);

    res.json({
      ok: true,
      uid: user.telegram_id,
      items
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   ADMIN SECURITY
========================================================= */

const ADMIN_SESSION_MS =
  12 * 60 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 8;

const loginAttempts = new Map();

function getClientKey(req) {
  return String(
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown"
  ).split(",")[0].trim();
}

function cleanExpiredAdminSessions() {
  db.prepare(
    `
    DELETE FROM admin_sessions
    WHERE expires_at < ?
    `
  ).run(now());
}

function createAdminSession() {
  cleanExpiredAdminSessions();

  const token =
    crypto.randomBytes(48).toString("hex");

  const timestamp = now();

  db.prepare(
    `
    INSERT INTO admin_sessions
    (token, created_at, expires_at, last_used_at)
    VALUES (?, ?, ?, ?)
    `
  ).run(
    token,
    timestamp,
    timestamp + ADMIN_SESSION_MS,
    timestamp
  );

  return token;
}

function verifyAdminSession(token) {
  if (!token) return false;

  const session = db
    .prepare(
      `
      SELECT *
      FROM admin_sessions
      WHERE token = ?
      LIMIT 1
      `
    )
    .get(token);

  if (!session) return false;

  if (Number(session.expires_at) < now()) {
    db.prepare(
      `DELETE FROM admin_sessions WHERE id = ?`
    ).run(session.id);

    return false;
  }

  db.prepare(
    `
    UPDATE admin_sessions
    SET last_used_at = ?
    WHERE id = ?
    `
  ).run(now(), session.id);

  return true;
}

function adminLog(action, target = "", details = "") {
  try {
    db.prepare(
      `
      INSERT INTO admin_logs
      (action, target, details, created_at)
      VALUES (?, ?, ?, ?)
      `
    ).run(
      String(action),
      String(target),
      String(details),
      now()
    );
  } catch {}
}

function requireAdmin(req, res, next) {
  cleanExpiredAdminSessions();

  const token =
    String(
      req.headers["x-admin-session"] || ""
    ).trim();

  if (!verifyAdminSession(token)) {
    return res.status(401).json({
      ok: false,
      error: "Admin session expired or unauthorized"
    });
  }

  next();
}

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post("/api/admin/login", (req, res) => {
  try {
    if (!ADMIN_KEY) {
      return res.status(503).json({
        ok: false,
        error: "ADMIN_KEY is not configured"
      });
    }

    const client = getClientKey(req);

    const record =
      loginAttempts.get(client) || {
        count: 0,
        blockedUntil: 0
      };

    if (record.blockedUntil > now()) {
      const seconds = Math.ceil(
        (record.blockedUntil - now()) / 1000
      );

      return res.status(429).json({
        ok: false,
        error:
          `Too many attempts. Try again in ${seconds} seconds.`
      });
    }

    const supplied =
      String(req.body?.key || "").trim();

    const a = Buffer.from(supplied, "utf8");
    const b = Buffer.from(ADMIN_KEY, "utf8");

    const valid =
      a.length === b.length &&
      crypto.timingSafeEqual(a, b);

    if (!valid) {
      record.count++;

      if (record.count >= MAX_LOGIN_ATTEMPTS) {
        record.blockedUntil =
          now() + 10 * 60 * 1000;
        record.count = 0;
      }

      loginAttempts.set(client, record);

      adminLog(
        "login_failed",
        client,
        "Invalid admin key"
      );

      return res.status(401).json({
        ok: false,
        error: "Invalid ADMIN_KEY"
      });
    }

    loginAttempts.delete(client);

    const session =
      createAdminSession();

    adminLog(
      "login_success",
      client,
      "Admin login"
    );

    res.json({
      ok: true,
      session,
      expiresIn: ADMIN_SESSION_MS
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Admin login failed"
    });
  }
});

/* =========================================================
   ADMIN LOGOUT
========================================================= */

app.post(
  "/api/admin/logout",
  requireAdmin,
  (req, res) => {
    const token =
      String(
        req.headers["x-admin-session"] || ""
      ).trim();

    db.prepare(
      `
      DELETE FROM admin_sessions
      WHERE token = ?
      `
    ).run(token);

    adminLog(
      "logout",
      "",
      "Admin logout"
    );

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   ADMIN TEST
========================================================= */

app.get(
  "/api/admin/test",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,
      message: "Admin authentication working"
    });
  }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
  "/api/admin/stats",
  requireAdmin,
  (req, res) => {
    try {
      const users =
        db.prepare(
          `SELECT COUNT(*) AS count FROM users`
        ).get().count;

      const blockedUsers =
        db.prepare(
          `SELECT COUNT(*) AS count FROM users WHERE blocked = 1`
        ).get().count;

      const pending =
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM withdrawals
          WHERE status = 'pending'
          `
        ).get().count;

      const totalMRX =
        db.prepare(
          `
          SELECT COALESCE(SUM(balance),0) AS total
          FROM users
          `
        ).get().total;

      const paidUSDT =
        db.prepare(
          `
          SELECT COALESCE(SUM(amount_usdt),0) AS total
          FROM withdrawals
          WHERE status = 'paid'
          `
        ).get().total;

      const rejected =
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM withdrawals
          WHERE status = 'rejected'
          `
        ).get().count;

      const totalWithdrawals =
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM withdrawals
          `
        ).get().count;

      res.json({
        ok: true,
        users: Number(users || 0),
        blockedUsers: Number(blockedUsers || 0),
        pendingWithdrawals: Number(pending || 0),
        totalMRX: roundNumber(totalMRX || 0),
        totalPaidUSDT: roundNumber(paidUSDT || 0),
        rejectedWithdrawals: Number(rejected || 0),
        totalWithdrawals: Number(totalWithdrawals || 0)
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
  "/api/admin/users",
  requireAdmin,
  (req, res) => {
    try {
      const search =
        String(req.query.search || "").trim();

      let users;

      if (search) {
        const pattern = `%${search}%`;

        users = db
          .prepare(
            `
            SELECT
              id,
              telegram_id,
              username,
              first_name,
              last_name,
              balance,
              mining_started_at,
              mining_cycle_ends_at,
              referral_count,
              referral_earnings,
              referred_by,
              blocked,
              created_at,
              updated_at
            FROM users
            WHERE
              telegram_id LIKE ?
              OR username LIKE ?
              OR first_name LIKE ?
              OR last_name LIKE ?
            ORDER BY id DESC
            LIMIT 1000
            `
          )
          .all(
            pattern,
            pattern,
            pattern,
            pattern
          );
      } else {
        users = db
          .prepare(
            `
            SELECT
              id,
              telegram_id,
              username,
              first_name,
              last_name,
              balance,
              mining_started_at,
              mining_cycle_ends_at,
              referral_count,
              referral_earnings,
              referred_by,
              blocked,
              created_at,
              updated_at
            FROM users
            ORDER BY id DESC
            LIMIT 1000
            `
          )
          .all();
      }

      res.json({
        ok: true,
        users
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   ADMIN USER DETAILS
========================================================= */

app.get(
  "/api/admin/users/:telegramId",
  requireAdmin,
  (req, res) => {
    try {
      const id =
        String(req.params.telegramId);

      const user = getUser(id);

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "User not found"
        });
      }

      const transactions =
        db.prepare(
          `
          SELECT *
          FROM transactions
          WHERE telegram_id = ?
          ORDER BY id DESC
          LIMIT 100
          `
        ).all(id);

      const withdrawals =
        db.prepare(
          `
          SELECT *
          FROM withdrawals
          WHERE telegram_id = ?
          ORDER BY id DESC
          LIMIT 100
          `
        ).all(id);

      res.json({
        ok: true,
        user,
        transactions,
        withdrawals
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   ADMIN BALANCE
========================================================= */

app.post(
  "/api/admin/users/:telegramId/balance",
  requireAdmin,
  (req, res) => {
    try {
      const telegramId =
        String(req.params.telegramId);

      const amount =
        Number(req.body?.amount);

      const note =
        String(
          req.body?.note ||
          "Admin balance adjustment"
        ).trim();

      if (
        !Number.isFinite(amount) ||
        amount === 0
      ) {
        throw new Error(
          "Amount must be a valid non-zero number"
        );
      }

      const user = getUser(telegramId);

      if (!user) {
        throw new Error("User not found");
      }

      db.transaction(() => {
        const updated =
          db.prepare(
            `
            UPDATE users
            SET
              balance = balance + ?,
              updated_at = ?
            WHERE telegram_id = ?
            `
          ).run(
            amount,
            now(),
            telegramId
          );

        if (updated.changes !== 1) {
          throw new Error("Balance update failed");
        }

        db.prepare(
          `
          INSERT INTO transactions
          (telegram_id, type, amount, note, created_at)
          VALUES (?, ?, ?, ?, ?)
          `
        ).run(
          telegramId,
          amount > 0
            ? "admin_credit"
            : "admin_debit",
          amount,
          note,
          now()
        );
      })();

      adminLog(
        "balance_adjustment",
        telegramId,
        `${amount} MRX - ${note}`
      );

      res.json({
        ok: true,
        user: getUser(telegramId)
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   ADMIN BLOCK / UNBLOCK
========================================================= */

app.post(
  "/api/admin/users/:telegramId/block",
  requireAdmin,
  (req, res) => {
    try {
      const telegramId =
        String(req.params.telegramId);

      const blocked =
        Boolean(req.body?.blocked);

      const user = getUser(telegramId);

      if (!user) {
        throw new Error("User not found");
      }

      db.prepare(
        `
        UPDATE users
        SET
          blocked = ?,
          updated_at = ?
        WHERE telegram_id = ?
        `
      ).run(
        blocked ? 1 : 0,
        now(),
        telegramId
      );

      adminLog(
        blocked ? "user_blocked" : "user_unblocked",
        telegramId,
        blocked
          ? "User blocked"
          : "User unblocked"
      );

      res.json({
        ok: true,
        blocked
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  requireAdmin,
  (req, res) => {
    try {
      const status =
        String(req.query.status || "all");

      let items;

      if (
        ["pending", "paid", "rejected"].includes(status)
      ) {
        items = db
          .prepare(
            `
            SELECT
              w.*,
              u.username,
              u.first_name,
              u.last_name
            FROM withdrawals w
            LEFT JOIN users u
              ON u.telegram_id = w.telegram_id
            WHERE w.status = ?
            ORDER BY w.id DESC
            LIMIT 1000
            `
          )
          .all(status);
      } else {
        items = db
          .prepare(
            `
            SELECT
              w.*,
              u.username,
              u.first_name,
              u.last_name
            FROM withdrawals w
            LEFT JOIN users u
              ON u.telegram_id = w.telegram_id
            ORDER BY w.id DESC
            LIMIT 1000
            `
          )
          .all();
      }

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

/* =========================================================
   ADMIN WITHDRAWAL STATUS
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/status",
  requireAdmin,
  (req, res) => {
    try {
      const id =
        Number(req.params.id);

      const status =
        String(req.body?.status || "").trim();

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        throw new Error(
          "Invalid withdrawal ID"
        );
      }

      if (
        status !== "paid" &&
        status !== "rejected"
      ) {
        throw new Error(
          "Status must be paid or rejected"
        );
      }

      const withdrawal =
        db.prepare(
          `
          SELECT *
          FROM withdrawals
          WHERE id = ?
          LIMIT 1
          `
        ).get(id);

      if (!withdrawal) {
        throw new Error(
          "Withdrawal not found"
        );
      }

      if (withdrawal.status !== "pending") {
        throw new Error(
          `Withdrawal already ${withdrawal.status}`
        );
      }

      db.transaction(() => {
        if (status === "rejected") {
          const refund =
            roundNumber(
              Number(withdrawal.amount_usdt) *
              MRX_PER_USDT
            );

          db.prepare(
            `
            UPDATE users
            SET
              balance = balance + ?,
              updated_at = ?
            WHERE telegram_id = ?
            `
          ).run(
            refund,
            now(),
            withdrawal.telegram_id
          );

          db.prepare(
            `
            INSERT INTO transactions
            (telegram_id, type, amount, note, created_at)
            VALUES (?, ?, ?, ?, ?)
            `
          ).run(
            withdrawal.telegram_id,
            "withdrawal_refund",
            refund,
            `Refund #${id}`,
            now()
          );
        }

        db.prepare(
          `
          UPDATE withdrawals
          SET
            status = ?,
            processed_at = ?
          WHERE id = ?
          AND status = 'pending'
          `
        ).run(
          status,
          now(),
          id
        );
      })();

      adminLog(
        `withdrawal_${status}`,
        String(id),
        `Withdrawal ${id} marked ${status}`
      );

      res.json({
        ok: true,
        withdrawal_id: id,
        status
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   ADMIN TRANSACTIONS
========================================================= */

app.get(
  "/api/admin/transactions",
  requireAdmin,
  (req, res) => {
    try {
      const items =
        db.prepare(
          `
          SELECT *
          FROM transactions
          ORDER BY id DESC
          LIMIT 1000
          `
        ).all();

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

/* =========================================================
   ADMIN LOGS
========================================================= */

app.get(
  "/api/admin/logs",
  requireAdmin,
  (req, res) => {
    try {
      const items =
        db.prepare(
          `
          SELECT *
          FROM admin_logs
          ORDER BY id DESC
          LIMIT 500
          `
        ).all();

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

/* =========================================================
   TELEGRAM API
========================================================= */

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
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      "Telegram API error"
    );
  }

  return data;
}

async function checkTelegramToken() {
  if (!BOT_TOKEN) {
    console.log(
      "⚠️ TELEGRAM_BOT_TOKEN not configured"
    );

    return false;
  }

  try {
    const result =
      await telegram("getMe", {});

    console.log(
      `✅ Telegram bot connected: @${result.result.username || "unknown"}`
    );

    return true;
  } catch (error) {
    console.error(
      "❌ Telegram Bot Token invalid:",
      error.message
    );

    return false;
  }
}

/* =========================================================
   WEBHOOK
========================================================= */

app.post(
  "/telegram/webhook",
  async (req, res) => {
    res.sendStatus(200);

    try {
      if (!BOT_TOKEN) return;

      const message =
        req.body?.message;

      if (!message) return;

      const tgUser =
        message.from;

      if (!tgUser?.id) return;

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

        const startParam =
          parts.length > 1
            ? parts[1]
            : "";

        let user =
          createOrUpdateUser(
            tgUser
          );

        if (user.blocked) {
          await telegram(
            "sendMessage",
            {
              chat_id: tgUser.id,
              text:
                "🚫 Your MineRush2026 account is currently blocked."
            }
          );

          return;
        }

        if (
          startParam &&
          !user.referred_by
        ) {
          processReferral(
            user.telegram_id,
            startParam
          );

          user =
            getUser(
              user.telegram_id
            );
        }

        if (
          !user.mining_started_at
        ) {
          user =
            startMining(
              user.telegram_id
            );
        }

        await telegram(
          "sendMessage",
          {
            chat_id:
              tgUser.id,

            text:
              `👋 Welcome to MineRush2026!\n\n` +
              `🆔 UID: ${user.telegram_id}\n` +
              `⛏️ Mining: ${MINING_RATE} MRX/hour\n` +
              `🎁 Daily: ${DAILY_BONUS} MRX\n` +
              `📺 Ad: ${AD_REWARD} MRX\n` +
              `👥 Referral: ${REFERRAL_BONUS} MRX\n` +
              `💱 ${MRX_PER_USDT} MRX = 1 USDT\n\n` +
              `💰 Balance: ${Number(
                user.balance || 0
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
      }
    } catch (error) {
      console.error(
        "Webhook error:",
        error.message
      );
    }
  }
);

/* =========================================================
   WEBHOOK SETUP
========================================================= */

async function setupWebhook() {
  if (!BOT_TOKEN) {
    console.log(
      "⚠️ Webhook skipped: TELEGRAM_BOT_TOKEN not configured"
    );

    return;
  }

  try {
    const valid =
      await checkTelegramToken();

    if (!valid) return;

    const webhookUrl =
      `${APP_URL}/telegram/webhook`;

    await telegram(
      "setWebhook",
      {
        url: webhookUrl,
        allowed_updates: ["message"]
      }
    );

    console.log(
      "✅ Telegram webhook configured"
    );

    console.log(
      "Webhook URL:",
      webhookUrl
    );
  } catch (error) {
    console.error(
      "❌ Webhook setup failed:",
      error.message
    );
  }
}

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error: "Not Found"
    });
  }
);

/* =========================================================
   ERROR
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "Server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      ok: false,
      error: "Internal server error"
    });
  }
);

/* =========================================================
   START
========================================================= */

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    async () => {
      console.log(
        "================================"
      );

      console.log(
        `🚀 MineRush2026 running on port ${PORT}`
      );

      console.log(
        `Database: ${DB_FILE}`
      );

      console.log(
        `Admin key: ${
          ADMIN_KEY
            ? "CONFIGURED"
            : "NOT CONFIGURED"
        }`
      );

      console.log(
        `Telegram: ${
          BOT_TOKEN
            ? "CONFIGURED"
            : "NOT CONFIGURED"
        }`
      );

      console.log(
        `Mining: ${MINING_RATE} MRX/hour`
      );

      console.log(
        "Mining cycle: 12 hours"
      );

      console.log(
        `Daily: ${DAILY_BONUS} MRX`
      );

      console.log(
        `Ad: ${AD_REWARD} MRX`
      );

      console.log(
        `Referral: ${REFERRAL_BONUS} MRX`
      );

      console.log(
        `Withdraw: ${MIN_WITHDRAW_USDT} USDT minimum`
      );

      console.log(
        "================================"
      );

      await setupWebhook();
    }
  );

/* =========================================================
   SHUTDOWN
========================================================= */

function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(() => {
    try {
      db.close();
    } catch {}

    process.exit(0);
  });
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
