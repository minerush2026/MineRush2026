"use strict";

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const API = "";

const user = tg?.initDataUnsafe?.user || null;
const initData = tg?.initData || "";

let state = null;
let miningStart = null;

let adToken = null;
let adExpiresAt = null;
let adRunning = false;

const MAX_MINING_SECONDS = 12 * 60 * 60;

const $ = (id) => document.getElementById(id);


/* =====================================================
   TELEGRAM USER CHECK
===================================================== */

function telegramAvailable() {
  return Boolean(
    tg &&
    initData &&
    user &&
    user.id
  );
}


/* =====================================================
   WELCOME
===================================================== */

const welcome = $("welcome");

if (welcome) {
  welcome.textContent =
    `Welcome, ${user?.first_name || "Miner"}`;
}


/* =====================================================
   API
===================================================== */

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

    const text = await response.text();

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: "Server returned invalid response"
      };
    }

    return result;

  } catch (error) {

    console.error("API error:", error);

    return {
      ok: false,
      error: "Connection error"
    };
  }
}


/* =====================================================
   RENDER
===================================================== */

function render(u) {

  if (!u) return;

  state = u;

  const balance = $("balance");

  if (balance) {

    balance.textContent =
      `${Number(u.balance || 0).toLocaleString()} MRX`;
  }

  const rate = $("rate");

  if (rate && state.mining_rate) {

    rate.textContent =
      `${state.mining_rate} MRX/hour`;
  }
}


/* =====================================================
   MINING TIMER
===================================================== */

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

  const elapsed =
    Math.max(
      0,
      Math.floor(
        (Date.now() - miningStart) / 1000
      )
    );

  const remaining =
    Math.max(
      0,
      MAX_MINING_SECONDS - elapsed
    );

  const hours =
    Math.floor(remaining / 3600);

  const minutes =
    Math.floor((remaining % 3600) / 60);

  const seconds =
    remaining % 60;

  timer.textContent =
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`;

  const percentage =
    Math.min(
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


/* =====================================================
   REFERRAL
===================================================== */

async function loadReferral() {

  if (!telegramAvailable()) {
    return;
  }

  try {

    const response =
      await fetch(
        `/api/referral/${encodeURIComponent(
          String(user.id)
        )}`,
        {
          headers: {
            "X-Telegram-Init-Data": initData
          }
        }
      );

    const result =
      await response.json();

    if (!result.ok) {
      return;
    }

    const count = $("refCount");
    const earned = $("refEarned");

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


/* =====================================================
   BOOT
===================================================== */

async function boot() {

  const status = $("status");

  if (!telegramAvailable()) {

    if (status) {

      status.textContent =
        "Please open MineRush2026 from Telegram.";
    }

    return;
  }

  if (status) {

    status.textContent =
      "Connecting to MineRush2026...";
  }

  const result =
    await call(
      "/api/bootstrap",
      {
        initData
      }
    );

  if (!result.ok) {

    if (status) {

      status.textContent =
        result.error ||
        "Unable to connect";
    }

    console.error(
      "Bootstrap error:",
      result.error
    );

    return;
  }

  render(result.user);

  const rate = $("rate");

  if (rate) {

    rate.textContent =
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

  if (status) {

    status.textContent =
      "Ready to mine";
  }
}


/* =====================================================
   MINING CLAIM
===================================================== */

const claim = $("claim");

if (claim) {

  claim.addEventListener(
    "click",
    async () => {

      if (!telegramAvailable()) {
        alert("Please open the app from Telegram.");
        return;
      }

      claim.disabled = true;

      const status = $("status");

      if (status) {
        status.textContent =
          "Processing...";
      }

      const result =
        await call(
          "/api/mining/claim",
          {
            initData
          }
        );

      if (result.ok) {

        render(result.user);

        if (result.user.mining_started_at) {

          miningStart =
            Number(
              result.user.mining_started_at
            );
        }

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


/* =====================================================
   DAILY BONUS
===================================================== */

const daily = $("daily");

if (daily) {

  daily.addEventListener(
    "click",
    async () => {

      if (!telegramAvailable()) {
        alert("Please open the app from Telegram.");
        return;
      }

      daily.disabled = true;

      const result =
        await call(
          "/api/daily",
          {
            initData
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


/* =====================================================
   WATCH AD
===================================================== */

const ad = $("ad");

async function startAd() {

  if (adRunning) {
    return;
  }

  if (!telegramAvailable()) {
    alert("Please open the app from Telegram.");
    return;
  }

  adRunning = true;

  if (ad) {

    ad.disabled = true;

    ad.textContent =
      "📺 Opening Ad...";
  }

  const result =
    await call(
      "/api/ad/start",
      {
        initData
      }
    );

  if (!result.ok) {

    resetAdButton();

    if (result.cooldown) {

      const minutes =
        Math.ceil(
          Number(
            result.remainingSeconds || 0
          ) / 60
        );

      alert(
        `⏳ Please wait ${minutes} minute(s).`
      );

    } else {

      alert(
        result.error ||
        "Unable to start ad"
      );
    }

    return;
  }

  adToken =
    result.token;

  adExpiresAt =
    Number(result.expiresAt);

  try {

    if (tg?.openLink) {

      tg.openLink(
        result.adUrl
      );

    } else {

      window.open(
        result.adUrl,
        "_blank"
      );
    }

  } catch (error) {

    console.error(
      "Ad open error:",
      error
    );
  }

  const timer =
    setInterval(
      () => {

        const secondsLeft =
          Math.max(
            0,
            Math.ceil(
              (
                adExpiresAt -
                Date.now()
              ) / 1000
            )
          );

        if (ad) {

          ad.textContent =
            secondsLeft > 0
              ? `⏳ Ad ${secondsLeft}s`
              : "🎁 Claiming...";
        }

        if (secondsLeft <= 0) {

          clearInterval(timer);

          claimAdReward();
        }

      },
      500
    );
}


/* =====================================================
   CLAIM AD REWARD
===================================================== */

async function claimAdReward() {

  if (!adToken) {

    resetAdButton();

    return;
  }

  const token =
    adToken;

  adToken = null;

  const result =
    await call(
      "/api/ad/claim",
      {
        initData,
        token
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
      "Ad reward could not be claimed"
    );
  }

  resetAdButton();
}


/* =====================================================
   RESET AD
===================================================== */

function resetAdButton() {

  adRunning = false;

  if (ad) {

    ad.disabled = false;

    ad.textContent =
      "📺 Watch Ad";
  }
}


if (ad) {

  ad.addEventListener(
    "click",
    startAd
  );
}


/* =====================================================
   REFERRAL BUTTON
===================================================== */

const ref = $("ref");

if (ref) {

  ref.addEventListener(
    "click",
    async () => {

      if (!telegramAvailable()) {
        alert("Please open the app from Telegram.");
        return;
      }

      try {

        const response =
          await fetch(
            `/api/referral/${encodeURIComponent(
              String(user.id)
            )}`,
            {
              headers: {
                "X-Telegram-Init-Data": initData
              }
            }
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
          `https://t.me/share/url?url=${encodeURIComponent(
            link
          )}&text=${encodeURIComponent(
            "⛏️ Join MineRush2026 and start mining MRX!"
          )}`;

        if (tg?.openTelegramLink) {

          tg.openTelegramLink(
            shareUrl
          );

        } else {

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


/* =====================================================
   WITHDRAW
===================================================== */

const withdraw = $("withdraw");

if (withdraw) {

  withdraw.addEventListener(
    "click",
    async () => {

      if (!telegramAvailable()) {
        alert("Please open the app from Telegram.");
        return;
      }

      const amount =
        prompt(
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
          "Minimum withdrawal is 10 USDT."
        );

        return;
      }

      const wallet =
        prompt(
          "USDT TRC20 wallet address:"
        );

      if (!wallet) return;

      const result =
        await call(
          "/api/withdraw",
          {
            initData,
            amount_usdt: numericAmount,
            wallet: wallet.trim()
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


/* =====================================================
   TIMER
===================================================== */

setInterval(
  updateMiningTimer,
  1000
);


/* =====================================================
   START
===================================================== */

boot();
