"use strict";

/* =========================================================
   TELEGRAM
========================================================= */

const tg =
  window.Telegram?.WebApp || null;

if (tg) {
  try {
    tg.ready();
    tg.expand();
  } catch (error) {
    console.error(
      "Telegram WebApp error:",
      error
    );
  }
}

/* =========================================================
   CONFIG
========================================================= */

const API = "";

const DEFAULT_MINING_RATE = 10;
const DEFAULT_MINING_CYCLE =
  12 * 60 * 60;

const DEFAULT_DAILY_BONUS = 100;
const DEFAULT_AD_REWARD = 25;
const DEFAULT_REFERRAL_BONUS = 500;
const DEFAULT_MIN_WITHDRAW = 10;
const DEFAULT_MRX_PER_USDT = 1000;

/* =========================================================
   STATE
========================================================= */

let state = null;

let telegramUser = null;

let miningStart = null;

let miningCycleSeconds =
  DEFAULT_MINING_CYCLE;

let adToken = null;
let adExpiresAt = null;
let adRunning = false;
let adTimer = null;

/* =========================================================
   DOM
========================================================= */

const $ = (id) =>
  document.getElementById(id);

/* =========================================================
   TELEGRAM USER
========================================================= */

function refreshTelegramUser() {
  const user =
    tg?.initDataUnsafe?.user;

  if (user?.id) {
    telegramUser = user;
  }

  return telegramUser;
}

function telegramAvailable() {
  refreshTelegramUser();

  return Boolean(
    tg &&
    tg.initData &&
    telegramUser?.id
  );
}

function getTelegramId() {
  refreshTelegramUser();

  return telegramUser?.id
    ? String(telegramUser.id)
    : "";
}

/* =========================================================
   PROFILE
========================================================= */

function getFirstName() {
  return (
    telegramUser?.first_name ||
    "Miner"
  );
}

function getUsername() {
  return telegramUser?.username
    ? String(
        telegramUser.username
      )
    : "";
}

function getPhoto() {
  return (
    telegramUser?.photo_url ||
    ""
  );
}

function renderProfile() {
  const welcome =
    $("welcome");

  const avatar =
    $("avatar");

  const firstName =
    getFirstName();

  const username =
    getUsername();

  const photo =
    getPhoto();

  if (welcome) {
    welcome.textContent =
      username
        ? `Welcome, ${firstName} • @${username}`
        : `Welcome, ${firstName}`;
  }

  if (!avatar) {
    return;
  }

  avatar.innerHTML = "";

  if (photo) {
    const img =
      document.createElement(
        "img"
      );

    img.src = photo;

    img.alt = firstName;

    img.loading = "eager";

    img.referrerPolicy =
      "no-referrer";

    img.onerror = () => {
      avatar.innerHTML = "👤";
    };

    avatar.appendChild(img);
  } else {
    avatar.textContent =
      "👤";
  }
}

/* =========================================================
   NUMBER
========================================================= */

function formatNumber(
  value,
  decimals = 4
) {
  const number =
    Number(value ?? 0);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString(
    undefined,
    {
      minimumFractionDigits: 0,
      maximumFractionDigits:
        decimals
    }
  );
}

/* =========================================================
   STATUS
========================================================= */

function setStatus(text) {
  const element =
    $("status");

  if (element) {
    element.textContent =
      text || "";
  }
}

/* =========================================================
   API
========================================================= */

async function call(
  endpoint,
  body = {}
) {
  try {
    refreshTelegramUser();

    const initData =
      tg?.initData || "";

    if (!initData) {
      return {
        ok: false,
        error:
          "Telegram authentication data not found."
      };
    }

    const response =
      await fetch(
        API + endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            ...body,
            initData
          })
        }
      );

    const text =
      await response.text();

    let result = {};

    try {
      result =
        text
          ? JSON.parse(text)
          : {};
    } catch {
      console.error(
        "Invalid server response:",
        text
      );

      return {
        ok: false,
        error:
          "Invalid server response."
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error:
          result.error ||
          `Server error ${response.status}`
      };
    }

    return result;
  } catch (error) {
    console.error(
      "API error:",
      error
    );

    return {
      ok: false,
      error:
        "Connection failed. Please try again."
    };
  }
}

/* =========================================================
   RENDER USER
========================================================= */

function render(user) {
  if (!user) {
    return;
  }

  state = user;

  /* BALANCE */

  const balance =
    $("balance");

  if (balance) {
    balance.textContent =
      `${formatNumber(
        user.balance,
        4
      )} MRX`;
  }

  /* RATE */

  const rateElement =
    $("rate");

  if (rateElement) {
    const rate =
      Number(
        state.mining_rate ??
        state.miningRate ??
        DEFAULT_MINING_RATE
      );

    rateElement.textContent =
      `${formatNumber(
        rate,
        2
      )} MRX/hour`;
  }

  /* MINING START */

  if (
    user.mining_started_at !==
      null &&
    user.mining_started_at !==
      undefined
  ) {
    const start =
      Number(
        user.mining_started_at
      );

    if (
      Number.isFinite(start) &&
      start > 0
    ) {
      miningStart =
        start;
    }
  } else {
    miningStart = null;
  }

  updateMiningTimer();
}

/* =========================================================
   MINING TIMER
========================================================= */

function updateMiningTimer() {
  const timer =
    $("timer");

  const progressBar =
    $("progressBar");

  const progressText =
    $("progressText");

  const miningStatus =
    $("miningStatus");

  const claim =
    $("claim");

  if (!timer) {
    return;
  }

  if (!miningStart) {
    timer.textContent =
      formatTime(
        miningCycleSeconds
      );

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

    if (claim) {
      claim.disabled = false;
    }

    return;
  }

  const elapsed =
    Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          miningStart
        ) / 1000
      )
    );

  const remaining =
    Math.max(
      0,
      miningCycleSeconds -
        elapsed
    );

  timer.textContent =
    formatTime(
      remaining
    );

  const percent =
    Math.min(
      100,
      (
        elapsed /
        miningCycleSeconds
      ) * 100
    );

  if (progressBar) {
    progressBar.style.width =
      `${percent}%`;
  }

  if (progressText) {
    progressText.textContent =
      `${Math.floor(
        percent
      )}%`;
  }

  if (miningStatus) {
    miningStatus.textContent =
      remaining > 0
        ? "MINING ACTIVE"
        : "MINING COMPLETE";
  }

  if (claim) {
    claim.disabled = false;
  }
}

/* =========================================================
   TIME FORMAT
========================================================= */

function formatTime(
  totalSeconds
) {
  const seconds =
    Math.max(
      0,
      Math.floor(
        Number(
          totalSeconds
        ) || 0
      )
    );

  const hours =
    Math.floor(
      seconds / 3600
    );

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  const secs =
    seconds % 60;

  return (
    `${String(hours).padStart(
      2,
      "0"
    )}:` +
    `${String(minutes).padStart(
      2,
      "0"
    )}:` +
    `${String(secs).padStart(
      2,
      "0"
    )}`
  );
}

/* =========================================================
   BOOT
========================================================= */

async function boot() {
  refreshTelegramUser();

  renderProfile();

  if (!telegramAvailable()) {
    setStatus(
      "Please open MineRush2026 from Telegram."
    );

    return;
  }

  setStatus(
    "Connecting to MineRush2026..."
  );

  const result =
    await call(
      "/api/bootstrap"
    );

  if (!result.ok) {
    setStatus(
      result.error ||
      "Unable to connect."
    );

    console.error(
      "Bootstrap error:",
      result.error
    );

    return;
  }

  if (result.settings) {
    miningCycleSeconds =
      Number(
        result.settings
          .miningCycleSeconds ||
        (
          Number(
            result.settings
              .miningCycleHours ||
            12
          ) * 3600
        )
      );
  }

  render(
    result.user
  );

  setStatus(
    "Ready to mine"
  );

  await loadReferral();
}

/* =========================================================
   REFRESH BALANCE
========================================================= */

async function refreshBalance() {
  if (!telegramAvailable()) {
    return;
  }

  const result =
    await call(
      "/api/bootstrap"
    );

  if (!result.ok) {
    console.error(
      "Balance refresh:",
      result.error
    );

    return;
  }

  if (result.settings) {
    miningCycleSeconds =
      Number(
        result.settings
          .miningCycleSeconds ||
        (
          Number(
            result.settings
              .miningCycleHours ||
            12
          ) * 3600
        )
      );
  }

  render(
    result.user
  );
}

/* =========================================================
   MINING CLAIM
========================================================= */

const claim =
  $("claim");

if (claim) {
  claim.addEventListener(
    "click",
    async () => {
      if (!telegramAvailable()) {
        alert(
          "Please open MineRush2026 from Telegram."
        );

        return;
      }

      claim.disabled = true;

      setStatus(
        "Processing mining..."
      );

      const result =
        await call(
          "/api/mining/claim"
        );

      if (result.ok) {
        render(
          result.user
        );

        setStatus(
          "Mining reward saved on server!"
        );
      } else {
        setStatus(
          result.error ||
          "Mining failed."
        );

        alert(
          result.error ||
          "Mining failed."
        );

        await refreshBalance();
      }

      setTimeout(
        () => {
          claim.disabled =
            false;
        },
        1000
      );
    }
  );
}

/* =========================================================
   DAILY BONUS
========================================================= */

const daily =
  $("daily");

if (daily) {
  daily.addEventListener(
    "click",
    async () => {
      if (!telegramAvailable()) {
        alert(
          "Please open MineRush2026 from Telegram."
        );

        return;
      }

      daily.disabled =
        true;

      setStatus(
        "Checking daily bonus..."
      );

      const result =
        await call(
          "/api/daily"
        );

      if (result.ok) {
        render(
          result.user
        );

        alert(
          `🎁 +${formatNumber(
            result.amount
          )} MRX Daily Bonus!`
        );

        setStatus(
          "Daily bonus added!"
        );
      } else {
        alert(
          result.error ||
          "Daily bonus unavailable."
        );

        if (result.user) {
          render(
            result.user
          );
        }
      }

      daily.disabled =
        false;
    }
  );
}

/* =========================================================
   AD
========================================================= */

const ad =
  $("ad");

async function startAd() {
  if (adRunning) {
    return;
  }

  if (!telegramAvailable()) {
    alert(
      "Please open MineRush2026 from Telegram."
    );

    return;
  }

  adRunning = true;

  if (ad) {
    ad.disabled = true;

    ad.textContent =
      "📺 Opening Ad...";
  }

  setStatus(
    "Preparing advertisement..."
  );

  const result =
    await call(
      "/api/ad/start"
    );

  if (!result.ok) {
    resetAdButton();

    alert(
      result.error ||
      "Unable to start advertisement."
    );

    setStatus(
      result.error ||
      "Advertisement unavailable."
    );

    return;
  }

  adToken =
    String(
      result.token || ""
    );

  adExpiresAt =
    Number(
      result.expiresAt
    );

  if (
    !adToken ||
    !Number.isFinite(
      adExpiresAt
    )
  ) {
    resetAdButton();

    alert(
      "Invalid advertisement session."
    );

    return;
  }

  setStatus(
    "Ad opened. Please wait 30 seconds."
  );

  try {
    if (
      tg &&
      typeof tg.openLink ===
        "function"
    ) {
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

  startAdTimer();
}

/* =========================================================
   AD TIMER
========================================================= */

function startAdTimer() {
  stopAdTimer();

  updateAdCountdown();

  adTimer =
    setInterval(
      updateAdCountdown,
      500
    );
}

function updateAdCountdown() {
  if (!adExpiresAt) {
    stopAdTimer();

    return;
  }

  const left =
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
      left > 0
        ? `⏳ Ad ${left}s`
        : "🎁 Claiming...";
  }

  if (left <= 0) {
    stopAdTimer();

    claimAdReward();
  }
}

/* =========================================================
   STOP AD
========================================================= */

function stopAdTimer() {
  if (adTimer) {
    clearInterval(
      adTimer
    );

    adTimer = null;
  }
}

/* =========================================================
   CLAIM AD
========================================================= */

async function claimAdReward() {
  if (!adToken) {
    resetAdButton();

    return;
  }

  const token =
    adToken;

  adToken = null;

  setStatus(
    "Verifying advertisement..."
  );

  const result =
    await call(
      "/api/ad/claim",
      {
        token
      }
    );

  if (result.ok) {
    render(
      result.user
    );

    alert(
      `🎉 +${formatNumber(
        result.amount
      )} MRX Ad Reward!`
    );

    setStatus(
      "Ad reward added!"
    );
  } else {
    alert(
      result.error ||
      "Ad reward could not be claimed."
    );

    setStatus(
      result.error ||
      "Ad reward failed."
    );

    await refreshBalance();
  }

  resetAdButton();
}

/* =========================================================
   RESET AD
========================================================= */

function resetAdButton() {
  stopAdTimer();

  adRunning = false;

  adToken = null;

  adExpiresAt = null;

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

/* =========================================================
   REFERRAL
========================================================= */

async function loadReferral() {
  if (!telegramAvailable()) {
    return;
  }

  const result =
    await call(
      "/api/referral"
    );

  if (!result.ok) {
    console.error(
      "Referral:",
      result.error
    );

    return;
  }

  const count =
    $("refCount");

  const earned =
    $("refEarned");

  if (count) {
    count.textContent =
      formatNumber(
        result.referralCount || 0,
        0
      );
  }

  if (earned) {
    earned.textContent =
      `${formatNumber(
        result.referralEarnings || 0
      )} MRX`;
  }
}

/* =========================================================
   REFERRAL BUTTON
========================================================= */

const ref =
  $("ref");

if (ref) {
  ref.addEventListener(
    "click",
    async () => {
      if (!telegramAvailable()) {
        alert(
          "Please open MineRush2026 from Telegram."
        );

        return;
      }

      ref.disabled = true;

      try {
        const result =
          await call(
            "/api/referral"
          );

        if (!result.ok) {
          alert(
            result.error ||
            "Referral unavailable."
          );

          return;
        }

        const link =
          result.referralLink;

        if (!link) {
          alert(
            "Referral link unavailable."
          );

          return;
        }

        const shareUrl =
          `https://t.me/share/url?url=${encodeURIComponent(
            link
          )}&text=${encodeURIComponent(
            "⛏️ Join MineRush2026 and start mining MRX!"
          )}`;

        if (
          tg &&
          typeof tg.openTelegramLink ===
            "function"
        ) {
          tg.openTelegramLink(
            shareUrl
          );
        } else {
          alert(
            `Your referral link:\n\n${link}`
          );
        }
      } catch (error) {
        console.error(
          "Referral error:",
          error
        );

        alert(
          "Referral system unavailable."
        );
      } finally {
        ref.disabled =
          false;
      }
    }
  );
}

/* =========================================================
   WITHDRAW
========================================================= */

const withdraw =
  $("withdraw");

if (withdraw) {
  withdraw.addEventListener(
    "click",
    async () => {
      if (!telegramAvailable()) {
        alert(
          "Please open MineRush2026 from Telegram."
        );

        return;
      }

      const minimum =
        DEFAULT_MIN_WITHDRAW;

      const mrxPerUsdt =
        DEFAULT_MRX_PER_USDT;

      const amountInput =
        prompt(
          `USDT amount (minimum ${minimum}):`,
          String(minimum)
        );

      if (
        amountInput === null ||
        !amountInput.trim()
      ) {
        return;
      }

      const amount =
        Number(
          amountInput.trim()
        );

      if (
        !Number.isFinite(amount) ||
        amount < minimum
      ) {
        alert(
          `Minimum withdrawal is ${minimum} USDT.`
        );

        return;
      }

      const requiredMRX =
        amount *
        mrxPerUsdt;

      await refreshBalance();

      if (
        Number(
          state?.balance || 0
        ) <
        requiredMRX
      ) {
        alert(
          `Insufficient MRX balance.\n\n` +
          `Required: ${formatNumber(
            requiredMRX
          )} MRX\n` +
          `Balance: ${formatNumber(
            state?.balance || 0
          )} MRX`
        );

        return;
      }

      const wallet =
        prompt(
          "USDT TRC20 wallet address:"
        );

      if (
        wallet === null ||
        !wallet.trim()
      ) {
        return;
      }

      const cleanWallet =
        wallet.trim();

      if (
        !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
          cleanWallet
        )
      ) {
        alert(
          "Invalid USDT TRC20 wallet address."
        );

        return;
      }

      withdraw.disabled =
        true;

      setStatus(
        "Submitting withdrawal..."
      );

      const result =
        await call(
          "/api/withdraw",
          {
            amount_usdt:
              amount,

            wallet:
              cleanWallet
          }
        );

      if (result.ok) {
        render(
          result.user
        );

        alert(
          `💸 Withdrawal #${
            result.withdrawal_id
          } submitted.\n\n` +
          `Amount: ${amount} USDT\n` +
          `Network: TRC20\n` +
          `Status: Pending`
        );

        setStatus(
          "Withdrawal submitted."
        );
      } else {
        alert(
          result.error ||
          "Withdrawal failed."
        );

        await refreshBalance();
      }

      withdraw.disabled =
        false;
    }
  );
}

/* =========================================================
   PAGE VISIBILITY
========================================================= */

document.addEventListener(
  "visibilitychange",
  async () => {
    if (!document.hidden) {
      refreshTelegramUser();

      renderProfile();

      await refreshBalance();

      await loadReferral();

      updateMiningTimer();

      if (
        adToken &&
        adExpiresAt &&
        Date.now() >=
          adExpiresAt &&
        adRunning
      ) {
        updateAdCountdown();
      }
    }
  }
);

/* =========================================================
   SERVER SYNC
========================================================= */

setInterval(
  async () => {
    if (
      !document.hidden &&
      telegramAvailable()
    ) {
      await refreshBalance();
    }
  },
  30000
);

/* =========================================================
   TIMER LOOP
========================================================= */

setInterval(
  updateMiningTimer,
  1000
);

/* =========================================================
   START
========================================================= */

boot();
