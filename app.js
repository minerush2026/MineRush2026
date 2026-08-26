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

let state = null;

const $ = id =>
  document.getElementById(id);


/* =========================
   USER NAME
========================= */

const welcome =
  $("welcome");

if (welcome) {
  welcome.textContent =
    `Welcome, ${user.first_name || "Miner"}`;
}


/* =========================
   API
========================= */

async function call(path, body) {

  try {

    const response =
      await fetch(
        API + path,
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

    return await response.json();

  } catch (error) {

    console.error(error);

    return {
      ok: false,
      error: "Connection error"
    };
  }
}


/* =========================
   RENDER
========================= */

function render(u) {

  if (!u) return;

  state = u;

  const balance =
    $("balance");

  if (balance) {

    balance.textContent =
      `${Number(
        u.balance || 0
      ).toLocaleString()} MRX`;
  }
}


/* =========================
   MINING TIMER
========================= */

let miningStart = null;

const MAX_MINING_SECONDS =
  12 * 60 * 60;

function updateMiningTimer() {

  const timer =
    $("timer");

  const progressBar =
    $("progressBar");

  const progressText =
    $("progressText");

  const miningStatus =
    $("miningStatus");

  if (!timer) return;

  if (!miningStart) {

    timer.textContent =
      "12:00:00";

    if (progressBar) {
      progressBar.style.width =
        "0%";
    }

    if (progressText) {
      progressText.textContent =
        "0%";
    }

    if (miningStatus) {
      miningStatus.textContent =
        "READY TO MINE";
    }

    return;
  }

  const elapsed =
    Math.floor(
      (Date.now() - miningStart) / 1000
    );

  const remaining =
    Math.max(
      0,
      MAX_MINING_SECONDS - elapsed
    );

  const hours =
    Math.floor(
      remaining / 3600
    );

  const minutes =
    Math.floor(
      (remaining % 3600) / 60
    );

  const seconds =
    remaining % 60;

  timer.textContent =
    `${String(hours).padStart(2,"0")}:` +
    `${String(minutes).padStart(2,"0")}:` +
    `${String(seconds).padStart(2,"0")}`;

  const percentage =
    Math.min(
      100,
      (elapsed /
        MAX_MINING_SECONDS) * 100
    );

  if (progressBar) {
    progressBar.style.width =
      `${percentage}%`;
  }

  if (progressText) {
    progressText.textContent =
      `${Math.floor(percentage)}%`;
  }

  if (miningStatus) {

    miningStatus.textContent =
      remaining > 0
        ? "MINING ACTIVE"
        : "MINING COMPLETE";
  }
}


/* =========================
   REFERRAL DASHBOARD
========================= */

async function loadReferral() {

  try {

    const response =
      await fetch(
        `/api/referral/${encodeURIComponent(
          String(user.id)
        )}`
      );

    const result =
      await response.json();

    if (!result.ok) return;

    const count =
      $("refCount");

    const earned =
      $("refEarned");

    if (count) {
      count.textContent =
        Number(
          result.referralCount || 0
        ).toLocaleString();
    }

    if (earned) {
      earned.textContent =
        `${Number(
          result.referralEarnings || 0
        ).toLocaleString()} MRX`;
    }

  } catch (error) {

    console.error(
      "Referral error:",
      error
    );
  }
}


/* =========================
   BOOT
========================= */

async function boot() {

  const result =
    await call(
      "/api/bootstrap",
      { user }
    );

  if (result.ok) {

    render(result.user);

    const rate =
      $("rate");

    if (rate) {

      rate.textContent =
        `${result.miningRate} MRX/hour`;
    }

    /*
      Server timestamp is used
      to show a local countdown.
    */

    if (result.user.mining_started_at) {

      miningStart =
        Number(
          result.user.mining_started_at
        );
    }

    updateMiningTimer();

    await loadReferral();

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
   MINING BUTTON
========================= */

const claim =
  $("claim");

if (claim) {

  claim.addEventListener(
    "click",
    async () => {

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

        miningStart =
          Number(
            result.user.mining_started_at
          );

        updateMiningTimer();

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

      setTimeout(
        () => {
          claim.disabled = false;
        },
        700
      );
    }
  );
}


/* =========================
   DAILY
========================= */

const daily =
  $("daily");

if (daily) {

  daily.addEventListener(
    "click",
    async () => {

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
          result.error
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
    async () => {

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
          result.error
        );
      }

      ad.disabled = false;
    }
  );
}


/* =========================
   REFERRAL BUTTON
========================= */

const ref =
  $("ref");

if (ref) {

  ref.addEventListener(
    "click",
    async () => {

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
            "Referral unavailable"
          );

          return;
        }

        const link =
          result.referralLink;

        /*
          Telegram share button.
        */

        const shareUrl =
          `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
            "⛏️ Join MineRush2026 and start mining MRX!"
          )}`;

        if (tg) {

          tg.openTelegramLink(
            shareUrl
          );

        } else {

          alert(
            `Your referral link:\n\n${link}`
          );
        }

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
    async () => {

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


/* =========================
   TIMER LOOP
========================= */

setInterval(
  updateMiningTimer,
  1000
);


/* =========================
   START
========================= */

boot();
