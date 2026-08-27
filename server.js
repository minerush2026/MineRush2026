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
   MIDDLEWARE
===================================================== */

app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(express.static(__dirname));

/* =====================================================
   PORT
===================================================== */

const PORT = Number(
  process.env.PORT || 3000
);

/* =====================================================
   ENVIRONMENT
===================================================== */

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const APP_URL =
  (
    process.env.APP_URL ||
    "https://minerush2026-1.onrender.com"
  ).replace(/\/+$/, "");

const BOT_USERNAME =
  (
    process.env.BOT_USERNAME ||
    "MineRush2026_bot"
  ).replace(/^@/, "");

/* =====================================================
   ADSTERRA SMARTLINK
===================================================== */

const AD_URL =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";

/* =====================================================
   DATABASE
===================================================== */

const DB_FILE =
  process.env.DB_FILE ||
  "./minerush.sqlite";

const db =
  new Database(DB_FILE);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

/* =====================================================
   TIME
===================================================== */

const now = () =>
  Date.now();

/* =====================================================
   GAME SETTINGS
===================================================== */

const MRX_PER_HOUR =
  Number(
    process.env.MRX_PER_HOUR || 10
  );

const AD_REWARD =
  Number(
    process.env.MRX_PER_AD || 25
  );

const REFERRAL_BONUS =
  Number(
    process.env.REFERRAL_BONUS_MRX || 500
  );

const DAILY_BONUS =
  Number(
    process.env.DAILY_BONUS_MRX || 100
  );

const MIN_WITHDRAW_USDT =
  Number(
    process.env.MIN_WITHDRAW_USDT || 10
  );

const MRX_PER_USDT =
  Number(
    process.env.MRX_PER_USDT || 1000
  );

const AD_WATCH_SECONDS = 30;

const AD_COOLDOWN_MS =
  5 * 60 * 1000;

const MAX_MINING_SECONDS =
  12 * 60 * 60;

/* =====================================================
   VALIDATE SETTINGS
===================================================== */

if (
  !Number.isFinite(MRX_PER_HOUR) ||
  MRX_PER_HOUR <= 0
) {
  throw new Error(
    "Invalid MRX_PER_HOUR"
  );
}

if (
  !Number.isFinite(AD_REWARD) ||
  AD_REWARD <= 0
) {
  throw new Error(
    "Invalid MRX_PER_AD"
  );
}

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

    created_at INTEGER NOT NULL,

    updated_at INTEGER
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

  CREATE INDEX IF NOT EXISTS
  idx_transactions_user
  ON transactions(telegram_id);

  CREATE INDEX IF NOT EXISTS
  idx_ad_sessions_token
  ON ad_sessions(token);

  CREATE INDEX IF NOT EXISTS
  idx_withdrawals_user
  ON withdrawals(telegram_id);
`);

/* =====================================================
   SAFE MIGRATION
===================================================== */

function addColumnIfMissing(
  table,
  column,
  definition
) {
  const columns =
    db
      .prepare(
        `PRAGMA table_info(${table})`
      )
      .all();

  const exists =
    columns.some(
      c => c.name === column
    );

  if (!exists) {
    db.exec(
      `ALTER TABLE ${table}
       ADD COLUMN ${column}
       ${definition}`
    );
  }
}

addColumnIfMissing(
  "users",
  "updated_at",
  "INTEGER"
);

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
   USER
===================================================== */

function normalizeTelegramUser(tg) {
  if (!tg || !tg.id) {
    throw new Error(
      "Telegram user is required"
    );
  }

  return {
    id: String(tg.id),

    username:
      tg.username
        ? String(tg.username)
        : "",

    first_name:
      tg.first_name
        ? String(tg.first_name)
        : ""
  };
}

function getUser(
  telegramId
) {
  return db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
      `
    )
    .get(
      String(telegramId)
    );
}

/* =====================================================
   UPSERT USER
===================================================== */

function upsertUser(tg) {
  const user =
    normalizeTelegramUser(tg);

  const existing =
    getUser(user.id);

  const current =
    now();

  if (!existing) {
    db.prepare(
      `
      INSERT INTO users
      (
        telegram_id,
        username,
        first_name,
        balance,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 0, ?, ?)
      `
    ).run(
      user.id,
      user.username,
      user.first_name,
      current,
      current
    );
  } else {
    db.prepare(
      `
      UPDATE users
      SET
        username = ?,
        first_name = ?,
        updated_at = ?
      WHERE telegram_id = ?
      `
    ).run(
      user.username,
      user.first_name,
      current,
      user.id
    );
  }

  return getUser(user.id);
}

/* =====================================================
   TRANSACTION LOGGER
===================================================== */

function addTransaction(
  telegramId,
  type,
  amount,
  note = ""
) {
  db.prepare(
    `
    INSERT INTO transactions
    (
      telegram_id,
      type,
      amount,
      note,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
    `
  ).run(
    String(telegramId),
    type,
    Number(amount),
    String(note),
    now()
  );
}

/* =====================================================
   REFERRAL
===================================================== */

function cleanReferralCode(
  code
) {
  return String(code || "")
    .trim()
    .replace(/^ref_/i, "");
}

function processReferral(
  newUserId,
  referralCode
) {
  const newId =
    String(newUserId);

  const referrerId =
    cleanReferralCode(
      referralCode
    );

  if (!referrerId) {
    return {
      success: false,
      reason: "No referral code"
    };
  }

  if (
    referrerId === newId
  ) {
    return {
      success: false,
      reason: "Self referral blocked"
    };
  }

  const newUser =
    getUser(newId);

  if (!newUser) {
    return {
      success: false,
      reason: "New user not found"
    };
  }

  /*
    IMPORTANT:
    If user already has a referrer,
    NEVER pay again.
  */

  if (newUser.referred_by) {
    return {
      success: false,
      reason: "Already referred"
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

  /*
    Atomic referral transaction
  */

  try {
    const result =
      db.transaction(() => {

        /*
          Re-check inside transaction.
          This prevents duplicate bonus
          if two webhook requests arrive
          at almost the same time.
        */

        const latest =
          getUser(newId);

        if (
          !latest ||
          latest.referred_by
        ) {
          return {
            success: false,
            reason: "Already referred"
          };
        }

        /*
          Save referrer
        */

        db.prepare(
          `
          UPDATE users
          SET
            referred_by = ?,
            updated_at = ?
          WHERE
            telegram_id = ?
            AND referred_by IS NULL
          `
        ).run(
          referrerId,
          now(),
          newId
        );

        /*
          Give bonus
        */

        db.prepare(
          `
          UPDATE users
          SET
            balance =
              balance + ?,

            referral_count =
              COALESCE(
                referral_count,
                0
              ) + 1,

            referral_earnings =
              COALESCE(
                referral_earnings,
                0
              ) + ?,

            updated_at = ?

          WHERE telegram_id = ?
          `
        ).run(
          REFERRAL_BONUS,
          REFERRAL_BONUS,
          now(),
          referrerId
        );

        /*
          Transaction
        */

        addTransaction(
          referrerId,
          "referral",
          REFERRAL_BONUS,
          `Referral bonus from ${newId}`
        );

        return {
          success: true,
          referrerId,
          bonus: REFERRAL_BONUS
        };
      })();

    return result;

  } catch (error) {

    console.error(
      "Referral transaction error:",
      error.message
    );

    return {
      success: false,
      reason: "Referral processing failed"
    };
  }
}

/* =====================================================
   MINING
===================================================== */

function claimMining(
  telegramId
) {
  const id =
    String(telegramId);

  const user =
    getUser(id);

  if (!user) {
    throw new Error(
      "User not found"
    );
  }

  const current =
    now();

  /*
    First mining activation
  */

  if (
    !user.mining_started_at
  ) {

    db.prepare(
      `
      UPDATE users
      SET
        mining_started_at = ?,
        updated_at = ?
      WHERE telegram_id = ?
      `
    ).run(
      current,
      current,
      id
    );

    return getUser(id);
  }

  const started =
    Number(
      user.mining_started_at
    );

  const elapsedMs =
    Math.max(
      0,
      current - started
    );

  const elapsedSeconds =
    Math.min(
      MAX_MINING_SECONDS,
      Math.floor(
        elapsedMs / 1000
      )
    );

  /*
    Calculate exact earned amount.
    Example:
    30 minutes =
    10 * 0.5 = 5 MRX
  */

  const earned =
    (
      elapsedSeconds / 3600
    ) * MRX_PER_HOUR;

  if (
    earned <= 0
  ) {
    return getUser(id);
  }

  /*
    Restart mining after claim
  */

  const result =
    db.transaction(() => {

      const latest =
        getUser(id);

      if (!latest) {
        throw new Error(
          "User not found"
        );
      }

      const latestStart =
        Number(
          latest.mining_started_at
        );

      const latestElapsed =
        Math.max(
          0,
          Math.min(
            MAX_MINING_SECONDS,
            current - latestStart
          )
        );

      const latestEarned =
        (
          latestElapsed / 3600000
        ) * MRX_PER_HOUR;

      if (
        latestEarned <= 0
      ) {
        return getUser(id);
      }

      db.prepare(
        `
        UPDATE users
        SET
          balance =
            balance + ?,

          mining_started_at = ?,

          updated_at = ?

        WHERE telegram_id = ?
        `
      ).run(
        latestEarned,
        current,
        current,
        id
      );

      addTransaction(
        id,
        "mining",
        latestEarned,
        "Mining claim"
      );

      return getUser(id);
    })();

  return result;
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
   TELEGRAM WEBHOOK
===================================================== */

app.post(
  "/telegram/webhook",
  async (req, res) => {

    /*
      Respond immediately to Telegram.
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

      /*
        Always create/update user.
      */

      const user =
        upsertUser(tgUser);

      /*
        Handle /start
      */

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

        /*
          Referral is processed only
          when a start parameter exists.
        */

        let referralResult =
          null;

        if (
          startParameter &&
          /^ref_/i.test(
            startParameter
          )
        ) {

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

        const balance =
          Number(
            updatedUser?.balance || 0
          ).toLocaleString();

        const referrals =
          Number(
            updatedUser?.referral_count || 0
          ).toLocaleString();

        /*
          Welcome message
        */

        await telegram(
          "sendMessage",
          {
            chat_id:
              tgUser.id,

            text:
              `👋 Welcome to MineRush2026, ${tgUser.first_name || "Miner"}!\n\n` +
              `⛏️ Start mining MRX and collect rewards.\n\n` +
              `💰 Balance: ${balance} MRX\n` +
              `👥 Referrals: ${referrals}\n` +
              `🎁 Referral bonus: ${REFERRAL_BONUS} MRX\n` +
              `💱 ${MRX_PER_USDT} MRX = 1 USDT`,

            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      "⛏️ Open MineRush2026",

                    web_app: {
                      url:
                        APP_URL
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

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      service: "MineRush2026",
      status: "online",
      time: now()
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

      const user =
        upsertUser(
          req.body?.user
        );

      /*
        Start mining if needed.
      */

      const updated =
        claimMining(
          user.telegram_id
        );

      res.json({
        ok: true,
        user: updated,
        miningRate:
          MRX_PER_HOUR
      });

    } catch (error) {

      console.error(
        "Bootstrap error:",
        error.message
      );

      res.status(400).json({
        ok: false,
        error:
          error.message
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
        error:
          error.message
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

      /*
        Atomic protection.
      */

      const result =
        db.transaction(() => {

          const latest =
            getUser(id);

          if (
            latest.last_daily_bonus === day
          ) {

            return {
              ok: false,
              error:
                "Daily bonus already claimed"
            };
          }

          db.prepare(
            `
            UPDATE users
            SET
              balance =
                balance + ?,

              last_daily_bonus = ?,

              updated_at = ?

            WHERE
              telegram_id = ?

              AND (
                last_daily_bonus IS NULL
                OR last_daily_bonus != ?
              )
            `
          ).run(
            DAILY_BONUS,
            day,
            now(),
            id,
            day
          );

          addTransaction(
            id,
            "daily",
            DAILY_BONUS,
            "Daily bonus"
          );

          return {
            ok: true,
            amount:
              DAILY_BONUS,
            user:
              getUser(id)
          };
        })();

      res.json(result);

    } catch (error) {

      res.status(400).json({
        ok: false,
        error:
          error.message
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
        Check last successful ad reward.
      */

      const recent =
        db.prepare(
          `
          SELECT created_at
          FROM transactions
          WHERE
            telegram_id = ?
            AND type = 'ad_reward'
          ORDER BY id DESC
          LIMIT 1
          `
        ).get(id);

      if (recent) {

        const elapsed =
          now() -
          Number(
            recent.created_at
          );

        if (
          elapsed <
          AD_COOLDOWN_MS
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
        Expire old sessions.
      */

      db.prepare(
        `
        UPDATE ad_sessions
        SET status = 'expired'
        WHERE
          telegram_id = ?
          AND status = 'active'
        `
      ).run(id);

      /*
        Secure token.
      */

      const token =
        crypto
          .randomBytes(32)
          .toString("hex");

      const startedAt =
        now();

      const expiresAt =
        startedAt +
        AD_WATCH_SECONDS * 1000;

      db.prepare(
        `
        INSERT INTO ad_sessions
        (
          telegram_id,
          token,
          started_at,
          expires_at,
          status
        )
        VALUES (?, ?, ?, ?, 'active')
        `
      ).run(
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
        error:
          error.message
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
        db.prepare(
          `
          SELECT *
          FROM ad_sessions
          WHERE
            token = ?
            AND telegram_id = ?
          LIMIT 1
          `
        ).get(
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

      const current =
        now();

      if (
        current <
        Number(
          session.expires_at
        )
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

      const result =
        db.transaction(() => {

          /*
            Atomic claim.
          */

          const update =
            db.prepare(
              `
              UPDATE ad_sessions
              SET
                status = 'claimed',
                claimed_at = ?
              WHERE
                id = ?
                AND status = 'active'
              `
            ).run(
              current,
              session.id
            );

          if (
            update.changes !== 1
          ) {
            throw new Error(
              "Ad session already claimed"
            );
          }

          db.prepare(
            `
            UPDATE users
            SET
              balance =
                balance + ?,

              updated_at = ?

            WHERE telegram_id = ?
            `
          ).run(
            AD_REWARD,
            current,
            id
          );

          addTransaction(
            id,
            "ad_reward",
            AD_REWARD,
            "30-second ad session"
          );

          return getUser(id);
        })();

      res.json({
        ok: true,

        amount:
          AD_REWARD,

        user:
          result
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error:
          error.message
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
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   WITHDRAW
===================================================== */

function isValidTRC20(
  wallet
) {
  /*
    Basic TRON address validation.
    TRC20 addresses normally begin
    with T and contain 34 characters.
  */

  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
    .test(wallet);
}

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
          "Wallet address is required"
        );
      }

      if (
        !isValidTRC20(wallet)
      ) {
        throw new Error(
          "Invalid USDT TRC20 wallet address"
        );
      }

      if (
        !Number.isFinite(amount)
      ) {
        throw new Error(
          "Invalid withdrawal amount"
        );
      }

      if (
        amount < MIN_WITHDRAW_USDT
      ) {
        throw new Error(
          `Minimum withdrawal is ${MIN_WITHDRAW_USDT} USDT`
        );
      }

      const required =
        amount * MRX_PER_USDT;

      const withdrawalId =
        db.transaction(() => {

          const user =
            getUser(id);

          if (!user) {
            throw new Error(
              "User not found"
            );
          }

          if (
            Number(user.balance) <
            required
          ) {
            throw new Error(
              "Insufficient MRX balance"
            );
          }

          /*
            Deduct balance.
          */

          const update =
            db.prepare(
              `
              UPDATE users
              SET
                balance =
                  balance - ?,

                updated_at = ?

              WHERE
                telegram_id = ?

                AND balance >= ?
              `
            ).run(
              required,
              now(),
              id,
              required
            );

          if (
            update.changes !== 1
          ) {
            throw new Error(
              "Insufficient MRX balance"
            );
          }

          /*
            Create withdrawal.
          */

          const result =
            db.prepare(
              `
              INSERT INTO withdrawals
              (
                telegram_id,
                amount_usdt,
                wallet,
                status,
                created_at
              )
              VALUES (?, ?, ?, 'pending', ?)
              `
            ).run(
              id,
              amount,
              wallet,
              now()
            );

          /*
            History
          */

          addTransaction(
            id,
            "withdrawal",
            -required,
            `Withdrawal request #${result.lastInsertRowid}`
          );

          return result.lastInsertRowid;
        })();

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
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN AUTH
===================================================== */

function admin(
  req,
  res,
  next
) {

  const adminKey =
    process.env.ADMIN_KEY || "";

  if (
    !adminKey ||
    req.headers["x-admin-key"] !==
      adminKey
  ) {

    return res.status(401).json({
      ok: false,
      error:
        "Unauthorized"
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

    try {

      const users =
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM users
          `
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
          SELECT
            COALESCE(
              SUM(balance),
              0
            ) AS total
          FROM users
          `
        ).get().total;

      const adRewards =
        db.prepare(
          `
          SELECT
            COALESCE(
              SUM(amount),
              0
            ) AS total
          FROM transactions
          WHERE type = 'ad_reward'
          `
        ).get().total;

      const referralRewards =
        db.prepare(
          `
          SELECT
            COALESCE(
              SUM(amount),
              0
            ) AS total
          FROM transactions
          WHERE type = 'referral'
          `
        ).get().total;

      res.json({
        ok: true,

        users,

        pendingWithdrawals:
          pending,

        totalMRX,

        totalAdRewards:
          adRewards,

        totalReferralRewards:
          referralRewards
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN WITHDRAWALS
===================================================== */

app.get(
  "/api/admin/withdrawals",
  admin,
  (req, res) => {

    try {

      const items =
        db.prepare(
          `
          SELECT *
          FROM withdrawals
          ORDER BY id DESC
          LIMIT 200
          `
        ).all();

      res.json({
        ok: true,
        items
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
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
        !Number.isInteger(id) ||
        id <= 0
      ) {
        throw new Error(
          "Invalid withdrawal ID"
        );
      }

      if (
        ![
          "pending",
          "paid",
          "rejected"
        ].includes(status)
      ) {
        throw new Error(
          "Invalid status"
        );
      }

      const result =
        db.transaction(() => {

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

          /*
            Already paid/rejected:
            do not process twice.
          */

          if (
            withdrawal.status !==
            "pending"
          ) {

            if (
              withdrawal.status ===
                status
            ) {
              return;
            }

            throw new Error(
              "Withdrawal has already been processed"
            );
          }

          /*
            REJECT:
            return MRX to user.
          */

          if (
            status === "rejected"
          ) {

            const refund =
              Number(
                withdrawal.amount_usdt
              ) * MRX_PER_USDT;

            db.prepare(
              `
              UPDATE users
              SET
                balance =
                  balance + ?,

                updated_at = ?

              WHERE telegram_id = ?
              `
            ).run(
              refund,
              now(),
              withdrawal.telegram_id
            );

            addTransaction(
              withdrawal.telegram_id,
              "withdrawal_refund",
              refund,
              `Refund for rejected withdrawal #${id}`
            );
          }

          db.prepare(
            `
            UPDATE withdrawals
            SET
              status = ?,
              processed_at = ?
            WHERE
              id = ?
              AND status = 'pending'
            `
          ).run(
            status,
            status === "pending"
              ? null
              : now(),
            id
          );
        })();

      res.json({
        ok: true
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN USERS
===================================================== */

app.get(
  "/api/admin/users",
  admin,
  (req, res) => {

    try {

      const users =
        db.prepare(
          `
          SELECT
            telegram_id,
            username,
            first_name,
            balance,
            mining_started_at,
            referral_count,
            referral_earnings,
            created_at
          FROM users
          ORDER BY id DESC
          LIMIT 500
          `
        ).all();

      res.json({
        ok: true,
        users
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN USER BALANCE
===================================================== */

app.post(
  "/api/admin/users/:telegram_id/balance",
  admin,
  (req, res) => {

    try {

      const id =
        String(
          req.params.telegram_id
        );

      const amount =
        Number(
          req.body?.amount
        );

      if (
        !Number.isFinite(amount)
      ) {
        throw new Error(
          "Invalid amount"
        );
      }

      const user =
        getUser(id);

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      db.prepare(
        `
        UPDATE users
        SET
          balance =
            balance + ?,

          updated_at = ?

        WHERE telegram_id = ?
        `
      ).run(
        amount,
        now(),
        id
      );

      addTransaction(
        id,
        "admin_adjustment",
        amount,
        "Admin balance adjustment"
      );

      res.json({
        ok: true,
        user:
          getUser(id)
      });

    } catch (error) {

      res.status(400).json({
        ok: false,
        error:
          error.message
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
          url:
            webhookUrl,

          /*
            Drop pending old updates
            when server is redeployed.
          */

          drop_pending_updates:
            false,

          allowed_updates:
            ["message"]
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
   GRACEFUL SHUTDOWN
===================================================== */

function shutdown(
  signal
) {

  console.log(
    `${signal} received. Closing database...`
  );

  try {
    db.close();
  } catch {}

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

/* =====================================================
   404
===================================================== */

app.use(
  (req, res) => {

    if (
      req.path.startsWith("/api/")
    ) {

      return res.status(404).json({
        ok: false,
        error:
          "API endpoint not found"
      });
    }

    res.status(404).send(
      "MineRush2026 - Page not found"
    );
  }
);

/* =====================================================
   GLOBAL ERROR
===================================================== */

app.use(
  (error, req, res, next) => {

    console.error(
      "Server error:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
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
      `Exchange rate: ${MRX_PER_USDT} MRX = 1 USDT`
    );

    console.log(
      "Adsterra SmartLink enabled"
    );

    console.log(
      "Database:",
      DB_FILE
    );

    await setupTelegram();
  }
);
