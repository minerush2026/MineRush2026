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

const PORT = Number(process.env.PORT || 10000);

const BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || ""
).trim();

const ADMIN_KEY = String(
  process.env.ADMIN_KEY || ""
).trim();

const APP_URL = String(
  process.env.APP_URL ||
    "https://minerush2026-1.onrender.com"
).replace(/\/+$/, "");

const BOT_USERNAME = String(
  process.env.BOT_USERNAME || "MineRush2026_bot"
).replace(/^@/, "");

const DB_FILE = String(
  process.env.DB_FILE || "./minerush.sqlite"
);

/* =========================
   GAME SETTINGS
========================= */

const MINING_RATE = 10;
const DAILY_BONUS = 100;
const AD_REWARD = 25;
const REFERRAL_BONUS = 500;

const MRX_PER_USDT = 1000;
const MIN_WITHDRAW_USDT = 10;

const MINING_CYCLE_SECONDS = 12 * 60 * 60;
const AD_WATCH_SECONDS = 30;
const AD_COOLDOWN_MS = 5 * 60 * 1000;

/* =========================
   AD URL
========================= */

const AD_URL =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";

/* =========================
   EXPRESS
========================= */

app.disable("x-powered-by");

app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: false
  })
);

/* =========================
   DATABASE
========================= */

const db = new Database(DB_FILE);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  photo_url TEXT DEFAULT '',
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

/* =========================
   HELPERS
========================= */

function currentTime() {
  return Date.now();
}

function getUser(telegramId) {
  return db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
      `
    )
    .get(String(telegramId));
}

function createUser(tgUser) {
  if (!tgUser || !tgUser.id) {
    throw new Error("Telegram user not found");
  }

  const telegramId = String(tgUser.id);

  const username = String(
    tgUser.username || ""
  );

  const firstName = String(
    tgUser.first_name || "Miner"
  );

  const photoUrl = String(
    tgUser.photo_url || ""
  );

  let user = getUser(telegramId);

  if (!user) {
    db.prepare(
      `
      INSERT INTO users (
        telegram_id,
        username,
        first_name,
        photo_url,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(
      telegramId,
      username,
      firstName,
      photoUrl,
      currentTime()
    );
  } else {
    db.prepare(
      `
      UPDATE users
      SET
        username = ?,
        first_name = ?,
        photo_url = ?
      WHERE telegram_id = ?
      `
    ).run(
      username,
      firstName,
      photoUrl,
      telegramId
    );
  }

  user = getUser(telegramId);

  return user;
}

/* =========================
   TELEGRAM AUTH
========================= */

function verifyTelegram(initData) {
  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  if (!initData) {
    throw new Error(
      "Telegram initData is required"
    );
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram hash missing");
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

  const receivedBuffer = Buffer.from(
    receivedHash,
    "hex"
  );

  const calculatedBuffer = Buffer.from(
    calculatedHash,
    "hex"
  );

  if (
    receivedBuffer.length !==
      calculatedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error(
      "Invalid Telegram initData"
    );
  }

  const authDate = Number(
    params.get("auth_date")
  );

  if (!Number.isFinite(authDate)) {
    throw new Error(
      "Invalid Telegram auth date"
    );
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  if (age < 0 || age > 86400) {
    throw new Error(
      "Telegram initData expired"
    );
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error(
      "Telegram user data missing"
    );
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error(
      "Invalid Telegram user data"
    );
  }

  if (!user.id) {
    throw new Error(
      "Telegram user ID missing"
    );
  }

  return {
    user,
    startParam:
      params.get("start_param") || ""
  };
}

function authenticate(req) {
  return verifyTelegram(
    String(
      req.body?.initData || ""
    ).trim()
  );
}

/* =========================
   REFERRAL
========================= */

function processReferral(
  newUserId,
  startParam
) {
  if (!startParam) return false;

  const newId = String(newUserId);

  const newUser = getUser(newId);

  if (!newUser) return false;

  if (newUser.referred_by) {
    return false;
  }

  let referrerId = String(
    startParam
  ).trim();

  if (referrerId.startsWith("ref_")) {
    referrerId =
      referrerId.substring(4);
  }

  if (!/^\d+$/.test(referrerId)) {
    return false;
  }

  if (referrerId === newId) {
    return false;
  }

  const referrer = getUser(referrerId);

  if (!referrer) {
    return false;
  }

  const transaction = db.transaction(
    () => {
      const updated = db
        .prepare(
          `
          UPDATE users
          SET referred_by = ?
          WHERE telegram_id = ?
          AND referred_by IS NULL
          `
        )
        .run(
          referrerId,
          newId
        );

      if (updated.changes !== 1) {
        return false;
      }

      db.prepare(
        `
        UPDATE users
        SET
          balance =
            COALESCE(balance, 0) + ?,
          referral_count =
            COALESCE(referral_count, 0) + 1,
          referral_earnings =
            COALESCE(referral_earnings, 0) + ?
        WHERE telegram_id = ?
        `
      ).run(
        REFERRAL_BONUS,
        REFERRAL_BONUS,
        referrerId
      );

      db.prepare(
        `
        INSERT INTO transactions (
          telegram_id,
          type,
          amount,
          note,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
        `
      ).run(
        referrerId,
        "referral",
        REFERRAL_BONUS,
        `Referral from ${newId}`,
        currentTime()
      );

      return true;
    }
  );

  return transaction();
}

/* =========================
   MINING
========================= */

function updateMining(telegramId) {
  const user = getUser(telegramId);

  if (!user) {
    throw new Error("User not found");
  }

  const current = currentTime();

  if (!user.mining_started_at) {
    db.prepare(
      `
      UPDATE users
      SET mining_started_at = ?
      WHERE telegram_id = ?
      `
    ).run(
      current,
      telegramId
    );

    return getUser(telegramId);
  }

  const elapsedSeconds = Math.floor(
    (
      current -
      Number(user.mining_started_at)
    ) / 1000
  );

  const seconds = Math.min(
    MINING_CYCLE_SECONDS,
    Math.max(0, elapsedSeconds)
  );

  const reward =
    (seconds / 3600) *
    MINING_RATE;

  if (reward <= 0) {
    return getUser(telegramId);
  }

  db.transaction(() => {
    db.prepare(
      `
      UPDATE users
      SET
        balance =
          COALESCE(balance, 0) + ?,
        mining_started_at = ?
      WHERE telegram_id = ?
      `
    ).run(
      reward,
      current,
      telegramId
    );

    db.prepare(
      `
      INSERT INTO transactions (
        telegram_id,
        type,
        amount,
        note,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(
      telegramId,
      "mining",
      reward,
      "Mining reward",
      current
    );
  })();

  return getUser(telegramId);
}

/* =========================
   FRONTEND
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

app.get("/index.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

app.get("/style.css", (req, res) => {
  res.sendFile(
    path.join(__dirname, "style.css")
  );
});

app.get("/app.js", (req, res) => {
  res.sendFile(
    path.join(__dirname, "app.js")
  );
});

/* =========================
   ADMIN PAGE
========================= */

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin.html")
  );
});

app.get("/admin.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin.html")
  );
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "MineRush2026",
    status: "online"
  });
});

/* =========================
   BOOTSTRAP
========================= */

app.post("/api/bootstrap", (req, res) => {
  try {
    const auth = authenticate(req);

    let user = createUser(auth.user);

    if (
      auth.startParam &&
      !user.referred_by
    ) {
      processReferral(
        user.telegram_id,
        auth.startParam
      );

      user = getUser(
        user.telegram_id
      );
    }

    if (!user.mining_started_at) {
      db.prepare(
        `
        UPDATE users
        SET mining_started_at = ?
        WHERE telegram_id = ?
        `
      ).run(
        currentTime(),
        user.telegram_id
      );

      user = getUser(
        user.telegram_id
      );
    }

    res.json({
      ok: true,
      user,
      settings: {
        miningRate: MINING_RATE,
        miningCycleHours: 12,
        dailyBonus: DAILY_BONUS,
        adReward: AD_REWARD,
        referralBonus: REFERRAL_BONUS,
        minWithdrawUSDT:
          MIN_WITHDRAW_USDT,
        mrxPerUSDT: MRX_PER_USDT,
        adWatchSeconds:
          AD_WATCH_SECONDS
      }
    });
  } catch (error) {
    console.error(
      "Bootstrap:",
      error.message
    );

    res.status(401).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================
   MINING CLAIM
========================= */

app.post(
  "/api/mining/claim",
  (req, res) => {
    try {
      const auth = authenticate(req);

      createUser(auth.user);

      const user = updateMining(
        String(auth.user.id)
      );

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

/* =========================
   DAILY BONUS
========================= */

function bangladeshDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Dhaka"
    }
  ).format(new Date());
}

app.post(
  "/api/daily",
  (req, res) => {
    try {
      const auth = authenticate(req);

      const user = createUser(
        auth.user
      );

      const today =
        bangladeshDate();

      if (
        user.last_daily_bonus ===
        today
      ) {
        return res.json({
          ok: false,
          error:
            "Daily bonus already claimed",
          user
        });
      }

      db.transaction(() => {
        db.prepare(
          `
          UPDATE users
          SET
            balance =
              COALESCE(balance, 0) + ?,
            last_daily_bonus = ?
          WHERE telegram_id = ?
          `
        ).run(
          DAILY_BONUS,
          today,
          user.telegram_id
        );

        db.prepare(
          `
          INSERT INTO transactions (
            telegram_id,
            type,
            amount,
            note,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
          `
        ).run(
          user.telegram_id,
          "daily",
          DAILY_BONUS,
          "Daily bonus",
          currentTime()
        );
      })();

      res.json({
        ok: true,
        amount: DAILY_BONUS,
        user: getUser(
          user.telegram_id
        )
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================
   AD START
========================= */

app.post(
  "/api/ad/start",
  (req, res) => {
    try {
      const auth = authenticate(req);

      const user = createUser(
        auth.user
      );

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
        .get(
          user.telegram_id
        );

      if (lastAd) {
        const elapsed =
          currentTime() -
          Number(lastAd.created_at);

        if (
          elapsed <
          AD_COOLDOWN_MS
        ) {
          const remaining = Math.ceil(
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
      ).run(
        user.telegram_id
      );

      const token = crypto
        .randomBytes(32)
        .toString("hex");

      const startedAt =
        currentTime();

      const expiresAt =
        startedAt +
        AD_WATCH_SECONDS * 1000;

      db.prepare(
        `
        INSERT INTO ad_sessions (
          telegram_id,
          token,
          started_at,
          expires_at,
          status
        )
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
        watchSeconds:
          AD_WATCH_SECONDS,
        reward: AD_REWARD,
        adUrl: AD_URL
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================
   AD CLAIM
========================= */

app.post(
  "/api/ad/claim",
  (req, res) => {
    try {
      const auth = authenticate(req);

      const token = String(
        req.body?.token || ""
      ).trim();

      if (!token) {
        throw new Error(
          "Ad session token missing"
        );
      }

      const user = createUser(
        auth.user
      );

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
        currentTime();

      if (
        current <
        Number(session.expires_at)
      ) {
        const remaining = Math.ceil(
          (
            Number(session.expires_at) -
            current
          ) / 1000
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
          .run(
            current,
            session.id
          );

        if (updated.changes !== 1) {
          throw new Error(
            "Ad session already claimed"
          );
        }

        db.prepare(
          `
          UPDATE users
          SET balance =
            COALESCE(balance, 0) + ?
          WHERE telegram_id = ?
          `
        ).run(
          AD_REWARD,
          user.telegram_id
        );

        db.prepare(
          `
          INSERT INTO transactions (
            telegram_id,
            type,
            amount,
            note,
            created_at
          )
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
        user: getUser(
          user.telegram_id
        )
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================
   REFERRAL INFO
========================= */

app.post(
  "/api/referral",
  (req, res) => {
    try {
      const auth = authenticate(req);

      const user = createUser(
        auth.user
      );

      const link =
        `https://t.me/${BOT_USERNAME}?start=ref_${user.telegram_id}`;

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
        referralLink: link
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================
   WITHDRAW
========================= */

function validTRC20(wallet) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    wallet
  );
}

app.post(
  "/api/withdraw",
  (req, res) => {
    try {
      const auth = authenticate(req);

      const user = createUser(
        auth.user
      );

      const amount = Number(
        req.body?.amount_usdt
      );

      const wallet = String(
        req.body?.wallet || ""
      ).trim();

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          "Invalid withdrawal amount"
        );
      }

      if (
        amount <
        MIN_WITHDRAW_USDT
      ) {
        throw new Error(
          `Minimum withdrawal is ${MIN_WITHDRAW_USDT} USDT`
        );
      }

      if (!validTRC20(wallet)) {
        throw new Error(
          "Invalid TRC20 wallet address"
        );
      }

      const requiredMRX =
        amount * MRX_PER_USDT;

      const withdrawalId =
        db.transaction(() => {
          const updated = db
            .prepare(
              `
              UPDATE users
              SET balance = balance - ?
              WHERE telegram_id = ?
              AND balance >= ?
              `
            )
            .run(
              requiredMRX,
              user.telegram_id,
              requiredMRX
            );

          if (updated.changes !== 1) {
            throw new Error(
              "Insufficient MRX balance"
            );
          }

          const result = db
            .prepare(
              `
              INSERT INTO withdrawals (
                telegram_id,
                amount_usdt,
                wallet,
                status,
                created_at
              )
              VALUES (?, ?, ?, 'pending', ?)
              `
            )
            .run(
              user.telegram_id,
              amount,
              wallet,
              currentTime()
            );

          db.prepare(
            `
            INSERT INTO transactions (
              telegram_id,
              type,
              amount,
              note,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
            `
          ).run(
            user.telegram_id,
            "withdrawal",
            -requiredMRX,
            `Withdrawal #${result.lastInsertRowid}`,
            currentTime()
          );

          return result.lastInsertRowid;
        })();

      res.json({
        ok: true,
        withdrawal_id:
          withdrawalId,
        status: "pending",
        user: getUser(
          user.telegram_id
        )
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================
   TRANSACTIONS
========================= */

app.post(
  "/api/transactions",
  (req, res) => {
    try {
      const auth = authenticate(req);

      const user = createUser(
        auth.user
      );

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
        .all(
          user.telegram_id
        );

      res.json({
        ok: true,
        items
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================
   ADMIN AUTH
========================= */

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      ok: false,
      error:
        "ADMIN_KEY is not configured"
    });
  }

  const supplied = String(
    req.headers["x-admin-key"] || ""
  ).trim();

  if (
    !supplied ||
    supplied !== ADMIN_KEY
  ) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  next();
}

/* =========================
   ADMIN TEST
========================= */

app.get(
  "/api/admin/test",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,
      message:
        "Admin authentication working"
    });
  }
);

/* =========================
   ADMIN STATS
========================= */

app.get(
  "/api/admin/stats",
  requireAdmin,
  (req, res) => {
    try {
      const users = db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM users
          `
        )
        .get().count;

      const pending = db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM withdrawals
          WHERE status = 'pending'
          `
        )
        .get().count;

      const totalMRX = db
        .prepare(
          `
          SELECT
            COALESCE(
              SUM(balance),
              0
            ) AS total
          FROM users
          `
        )
        .get().total;

      const paidUSDT = db
        .prepare(
          `
          SELECT
            COALESCE(
              SUM(amount_usdt),
              0
            ) AS total
          FROM withdrawals
          WHERE status = 'paid'
          `
        )
        .get().total;

      res.json({
        ok: true,
        users: Number(users || 0),
        pendingWithdrawals:
          Number(pending || 0),
        totalMRX:
          Number(totalMRX || 0),
        totalPaidUSDT:
          Number(paidUSDT || 0)
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================
   ADMIN USERS
========================= */

app.get(
  "/api/admin/users",
  requireAdmin,
  (req, res) => {
    try {
      const users = db
        .prepare(
          `
          SELECT
            id,
            telegram_id,
            username,
            first_name,
            balance,
            referral_count,
            referral_earnings,
            created_at
          FROM users
          ORDER BY id DESC
          LIMIT 500
          `
        )
        .all();

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

/* =========================
   ADMIN WITHDRAWALS
========================= */

app.get(
  "/api/admin/withdrawals",
  requireAdmin,
  (req, res) => {
    try {
      const items = db
        .prepare(
          `
          SELECT
            w.id,
            w.telegram_id,
            w.amount_usdt,
            w.wallet,
            w.status,
            w.created_at,
            w.processed_at,
            u.username,
            u.first_name
          FROM withdrawals w
          LEFT JOIN users u
          ON u.telegram_id =
             w.telegram_id
          ORDER BY w.id DESC
          LIMIT 500
          `
        )
        .all();

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

/* =========================
   ADMIN WITHDRAWAL STATUS
========================= */

app.post(
  "/api/admin/withdrawals/:id/status",
  requireAdmin,
  (req, res) => {
    try {
      const id = Number(
        req.params.id
      );

      const status = String(
        req.body?.status || ""
      ).trim();

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

      const withdrawal = db
        .prepare(
          `
          SELECT *
          FROM withdrawals
          WHERE id = ?
          LIMIT 1
          `
        )
        .get(id);

      if (!withdrawal) {
        throw new Error(
          "Withdrawal not found"
        );
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        throw new Error(
          `Withdrawal already ${withdrawal.status}`
        );
      }

      db.transaction(() => {
        if (status === "rejected") {
          const refund =
            Number(
              withdrawal.amount_usdt
            ) *
            MRX_PER_USDT;

          db.prepare(
            `
            UPDATE users
            SET balance =
              COALESCE(balance, 0) + ?
            WHERE telegram_id = ?
            `
          ).run(
            refund,
            withdrawal.telegram_id
          );

          db.prepare(
            `
            INSERT INTO transactions (
              telegram_id,
              type,
              amount,
              note,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
            `
          ).run(
            withdrawal.telegram_id,
            "withdrawal_refund",
            refund,
            `Refund #${id}`,
            currentTime()
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
          currentTime(),
          id
        );
      })();

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

/* =========================
   TELEGRAM API
========================= */

async function telegram(
  method,
  body
) {
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

      if (!message) return;

      const tgUser =
        message.from;

      if (!tgUser?.id) return;

      const text = String(
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
          createUser(tgUser);

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

        await telegram(
          "sendMessage",
          {
            chat_id: tgUser.id,
            text:
              `👋 Welcome to MineRush2026!\n\n` +
              `⛏️ Mining: ${MINING_RATE} MRX/hour\n` +
              `🎁 Daily: ${DAILY_BONUS} MRX\n` +
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

/* =========================
   WEBHOOK SETUP
========================= */

async function setupWebhook() {
  if (!BOT_TOKEN) {
    console.log(
      "⚠️ TELEGRAM_BOT_TOKEN not configured"
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

/* =========================
   404
========================= */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error: "Not Found"
    });
  }
);

/* =========================
   ERROR HANDLER
========================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "Server error:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        "Internal server error"
    });
  }
);

/* =========================
   START SERVER
========================= */

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
