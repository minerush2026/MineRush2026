const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}
const welcome = document.getElementById("welcome");

if (welcome && user?.first_name) {
  welcome.textContent =
    `Welcome, ${user.first_name}`;
}
const API = "";

const user =
  tg?.initDataUnsafe?.user || {
    id: "demo-" + Date.now(),
    first_name: "Demo",
    username: ""
  };

let state = null;

const $ = id =>
  document.getElementById(id);

async function call(path, body) {

  const response =
    await fetch(API + path, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body:
        JSON.stringify(body)
    });

  return response.json();
}

function render(u) {

  state = u;

  $("balance").textContent =
    `${Number(
      u.balance || 0
    ).toLocaleString()} MRX`;
}

async function boot() {

  try {

    const r =
      await call(
        "/api/bootstrap",
        { user }
      );

    if (r.ok) {

      render(r.user);

      $("rate").textContent =
        `${r.miningRate} MRX/hour`;

    } else {

      $("status").textContent =
        r.error ||
        "Could not connect";
    }

  } catch (e) {

    $("status").textContent =
      "Connection error";
  }
}

/* =========================
   MINING
========================= */

$("claim").onclick =
  async () => {

    try {

      const r =
        await call(
          "/api/mining/claim",
          {
            telegram_id:
              String(user.id)
          }
        );

      if (r.ok) {

        render(r.user);

        $("status").textContent =
          "Mining claimed successfully";

      } else {

        $("status").textContent =
          r.error;
      }

    } catch (e) {

      $("status").textContent =
        "Connection error";
    }
  };

/* =========================
   DAILY
========================= */

$("daily").onclick =
  async () => {

    const r =
      await call(
        "/api/daily",
        {
          telegram_id:
            String(user.id)
        }
      );

    if (r.ok) {

      render(r.user);

      alert(
        `+${r.amount} MRX daily bonus!`
      );

    } else {

      alert(
        r.error ||
        "Daily bonus unavailable"
      );
    }
  };

/* =========================
   AD
========================= */

$("ad").onclick =
  async () => {

    const r =
      await call(
        "/api/ad/reward",
        {
          telegram_id:
            String(user.id)
        }
      );

    if (r.ok) {

      render(r.user);

      alert(
        `+${r.amount} MRX ad reward`
      );

    } else {

      alert(r.error);
    }
  };

/* =========================
   REFERRAL
========================= */

$("ref").onclick =
  async () => {

    try {

      const response =
        await fetch(
          `/api/referral/${encodeURIComponent(
            String(user.id)
          )}`
        );

      const r =
        await response.json();

      if (!r.ok) {
        alert(
          r.error ||
          "Referral information unavailable"
        );
        return;
      }

      const link =
        r.referralLink;

      if (
        navigator.clipboard
      ) {

        await navigator.clipboard
          .writeText(link);
      }

      alert(
        `👥 Your Referrals: ${r.referralCount}\n\n` +
        `💰 Referral Earnings: ${Number(
          r.referralEarnings
        ).toLocaleString()} MRX\n\n` +
        `🎁 Reward per referral: ${r.referralBonus} MRX\n\n` +
        `🔗 Your Referral Link:\n${link}`
      );

    } catch (e) {

      alert(
        "Could not load referral information"
      );
    }
  };

/* =========================
   WITHDRAW
========================= */

$("withdraw").onclick =
  async () => {

    const amount =
      prompt(
        "USDT amount (minimum 10):",
        "10"
      );

    if (!amount) {
      return;
    }

    const wallet =
      prompt(
        "USDT TRC20 wallet address:"
      );

    if (!wallet) {
      return;
    }

    const r =
      await call(
        "/api/withdraw",
        {
          telegram_id:
            String(user.id),

          amount_usdt:
            Number(amount),

          wallet:
            wallet.trim()
        }
      );

    if (r.ok) {

      render(r.user);

      alert(
        `Withdrawal #${r.withdrawal_id} submitted.`
      );

    } else {

      alert(
        r.error ||
        "Withdrawal failed"
      );
    }
  };

boot();
