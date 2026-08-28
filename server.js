"use strict";

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* =====================================================
   CONFIG
===================================================== */

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
).trim().replace(/\/+$/, "");

const BOT_USERNAME = String(
  process.env.BOT_USERNAME ||
    "MineRush2026_bot"
).trim().replace(/^@/, "");

const DATABASE_URL = String(
  process.env.DATABASE_URL || ""
).trim();

/* =====================================================
   GAME SETTINGS
===================================================== */

const MINING_RATE = 10;              // MRX per hour
const DAILY_BONUS = 100;             // MRX
const AD_REWARD = 25;                // MRX
const REFERRAL_BONUS = 500;          // MRX

const MRX_PER_USDT = 1000;
const MIN_WITHDRAW_USDT = 10;

const MINING_CYCLE_SECONDS = 12 * 60 * 60;
const AD_WATCH_SECONDS = 30;
const AD_COOLDOWN_MS = 5 * 60 * 1000;

/* =====================================================
   AD URL
===================================================== */

const AD_URL =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";

/* =====================================================
   EXPRESS
===================================================== */

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

/* =====================================================
   DATABASE
===================================================== */

if (!DATABASE_URL) {
  console.error(
    "❌ DATABASE_URL is not configured"
  );
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL
    ? {
        rejectUnauthorized: false
      }
    : undefined
});

async function dbQuery(text, params = []) {
  const result = await pool.query(
    text,
    params
  );

  return result;
}

/* =====================================================
   DATABASE INIT
===================================================== */

async function initDatabase() {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured"
    );
  }

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',

      balance NUMERIC(20,8) NOT NULL DEFAULT 0,

      mining_started_at BIGINT,
      last_daily_bonus TEXT,

      referred_by TEXT,
      referral_count INTEGER NOT NULL DEFAULT 0,
      referral_earnings NUMERIC(20,8) NOT NULL DEFAULT 0,

      created_at BIGINT NOT NULL
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,

      telegram_id TEXT NOT NULL,
      type TEXT NOT NULL,

      amount NUMERIC(20,8) NOT NULL,

      note TEXT DEFAULT '',

      created_at BIGINT NOT NULL
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id BIGSERIAL PRIMARY KEY,

      telegram_id TEXT NOT NULL,

      amount_usdt NUMERIC(20,8) NOT NULL,

      wallet TEXT NOT NULL,

      status TEXT NOT NULL DEFAULT 'pending',

      created_at BIGINT NOT NULL,

      processed_at BIGINT
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS ad_sessions (
      id BIGSERIAL PRIMARY KEY,

      telegram_id TEXT NOT NULL,

      token TEXT UNIQUE NOT NULL,

      started_at BIGINT NOT NULL,

      expires_at BIGINT NOT NULL,

      claimed_at BIGINT,

      status TEXT NOT NULL DEFAULT 'active'
    )
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS
    idx_transactions_telegram
    ON transactions(telegram_id)
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS
    idx_withdrawals_telegram
    ON withdrawals(telegram_id)
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS
    idx_ad_sessions_telegram
    ON ad_sessions(telegram_id)
  `);

  console.log(
    "✅ PostgreSQL database initialized"
  );
}

/* =====================================================
   HELPERS
===================================================== */

function currentTime() {
  return Date.now();
}

function getTelegramId(value) {
  return String(value).trim();
}

async function getUser(telegramId) {
  const result = await dbQuery(
    `
    SELECT *
    FROM users
    WHERE telegram_id = $1
    LIMIT 1
    `,
    [
      getTelegramId(telegramId)
    ]
  );

  return result.rows[0] || null;
}

/* =====================================================
   CREATE / UPDATE USER
===================================================== */

async function createUser(tgUser) {
  if (!tgUser || !tgUser.id) {
    throw new Error(
      "Telegram user not found"
    );
  }

  const telegramId =
    getTelegramId(tgUser.id);

  const username = String(
    tgUser.username || ""
  );

  const firstName = String(
    tgUser.first_name || "Miner"
  );

  const photoUrl = String(
    tgUser.photo_url || ""
  );

  /*
   * IMPORTANT:
   * Telegram ID is the permanent UID.
   */

  await dbQuery(
    `
    INSERT INTO users (
      telegram_id,
      username,
      first_name,
      photo_url,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5)

    ON CONFLICT (telegram_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      photo_url = EXCLUDED.photo_url
    `,
    [
      telegramId,
      username,
      firstName,
      photoUrl,
      currentTime()
    ]
  );

  return getUser(telegramId);
}

/* =====================================================
   TELEGRAM AUTH
===================================================== */

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

  const params =
    new URLSearchParams(initData);

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    throw new Error(
      "Telegram hash missing"
    );
  }

  params.delete("hash");

  const dataCheckString =
    [...params.entries()]
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

  const secretKey =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(BOT_TOKEN)
      .digest();

  const calculatedHash =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(dataCheckString)
      .digest("hex");

  const receivedBuffer =
    Buffer.from(
      receivedHash,
      "hex"
    );

  const calculatedBuffer =
    Buffer.from(
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

  const authDate =
    Number(
      params.get("auth_date")
    );

  if (!Number.isFinite(authDate)) {
    throw new Error(
      "Invalid Telegram auth date"
    );
  }

  const age =
    Math.floor(
      Date.now() / 1000
    ) - authDate;

  if (
    age < 0 ||
    age > 86400
  ) {
    throw new Error(
      "Telegram initData expired"
    );
  }

  const userRaw =
    params.get("user");

  if (!userRaw) {
    throw new Error(
      "Telegram user data missing"
    );
  }

  let user;

  try {
    user =
      JSON.parse(userRaw);
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

/* =====================================================
   REFERRAL
===================================================== */

async function processReferral(
  newUserId,
  startParam
) {
  if (!startParam) {
    return false;
  }

  const newId =
    getTelegramId(newUserId);

  const newUser =
    await getUser(newId);

  if (!newUser) {
    return false;
  }

  if (newUser.referred_by) {
    return false;
  }

  let referrerId =
    String(startParam).trim();

  if (
    referrerId.startsWith("ref_")
  ) {
    referrerId =
      referrerId.substring(4);
  }

  if (
    !/^\d+$/.test(referrerId)
  ) {
    return false;
  }

  if (referrerId === newId) {
    return false;
  }

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const referrerResult =
      await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        FOR UPDATE
        `,
        [referrerId]
      );

    if (
      referrerResult.rows.length === 0
    ) {
      await client.query(
        "ROLLBACK"
      );

      return false;
    }

    const updated =
      await client.query(
        `
        UPDATE users
        SET referred_by = $1
        WHERE telegram_id = $2
        AND referred_by IS NULL
        `,
        [
          referrerId,
          newId
        ]
      );

    if (
      updated.rowCount !== 1
    ) {
      await client.query(
        "ROLLBACK"
      );

      return false;
    }

    await client.query(
      `
      UPDATE users
      SET
        balance =
          balance + $1,

        referral_count =
          referral_count + 1,

        referral_earnings =
          referral_earnings + $2

      WHERE telegram_id = $3
      `,
      [
        REFERRAL_BONUS,
        REFERRAL_BONUS,
        referrerId
      ]
    );

    await client.query(
      `
      INSERT INTO transactions (
        telegram_id,
        type,
        amount,
        note,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        referrerId,
        "referral",
        REFERRAL_BONUS,
        `Referral from ${newId}`,
        currentTime()
      ]
    );

    await client.query(
      "COMMIT"
    );

    return true;
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =====================================================
   SERVER-SIDE MINING
===================================================== */

async function updateMining(
  telegramId
) {
  const id =
    getTelegramId(telegramId);

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    /*
     * Lock user row.
     * This prevents two simultaneous
     * mining claims from paying twice.
     */

    const result =
      await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        FOR UPDATE
        `,
        [id]
      );

    if (
      result.rows.length === 0
    ) {
      throw new Error(
        "User not found"
      );
    }

    const user =
      result.rows[0];

    const now =
      currentTime();

    if (
      !user.mining_started_at
    ) {
      await client.query(
        `
        UPDATE users
        SET mining_started_at = $1
        WHERE telegram_id = $2
        `,
        [
          now,
          id
        ]
      );

      await client.query(
        "COMMIT"
      );

      return getUser(id);
    }

    const start =
      Number(
        user.mining_started_at
      );

    let elapsedSeconds =
      Math.floor(
        (now - start) / 1000
      );

    if (
      elapsedSeconds < 0
    ) {
      elapsedSeconds = 0;
    }

    /*
     * Maximum one mining cycle per claim.
     * 12 hours × 10 MRX/hour = 120 MRX.
     */

    const miningSeconds =
      Math.min(
        elapsedSeconds,
        MINING_CYCLE_SECONDS
      );

    const reward =
      (miningSeconds / 3600) *
      MINING_RATE;

    if (reward <= 0) {
      await client.query(
        "COMMIT"
      );

      return getUser(id);
    }

    /*
     * IMPORTANT:
     * We advance mining_started_at
     * by the amount of time actually paid.
     *
     * This means extra elapsed time is NOT lost.
     * If user waits 20 hours, first claim pays
     * 12 hours and the remaining 8 hours
     * stays available for the next claim.
     */

    const paidMilliseconds =
      miningSeconds * 1000;

    const newMiningStart =
      start + paidMilliseconds;

    await client.query(
      `
      UPDATE users
      SET
        balance =
          balance + $1,

        mining_started_at = $2

      WHERE telegram_id = $3
      `,
      [
        reward,
        newMiningStart,
        id
      ]
    );

    await client.query(
      `
      INSERT INTO transactions (
        telegram_id,
        type,
        amount,
        note,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        id,
        "mining",
        reward,
        "Server mining reward",
        now
      ]
    );

    await client.query(
      "COMMIT"
    );

    return getUser(id);
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =====================================================
   FRONTEND
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
   ADMIN PAGE
===================================================== */

app.get(
  "/admin",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "admin.html"
      )
    );
  }
);

app.get(
  "/admin.html",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "admin.html"
      )
    );
  }
);

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await dbQuery(
        "SELECT 1"
      );

      res.json({
        ok: true,
        service:
          "MineRush2026",
        status: "online",
        database:
          "connected"
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        service:
          "MineRush2026",
        status: "online",
        database:
          "disconnected",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   BOOTSTRAP
===================================================== */

app.post(
  "/api/bootstrap",
  async (req, res) => {
    try {
      const auth =
        authenticate(req);

      let user =
        await createUser(
          auth.user
        );

      if (
        auth.startParam &&
        !user.referred_by
      ) {
        await processReferral(
          user.telegram_id,
          auth.startParam
        );

        user =
          await getUser(
            user.telegram_id
          );
      }

      /*
       * IMPORTANT:
       * Do NOT reset mining_start on
       * every app open.
       *
       * It stays in database.
       */

      if (
        !user.mining_started_at
      ) {
        await dbQuery(
          `
          UPDATE users
          SET mining_started_at = $1
          WHERE telegram_id = $2
          `,
          [
            currentTime(),
            user.telegram_id
          ]
        );

        user =
          await getUser(
            user.telegram_id
          );
      }

      res.json({
        ok: true,

        user: {
          ...user,

          uid:
            user.telegram_id
        },

        settings: {
          miningRate:
            MINING_RATE,

          miningCycleHours:
            12,

          dailyBonus:
            DAILY_BONUS,

          adReward:
            AD_REWARD,

          referralBonus:
            REFERRAL_BONUS,

          minWithdrawUSDT:
            MIN_WITHDRAW_USDT,

          mrxPerUSDT:
            MRX_PER_USDT,

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
  async (req, res) => {
    try {
      const auth =
        authenticate(req);

      const user =
        await createUser(
          auth.user
        );

      const updatedUser =
        await updateMining(
          user.telegram_id
        );

      res.json({
        ok: true,

        user: {
          ...updatedUser,

          uid:
            updatedUser.telegram_id
        }
      });
    } catch (error) {
      console.error(
        "Mining claim:",
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
   DAILY BONUS
===================================================== */

function bangladeshDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Asia/Dhaka"
    }
  ).format(
    new Date()
  );
}

app.post(
  "/api/daily",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const auth =
        authenticate(req);

      const user =
        await createUser(
          auth.user
        );

      const today =
        bangladeshDate();

      await client.query(
        "BEGIN"
      );

      const locked =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [
            user.telegram_id
          ]
        );

      const currentUser =
        locked.rows[0];

      if (
        currentUser.last_daily_bonus ===
        today
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.json({
          ok: false,
          error:
            "Daily bonus already claimed",

          user: currentUser
        });
      }

      await client.query(
        `
        UPDATE users
        SET
          balance =
            balance + $1,

          last_daily_bonus = $2

        WHERE telegram_id = $3
        `,
        [
          DAILY_BONUS,
          today,
          user.telegram_id
        ]
      );

      await client.query(
        `
        INSERT INTO transactions (
          telegram_id,
          type,
          amount,
          note,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          user.telegram_id,
          "daily",
          DAILY_BONUS,
          "Daily bonus",
          currentTime()
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        amount:
          DAILY_BONUS,

        user:
          await getUser(
            user.telegram_id
          )
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   AD START
===================================================== */

app.post(
  "/api/ad/start",
  async (req, res) => {
    try {
      const auth =
        authenticate(req);

      const user =
        await createUser(
          auth.user
        );

      const lastAd =
        await dbQuery(
          `
          SELECT created_at
          FROM transactions
          WHERE telegram_id = $1
          AND type = 'ad_reward'
          ORDER BY id DESC
          LIMIT 1
          `,
          [
            user.telegram_id
          ]
        );

      const last =
        lastAd.rows[0];

      if (last) {
        const elapsed =
          currentTime() -
          Number(
            last.created_at
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

            cooldown:
              true,

            remainingSeconds:
              remaining,

            error:
              `Please wait ${remaining} seconds`
          });
        }
      }

      await dbQuery(
        `
        UPDATE ad_sessions
        SET status = 'expired'
        WHERE telegram_id = $1
        AND status = 'active'
        `,
        [
          user.telegram_id
        ]
      );

      const token =
        crypto
          .randomBytes(32)
          .toString("hex");

      const startedAt =
        currentTime();

      const expiresAt =
        startedAt +
        AD_WATCH_SECONDS * 1000;

      await dbQuery(
        `
        INSERT INTO ad_sessions (
          telegram_id,
          token,
          started_at,
          expires_at,
          status
        )
        VALUES ($1, $2, $3, $4, 'active')
        `,
        [
          user.telegram_id,
          token,
          startedAt,
          expiresAt
        ]
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
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const auth =
        authenticate(req);

      const token =
        String(
          req.body?.token || ""
        ).trim();

      if (!token) {
        throw new Error(
          "Ad session token missing"
        );
      }

      const user =
        await createUser(
          auth.user
        );

      await client.query(
        "BEGIN"
      );

      const sessionResult =
        await client.query(
          `
          SELECT *
          FROM ad_sessions
          WHERE token = $1
          AND telegram_id = $2
          FOR UPDATE
          `,
          [
            token,
            user.telegram_id
          ]
        );

      const session =
        sessionResult.rows[0];

      if (!session) {
        throw new Error(
          "Ad session not found"
        );
      }

      if (
        session.status !==
        "active"
      ) {
        throw new Error(
          "Ad session already used"
        );
      }

      const now =
        currentTime();

      if (
        now <
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
              now
            ) / 1000
          );

        throw new Error(
          `Please wait ${remaining} seconds`
        );
      }

      await client.query(
        `
        UPDATE ad_sessions
        SET
          status = 'claimed',
          claimed_at = $1
        WHERE id = $2
        AND status = 'active'
        `,
        [
          now,
          session.id
        ]
      );

      await client.query(
        `
        UPDATE users
        SET
          balance =
            balance + $1

        WHERE telegram_id = $2
        `,
        [
          AD_REWARD,
          user.telegram_id
        ]
      );

      await client.query(
        `
        INSERT INTO transactions (
          telegram_id,
          type,
          amount,
          note,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          user.telegram_id,
          "ad_reward",
          AD_REWARD,
          "Ad reward",
          now
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,

        amount:
          AD_REWARD,

        user:
          await getUser(
            user.telegram_id
          )
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   REFERRAL INFO
===================================================== */

app.post(
  "/api/referral",
  async (req, res) => {
    try {
      const auth =
        authenticate(req);

      const user =
        await createUser(
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

        referralLink:
          link
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

function validTRC20(wallet) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    wallet
  );
}

app.post(
  "/api/withdraw",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const auth =
        authenticate(req);

      const user =
        await createUser(
          auth.user
        );

      const amount =
        Number(
          req.body?.amount_usdt
        );

      const wallet =
        String(
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

      if (
        !validTRC20(wallet)
      ) {
        throw new Error(
          "Invalid TRC20 wallet address"
        );
      }

      const requiredMRX =
        amount *
        MRX_PER_USDT;

      await client.query(
        "BEGIN"
      );

      const locked =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [
            user.telegram_id
          ]
        );

      const currentUser =
        locked.rows[0];

      if (
        Number(
          currentUser.balance
        ) < requiredMRX
      ) {
        throw new Error(
          "Insufficient MRX balance"
        );
      }

      const withdrawalResult =
        await client.query(
          `
          INSERT INTO withdrawals (
            telegram_id,
            amount_usdt,
            wallet,
            status,
            created_at
          )
          VALUES ($1, $2, $3, 'pending', $4)
          RETURNING id
          `,
          [
            user.telegram_id,
            amount,
            wallet,
            currentTime()
          ]
        );

      const withdrawalId =
        withdrawalResult.rows[0].id;

      await client.query(
        `
        UPDATE users
        SET
          balance =
            balance - $1

        WHERE telegram_id = $2
        `,
        [
          requiredMRX,
          user.telegram_id
        ]
      );

      await client.query(
        `
        INSERT INTO transactions (
          telegram_id,
          type,
          amount,
          note,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          user.telegram_id,
          "withdrawal",
          -requiredMRX,
          `Withdrawal #${withdrawalId}`,
          currentTime()
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,

        withdrawal_id:
          withdrawalId,

        status:
          "pending",

        user:
          await getUser(
            user.telegram_id
          )
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   TRANSACTIONS
===================================================== */

app.post(
  "/api/transactions",
  async (req, res) => {
    try {
      const auth =
        authenticate(req);

      const user =
        await createUser(
          auth.user
        );

      const result =
        await dbQuery(
          `
          SELECT
            id,
            type,
            amount,
            note,
            created_at
          FROM transactions
          WHERE telegram_id = $1
          ORDER BY id DESC
          LIMIT 100
          `,
          [
            user.telegram_id
          ]
        );

      res.json({
        ok: true,
        items:
          result.rows
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

function requireAdmin(
  req,
  res,
  next
) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      ok: false,
      error:
        "ADMIN_KEY is not configured"
    });
  }

  const supplied =
    String(
      req.headers[
        "x-admin-key"
      ] || ""
    ).trim();

  if (
    !supplied ||
    supplied !== ADMIN_KEY
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
   ADMIN TEST
===================================================== */

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

/* =====================================================
   ADMIN STATS
===================================================== */

app.get(
  "/api/admin/stats",
  requireAdmin,
  async (req, res) => {
    try {
      const users =
        await dbQuery(
          `
          SELECT COUNT(*)::integer AS count
          FROM users
          `
        );

      const pending =
        await dbQuery(
          `
          SELECT COUNT(*)::integer AS count
          FROM withdrawals
          WHERE status = 'pending'
          `
        );

      const totalMRX =
        await dbQuery(
          `
          SELECT
            COALESCE(
              SUM(balance),
              0
            ) AS total
          FROM users
          `
        );

      const paidUSDT =
        await dbQuery(
          `
          SELECT
            COALESCE(
              SUM(amount_usdt),
              0
            ) AS total
          FROM withdrawals
          WHERE status = 'paid'
          `
        );

      res.json({
        ok: true,

        users:
          Number(
            users.rows[0].count
          ),

        pendingWithdrawals:
          Number(
            pending.rows[0].count
          ),

        totalMRX:
          Number(
            totalMRX.rows[0].total
          ),

        totalPaidUSDT:
          Number(
            paidUSDT.rows[0].total
          )
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
   ADMIN USERS
===================================================== */

app.get(
  "/api/admin/users",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await dbQuery(
          `
          SELECT
            id,

            telegram_id,

            telegram_id AS uid,

            username,

            first_name,

            balance,

            referral_count,

            referral_earnings,

            mining_started_at,

            created_at

          FROM users

          ORDER BY id DESC

          LIMIT 500
          `
        );

      res.json({
        ok: true,
        users:
          result.rows
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
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await dbQuery(
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
        );

      res.json({
        ok: true,
        items:
          result.rows
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
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const id =
        Number(
          req.params.id
        );

      const status =
        String(
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

      await client.query(
        "BEGIN"
      );

      const result =
        await client.query(
          `
          SELECT *
          FROM withdrawals
          WHERE id = $1
          FOR UPDATE
          `,
          [id]
        );

      const withdrawal =
        result.rows[0];

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

      if (
        status === "rejected"
      ) {
        const refund =
          Number(
            withdrawal.amount_usdt
          ) *
          MRX_PER_USDT;

        await client.query(
          `
          UPDATE users
          SET
            balance =
              balance + $1
          WHERE telegram_id = $2
          `,
          [
            refund,
            withdrawal.telegram_id
          ]
        );

        await client.query(
          `
          INSERT INTO transactions (
            telegram_id,
            type,
            amount,
            note,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            withdrawal.telegram_id,
            "withdrawal_refund",
            refund,
            `Refund #${id}`,
            currentTime()
          ]
        );
      }

      await client.query(
        `
        UPDATE withdrawals

        SET
          status = $1,
          processed_at = $2

        WHERE id = $3

        AND status = 'pending'
        `,
        [
          status,
          currentTime(),
          id
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,

        withdrawal_id:
          id,

        status:
          status
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    } finally {
      client.release();
    }
  }
);

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
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            body
          )
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
        text.startsWith(
          "/start "
        )
      ) {
        const parts =
          text.split(/\s+/);

        const startParam =
          parts.length > 1
            ? parts[1]
            : "";

        let user =
          await createUser(
            tgUser
          );

        if (
          startParam &&
          !user.referred_by
        ) {
          await processReferral(
            user.telegram_id,
            startParam
          );

          user =
            await getUser(
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
                      url:
                        APP_URL
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

/* =====================================================
   WEBHOOK SETUP
===================================================== */

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
        url:
          webhookUrl
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

/* =====================================================
   404
===================================================== */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "Not Found"
    });
  }
);

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
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

/* =====================================================
   START SERVER
===================================================== */

async function startServer() {
  try {
    await initDatabase();

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
          "Database: PostgreSQL"
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
  } catch (error) {
    console.error(
      "❌ Server startup failed:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
