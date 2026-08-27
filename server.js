import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 10000);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

const APP_URL =
  process.env.APP_URL ||
  "https://minerush2026-1.onrender.com";

const BOT_USERNAME =
  process.env.BOT_USERNAME ||
  "MineRush2026_bot";

/* =====================================================
   SETTINGS
===================================================== */

const MRX_PER_HOUR =
  Number(process.env.MRX_PER_HOUR || 10);

const AD_REWARD =
  Number(process.env.MRX_PER_AD || 25);

const REFERRAL_BONUS =
  Number(process.env.REFERRAL_BONUS_MRX || 500);

const MIN_WITHDRAW_USDT =
  Number(process.env.MIN_WITHDRAW_USDT || 10);

const MRX_PER_USDT = 1000;

const AD_WATCH_SECONDS = 30;

const AD_COOLDOWN_MS =
  5 * 60 * 1000;

const MAX_MINING_SECONDS =
  12 * 60 * 60;

const AD_URL =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

/*
   IMPORTANT:
   DO NOT use:
   express.static(__dirname)

   কারণ এতে server.js/database/package files
   browser থেকে দেখা যেতে পারে।
*/

/* =====================================================
   SAFE FRONTEND FILES ONLY
===================================================== */

app.get("/", (req, res) => {
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

/*
   Sensitive files block
*/

app.use((req, res, next) => {

  const blocked = [
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/yarn.lock",
    "/minerush.sqlite",
    "/minerush.sqlite-shm",
    "/minerush.sqlite-wal",
    "/.env"
  ];

  if (blocked.includes(req.path)) {
    return res.status(404).send("Not Found");
  }

  next();
});

/* =====================================================
   DATABASE
===================================================== */

const db = new Database(
  process.env.DB_FILE || "./minerush.sqlite"
);

db.pragma("journal_mode = WAL");

const now = () => Date.now();

/* =====================================================
   TABLES
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
    c => c.name === column
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
   USER
===================================================== */

function getUser(id) {
  return db
    .prepare(`
      SELECT *
      FROM users
      WHERE telegram_id=?
    `)
    .get(String(id));
}

function upsertUser(tg) {

  if (!tg || !tg.id) {
    throw new Error(
      "Telegram user is required"
    );
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
      SET
        username=?,
        first_name=?
      WHERE telegram_id=?
    `).run(
      tg.username || existing.username || "",
      tg.first_name || existing.first_name || "",
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

  const newId = String(newUserId);

  if (!startParameter) {
    return null;
  }

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

      db.prepare(`
        UPDATE users
        SET referred_by=?
        WHERE telegram_id=?
        AND referred_by IS NULL
      `).run(
        referrerId,
        newId
      );

      db.prepare(`
        UPDATE users
        SET
          balance=balance+?,
          referral_count=
            COALESCE(referral_count,0)+1,
          referral_earnings=
            COALESCE(referral_earnings,0)+?
        WHERE telegram_id=?
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

function claimMining(userId) {

  const id = String(userId);

  const user = getUser(id);

  if (!user) {
    throw new Error(
      "User not found"
    );
  }

  const current = now();

  /*
     প্রথমবার mining শুরু
  */

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

  /*
     12 ঘণ্টা পূর্ণ হলে নতুন cycle
     শুরু হবে claim করার সময়।
  */

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

/* =====================================================
   TELEGRAM WEBHOOK
===================================================== */

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
            chat_id: tgUser.id,

            text:
              `👋 Welcome to MineRush2026, ${tgUser.first_name || "Miner"}!\n\n` +
              `⛏️ Start mining MRX and collect rewards.\n\n` +
              `💰 Balance: ${Number(
                updatedUser.balance || 0
              ).toLocaleString()} MRX\n` +
              `👥 Referrals: ${Number(
                updatedUser.referral_count || 0
              )}\n\n` +
              `💱 1000 MRX = 1 USDT`,

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

      /*
         Normal Telegram Mini App:
         body.user

         Fallback:
         body.telegram_id
      */

      let tgUser =
        req.body?.user;

      if (
        (!tgUser || !tgUser.id) &&
        req.body?.telegram_id
      ) {

        tgUser = {
          id:
            String(
              req.body.telegram_id
            ),

          username:
            req.body.username || "",

          first_name:
            req.body.first_name || "Miner"
        };
      }

      if (!tgUser?.id) {
        throw new Error(
          "Telegram user is required"
        );
      }

      const user =
        upsertUser(tgUser);

      const result =
        claimMining(
          user.telegram_id
        );

      res.json({
        ok: true,
        user: result,
        miningRate: MRX_PER_HOUR
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
        );

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
        );

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
            "Daily bonus already claimed"
        });
      }

      const amount = 100;

      const transaction =
        db.transaction(() => {

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
        });

      transaction();

      res.json({
        ok: true,
        amount,
        user: getUser(id)
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
        );

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

      /*
         Last successful ad
      */

      const recent =
        db.prepare(`
          SELECT created_at
          FROM transactions
          WHERE telegram_id=?
          AND type='ad_reward'
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
              )} minute(s) before watching another ad.`
          });
        }
      }

      /*
         Expire old sessions
      */

      db.prepare(`
        UPDATE ad_sessions
        SET status='expired'
        WHERE telegram_id=?
        AND status='active'
      `).run(id);

      const token =
        crypto
          .randomBytes(32)
          .toString("hex");

      const startedAt = now();

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
          WHERE token=?
          AND telegram_id=?
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
          "This ad session has already been used"
        );
      }

      const current = now();

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
          `Please watch the ad for ${remaining} more second(s)`
        );
      }

      const transaction =
        db.transaction(() => {

          const updated =
            db.prepare(`
              UPDATE ad_sessions
              SET
                status='claimed',
                claimed_at=?
              WHERE id=?
              AND status='active'
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
            SET balance=balance+?
            WHERE telegram_id=?
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
        amount: AD_REWARD,
        user: getUser(id)
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
   DIRECT AD REWARD DISABLED
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
          req.params.telegram_id
        );

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
        Number(user.balance) < required
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

  const key =
    process.env.ADMIN_KEY || "";

  if (
    !key ||
    req.headers["x-admin-key"] !== key
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
        SELECT COUNT(*) AS c
        FROM users
      `).get().c;

    const pending =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM withdrawals
        WHERE status='pending'
      `).get().c;

    const balance =
      db.prepare(`
        SELECT
          COALESCE(
            SUM(balance),
            0
          ) AS s
        FROM users
      `).get().s;

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
        WHERE id=?
      `).get(id);

    if (!withdrawal) {

      return res.status(404).json({
        ok: false,
        error:
          "Withdrawal not found"
      });
    }

    /*
       যদি rejected করা হয়,
       pending withdrawal-এর MRX ফেরত দেওয়া হবে।
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
            SET balance=balance+?
            WHERE telegram_id=?
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
      });

    transaction();

    res.json({
      ok: true
    });
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
   TELEGRAM WEBHOOK
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
   START
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
