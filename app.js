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

const $ = (id) => document.getElementById(id);

let state = null;
let miningStart = null;

const MAX_MINING_SECONDS = 12 * 60 * 60;

let adRunning = false;
let adTimer = null;
let adSeconds = 20;


/* =========================
   WELCOME
========================= */

const welcome = $("welcome");

if (welcome) {
  welcome.textContent =
    `Welcome, ${user.first_name || "Miner"} 👋`;
}


/* =========================
   API
========================= */

async function call(path, body = {}) {

  try {

    const response = await fetch(
      API + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
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
   RENDER USER
========================= */

function render(u) {

  if (!u) return;

  state = u;

  const balance = $("balance");

  if (balance) {
    balance.textContent =
      `${Number(u.balance || 0).toLocaleString()} MRX`;
  }

  const refCount = $("refCount");

  if (refCount) {
    refCount.textContent =
      Number(u.referral_count || 0).toLocaleString();
  }

  const refEarned = $("refEarned");

  if (refEarned) {
    refEarned.textContent =
      `${Number(u.referral_earnings || 0).toLocaleString()} MRX`;
  }
}


/* =========================
   MINING TIMER
========================= */

function updateMiningTimer() {

  const timer = $("timer");
  const progressBar = $("progressBar");
  const progressText = $("progressText");
  const miningStatus = $("miningStatus");

  if (!timer) return;

  if (!miningStart) {

    timer.textContent = "12:00:00";

    if (progressBar) {
      progressBar.style.width = "0%";
    }

    if (progressText) {
      progressText.textContent = "0%";
    }

    if (miningStatus) {
      miningStatus.textContent = "READY TO MINE";
    }

    return;
  }

  const elapsed = Math.floor(
    (Date.now() - miningStart) / 1000
  );

  const remaining = Math.max(
    0,
    MAX_MINING_SECONDS - elapsed
  );

  const hours = Math.floor(
    remaining / 3600
  );

  const minutes = Math.floor(
    (remaining % 3600) / 60
  );

  const seconds = remaining % 60;

  timer.textContent =
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`;

  const percentage = Math.min(
    100,
    (elapsed / MAX_MINING_SECONDS) * 100
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
   REFERRAL
========================= */

async function loadReferral() {

  try {

    const response = await fetch(
      `/api/referral/${encodeURIComponent(
        String(user.id)
      )}`
    );

    const result = await response.json();

    if (!result.ok) return;

    if ($("refCount")) {
      $("refCount").textContent =
        Number(
          result.referralCount || 0
        ).toLocaleString();
    }

    if ($("refEarned")) {
      $("refEarned").textContent =
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

  const result = await call(
    "/api/bootstrap",
    { user }
  );

  if (!result.ok) {

    if ($("status")) {
      $("status").textContent =
        result.error ||
        "Unable to connect";
    }

    return;
  }

  render(result.user);

  if ($("rate")) {
    $("rate").textContent =
      `${result.miningRate} MRX/hour`;
  }

  if (result.user.mining_started_at) {
    miningStart =
      Number(
        result.user.mining_started_at
      );
  }

  updateMiningTimer();

  await loadReferral();
}


/* =========================
   MINING CLAIM
========================= */

const claim = $("claim");

if (claim) {

  claim.addEventListener(
    "click",
    async () => {

      claim.disabled = true;

      if ($("status")) {
        $("status").textContent =
          "Processing...";
      }

      const result = await call(
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

        if ($("status")) {
          $("status").textContent =
            "Mining claimed successfully!";
        }

      } else {

        if ($("status")) {
          $("status").textContent =
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

const daily = $("daily");

if (daily) {

  daily.addEventListener(
    "click",
    async () => {

      daily.disabled = true;

      const result = await call(
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
   WATCH AD
========================= */

const ad = $("ad");

function stopAdTimer() {

  if (adTimer) {
    clearInterval(adTimer);
    adTimer = null;
  }

  adRunning = false;
  adSeconds = 20;

  if (ad) {
    ad.disabled = false;
    ad.textContent = "📺 Watch Ad";
  }
}


if (ad) {

  ad.addEventListener(
    "click",
    async () => {

      if (adRunning) return;

      adRunning = true;
      adSeconds = 20;

      ad.disabled = true;

      ad.textContent =
        `📺 Ad running... ${adSeconds}s`;

      /*
        Open the Adsterra ad area if available.
        The actual Adsterra script is loaded
        from index.html.
      */

      const adBox = $("adContainer");

      if (adBox) {
        adBox.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      }

      adTimer = setInterval(
        async () => {

          adSeconds--;

          if (ad) {
            ad.textContent =
              `📺 Ad running... ${adSeconds}s`;
          }

          if (adSeconds <= 0) {

            clearInterval(adTimer);
            adTimer = null;

            /*
              Ask server for reward.
              Server-side cooldown should prevent
              repeated immediate rewards.
            */

            const result = await call(
              "/api/ad/reward",
              {
                telegram_id:
                  String(user.id)
              }
            );

            if (result.ok) {

              render(result.user);

              alert(
                `🎉 +${result.amount} MRX Ad Reward!`
              );

            } else {

              alert(
                result.error ||
                "Ad reward unavailable"
              );
            }

            stopAdTimer();
          }

        },
        1000
      );
    }
  );
}


/* =========================
   REFERRAL BUTTON
========================= */

const ref = $("ref");

if (ref) {

  ref.addEventListener(
    "click",
    async () => {

      try {

        const response = await fetch(
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

        const shareUrl =
          `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
            "⛏️ Join MineRush2026 and start mining MRX!"
          )}`;

        if (tg) {

          tg.openTelegramLink(
            shareUrl
          );

        } else {

          if (navigator.clipboard) {
            await navigator.clipboard.writeText(link);
          }

          alert(
            `Your referral link:\n\n${link}`
          );
        }

      } catch (error) {

        console.error(error);

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

const withdraw = $("withdraw");

if (withdraw) {

  withdraw.addEventListener(
    "click",
    async () => {

      const amount = prompt(
        "USDT amount (minimum 10):",
        "10"
      );

      if (!amount) return;

      const numericAmount =
        Number(amount);

      if (
        !Number.isFinite(numericAmount) ||
        numericAmount < 10
      ) {

        alert(
          "Minimum withdrawal is 10 USDT"
        );

        return;
      }

      const requiredMRX =
        numericAmount * 1000;

      const confirmWithdraw =
        confirm(
          `${numericAmount} USDT = ${requiredMRX.toLocaleString()} MRX\n\nContinue?`
        );

      if (!confirmWithdraw) return;

      const wallet = prompt(
        "Enter your USDT TRC20 wallet address:"
      );

      if (!wallet) return;

      const result = await call(
        "/api/withdraw",
        {
          telegram_id:
            String(user.id),

          amount_usdt:
            numericAmount,

          wallet:
            wallet.trim()
        }
      );

      if (result.ok) {

        render(result.user);

        alert(
          `💸 Withdrawal #${result.withdrawal_id} submitted successfully.`
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
   START APP
========================= */

boot();
