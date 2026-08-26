const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const API = "";

const user =
  tg?.initDataUnsafe?.user || {
    id: "demo-" + Date.now(),
    first_name: "Demo",
    username: ""
  };

const $ = (id) =>
  document.getElementById(id);

const welcome =
  $("welcome");

if (welcome) {
  welcome.textContent =
    `Welcome, ${user.first_name || "Miner"}`;
}

async function call(path, body) {
  try {
    const response =
      await fetch(API + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

    return await response.json();

  } catch (error) {

    console.error(error);

    return {
      ok: false,
      error: "Connection error"
    };
  }
}

function render(userData) {

  if (!userData) return;

  const balance =
    $("balance");

  if (balance) {
    balance.textContent =
      `${Number(
        userData.balance || 0
      ).toLocaleString()} MRX`;
  }
}

/* =========================
   BOOT
========================= */

async function boot() {

  const result =
    await call(
      "/api/bootstrap",
      {
        user
      }
    );

  if (result.ok) {

    render(result.user);

    const rate =
      $("rate");

    if (rate) {
      rate.textContent =
        `${result.miningRate} MRX/hour`;
    }

  } else {

    const status =
      $("status");

    if (status) {
      status.textContent =
        result.error ||
        "Unable to connect";
    }
  }
}

/* =========================
   MINING
========================= */

const claim =
  $("claim");

if (claim) {

  claim.addEventListener(
    "click",
    async function () {

      claim.disabled = true;

      const status =
        $("status");

      if (status) {
        status.textContent =
          "Processing...";
      }

      const result =
        await call(
          "/api/mining/claim",
          {
            telegram_id:
              String(user.id)
          }
        );

      if (result.ok) {

        render(result.user);

        if (status) {
          status.textContent =
            "Mining claimed successfully!";
        }

      } else {

        if (status) {
          status.textContent =
            result.error ||
            "Mining failed";
        }
      }

      setTimeout(() => {
        claim.disabled = false;
      }, 700);
    }
  );
}

/* =========================
   DAILY BONUS
========================= */

const daily =
  $("daily");

if (daily) {

  daily.addEventListener(
    "click",
    async function () {

      daily.disabled = true;

      const result =
        await call(
          "/api/daily",
          {
            telegram_id:
              String(user.id)
          }
        );

      if (result.ok) {

        render(result.user);

        alert(
          `🎁 +${result.amount} MRX Daily Bonus!`
        );

      } else {

        alert(
          result.error ||
          "Daily bonus unavailable"
        );
      }

      daily.disabled = false;
    }
  );
}

/* =========================
   AD
========================= */

const ad =
  $("ad");

if (ad) {

  ad.addEventListener(
    "click",
    async function () {

      ad.disabled = true;

      const result =
        await call(
          "/api/ad/reward",
          {
            telegram_id:
              String(user.id)
          }
        );

      if (result.ok) {

        render(result.user);

        alert(
          `📺 +${result.amount} MRX`
        );

      } else {

        alert(
          result.error ||
          "Ad reward unavailable"
        );
      }

      ad.disabled = false;
    }
  );
}

/* =========================
   REFERRAL
========================= */

const ref =
  $("ref");

if (ref) {

  ref.addEventListener(
    "click",
    async function () {

      try {

        const response =
          await fetch(
            `/api/referral/${encodeURIComponent(
              String(user.id)
            )}`
          );

        const result =
          await response.json();

        if (!result.ok) {

          alert(
            result.error ||
            "Referral information unavailable"
          );

          return;
        }

        const link =
          result.referralLink;

        if (
          navigator.clipboard
        ) {

          try {
            await navigator.clipboard
              .writeText(link);
          } catch (e) {}
        }

        alert(
          `👥 Referrals: ${result.referralCount}\n\n` +
          `💰 Earnings: ${Number(
            result.referralEarnings
          ).toLocaleString()} MRX\n\n` +
          `🎁 Per referral: ${result.referralBonus} MRX\n\n` +
          `🔗 ${link}`
        );

      } catch (error) {

        alert(
          "Referral system unavailable"
        );
      }
    }
  );
}

/* =========================
   WITHDRAW
========================= */

const withdraw =
  $("withdraw");

if (withdraw) {

  withdraw.addEventListener(
    "click",
    async function () {

      const amount =
        prompt(
          "USDT amount (minimum 10):",
          "10"
        );

      if (!amount) return;

      const wallet =
        prompt(
          "USDT TRC20 wallet address:"
        );

      if (!wallet) return;

      const result =
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

      if (result.ok) {

        render(result.user);

        alert(
          `💸 Withdrawal #${result.withdrawal_id} submitted.`
        );

      } else {

        alert(
          result.error ||
          "Withdrawal failed"
        );
      }
    }
  );
}

/* START */

boot();
