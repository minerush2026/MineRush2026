import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const db = new Database(process.env.DB_FILE || "./minerush.sqlite");

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
const mrXPerHour = Number(process.env.MRX_PER_HOUR || 10);
const adReward = Number(process.env.MRX_PER_AD || 25);
const referralBonus = Number(process.env.REFERRAL_BONUS_MRX || 500);
const minWithdraw = Number(process.env.MIN_WITHDRAW_USDT || 10);

function upsertUser(tg) {
  if (!tg?.id) throw new Error("Missing Telegram user");
  const existing = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(tg.id));
  if (!existing) {
    db.prepare(`INSERT INTO users
      (telegram_id, username, first_name, created_at)
      VALUES (?, ?, ?, ?)`).run(String(tg.id), tg.username || "", tg.first_name || "", now());
  } else {
    db.prepare("UPDATE users SET username=?, first_name=? WHERE telegram_id=?")
      .run(tg.username || "", tg.first_name || "", String(tg.id));
  }
  return db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(tg.id));
}

function claimMining(userId) {
  const user = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(userId));
  if (!user) throw new Error("User not found");

  const current = now();
  const start = user.mining_started_at || current;
  const elapsedHours = Math.min(12, Math.floor((current - start) / 3600000));
  const earned = elapsedHours * mrXPerHour;

  if (earned > 0) {
    db.prepare("UPDATE users SET balance=balance+?, mining_started_at=? WHERE telegram_id=?")
      .run(earned, current, String(userId));
    db.prepare("INSERT INTO transactions (telegram_id,type,amount,note,created_at) VALUES (?,?,?,?,?)")
      .run(String(userId), "mining", earned, `${elapsedHours} hour(s)`, current);
  } else if (!user.mining_started_at) {
    db.prepare("UPDATE users SET mining_started_at=? WHERE telegram_id=?").run(current, String(userId));
  }

  return db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(userId));
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "MineRush2026" }));

app.post("/api/bootstrap", (req, res) => {
  try {
    const user = upsertUser(req.body.user);
    const claimed = claimMining(user.telegram_id);
    res.json({ ok: true, user: claimed, miningRate: mrXPerHour });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/mining/claim", (req, res) => {
  try {
    const user = claimMining(req.body.telegram_id);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/daily", (req, res) => {
  try {
    const id = String(req.body.telegram_id);
    const user = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
    if (!user) throw new Error("User not found");
    const day = new Date().toISOString().slice(0,10);
    if (user.last_daily_bonus === day) return res.json({ok:false,error:"Daily bonus already claimed"});
    const amount = 100;
    db.prepare("UPDATE users SET balance=balance+?, last_daily_bonus=? WHERE telegram_id=?").run(amount,day,id);
    db.prepare("INSERT INTO transactions (telegram_id,type,amount,note,created_at) VALUES (?,?,?,?,?)")
      .run(id,"daily",amount,"Daily bonus",now());
    res.json({ok:true, amount, user:db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id)});
  } catch(e) { res.status(400).json({ok:false,error:e.message}); }
});

app.post("/api/ad/reward", (req, res) => {
  try {
    const id = String(req.body.telegram_id);
    const user = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
    if (!user) throw new Error("User not found");
    // IMPORTANT: This endpoint is only a placeholder.
    // Production must verify a trusted ad-network callback/event before crediting rewards.
    const amount = adReward;
    db.prepare("UPDATE users SET balance=balance+? WHERE telegram_id=?").run(amount,id);
    db.prepare("INSERT INTO transactions (telegram_id,type,amount,note,created_at) VALUES (?,?,?,?,?)")
      .run(id,"ad_reward",amount,"Ad reward (MVP)",now());
    res.json({ok:true,amount,user:db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id)});
  } catch(e) { res.status(400).json({ok:false,error:e.message}); }
});

app.post("/api/withdraw", (req, res) => {
  try {
    const id = String(req.body.telegram_id);
    const amount = Number(req.body.amount_usdt);
    const wallet = String(req.body.wallet || "").trim();
    if (!wallet) throw new Error("Wallet is required");
    if (!Number.isFinite(amount) || amount < minWithdraw) throw new Error(`Minimum withdrawal is ${minWithdraw} USDT`);

    const user = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
    if (!user) throw new Error("User not found");
    // MVP exchange rate: 1000 MRX = 1 USDT. Make this configurable later.
    const required = amount * 1000;
    if (user.balance < required) throw new Error("Insufficient MRX balance");

    const tx = db.transaction(() => {
      db.prepare("UPDATE users SET balance=balance-? WHERE telegram_id=?").run(required,id);
      const result = db.prepare(`INSERT INTO withdrawals
        (telegram_id,amount_usdt,wallet,status,created_at) VALUES (?,?,?,?,?)`)
        .run(id,amount,wallet,"pending",now());
      db.prepare("INSERT INTO transactions (telegram_id,type,amount,note,created_at) VALUES (?,?,?,?,?)")
        .run(id,"withdrawal",-required,`Withdrawal request #${result.lastInsertRowid}`,now());
      return result.lastInsertRowid;
    });
    res.json({ok:true,withdrawal_id:tx(),user:db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id)});
  } catch(e) { res.status(400).json({ok:false,error:e.message}); }
});

function admin(req,res,next) {
  if (!process.env.ADMIN_KEY || req.headers["x-admin-key"] !== process.env.ADMIN_KEY)
    return res.status(401).json({ok:false,error:"Unauthorized"});
  next();
}

app.get("/api/admin/stats", admin, (_,res) => {
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c;
  const balance = db.prepare("SELECT COALESCE(SUM(balance),0) s FROM users").get().s;
  res.json({ok:true,users,pendingWithdrawals:pending,totalMRX:balance});
});

app.get("/api/admin/withdrawals", admin, (_,res) => {
  res.json({ok:true,items:db.prepare("SELECT * FROM withdrawals ORDER BY id DESC LIMIT 200").all()});
});app.get("/", (_, res) => {
  res.json({
    ok: true,
    service: "MineRush2026",
    status: "online",
    message: "MineRush2026 API is running successfully"
  });

});

app.post("/api/admin/withdrawals/:id/status", admin, (req,res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status);
  if (!["pending","paid","rejected"].includes(status)) return res.status(400).json({ok:false,error:"Invalid status"});
  db.prepare("UPDATE withdrawals SET status=?, processed_at=? WHERE id=?")
    .run(status, status === "pending" ? null : now(), id);
  res.json({ok:true});
});

app.listen(PORT, () => console.log(`MineRush2026 API listening on :${PORT}`));
