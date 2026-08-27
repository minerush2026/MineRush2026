"use strict";

/* =====================================================
   MineRush2026 - FINAL APP.JS
   Works with the current index.html + server.js
===================================================== */


/* =====================================================
   TELEGRAM WEB APP
===================================================== */

const tg = window.Telegram?.WebApp || null;

if (tg) {
  try {
    tg.ready();
    tg.expand();
  } catch (error) {
    console.error("Telegram WebApp error:", error);
  }
}


/* =====================================================
   CONFIG
===================================================== */

const API = "";

const MAX_MINING_SECONDS = 12 * 60 * 60;

const DEFAULT_MINING_RATE = 10;

const DEFAULT_DAILY_BONUS = 100;

const DEFAULT_AD_REWARD = 25;

const DEFAULT_REFERRAL_BONUS = 500;

const DEFAULT_MIN_WITHDRAW = 10;

const DEFAULT_MRX_PER_USDT = 1000;


/* =====================================================
   TELEGRAM USER
===================================================== */

let telegramUser =
  tg?.initDataUnsafe?.user || null;

const initData =
  tg?.initData || "";


/*
   Re-read Telegram user after WebApp initialization.
*/

function refreshTelegramUser() {

  if (
    tg &&
    tg.initDataUnsafe &&
    tg.initDataUnsafe.user
  ) {
    telegramUser =
      tg.initDataUnsafe.user;
  }

}


/* =====================================================
   APP STATE
===================================================== */

let state = null;

let miningStart = null;

let adToken = null;

let adExpiresAt = null;

let adRunning = false;

let adTimer = null;


/* =====================================================
   DOM HELPER
===================================================== */

const $ = (id) =>
  document.getElementById(id);


/* =====================================================
   TELEGRAM CHECK
===================================================== */

function telegramAvailable() {

  refreshTelegramUser();

  return Boolean(
    tg &&
    telegramUser &&
    telegramUser.id
  );

}


/* =====================================================
   TELEGRAM ID
===================================================== */

function getTelegramId() {

  refreshTelegramUser();

  if (!telegramUser?.id) {
    return "";
  }

  return String(
    telegramUser.id
  );

}


/* =====================================================
   USER NAME
===================================================== */

function getFirstName() {

  return (
    telegramUser?.first_name ||
    "Miner"
  );

}


/* =====================================================
   USERNAME
===================================================== */

function getUsername() {

  if (!telegramUser?.username) {
    return "";
  }

  return String(
    telegramUser.username
  );

}


/* =====================================================
   TELEGRAM PROFILE PHOTO
===================================================== */

function getProfilePhoto() {

  return (
    telegramUser?.photo_url ||
    ""
  );

}


/* =====================================================
   PROFILE / AVATAR
===================================================== */

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
    getProfilePhoto();


  /* Welcome */

  if (welcome) {

    welcome.textContent =
      username
        ? `Welcome, ${firstName} • @${username}`
        : `Welcome, ${firstName}`;

  }


  /* Avatar */

  if (avatar) {

    if (photo) {

      avatar.innerHTML = "";

      const image =
        document.createElement("img");

      image.src =
        photo;

      image.alt =
        firstName;

      image.loading =
        "eager";

      image.referrerPolicy =
        "no-referrer";

      image.onerror =
        () => {

          avatar.textContent =
            "👤";

        };

      avatar.appendChild(
        image
      );

    } else {

      avatar.textContent =
        "👤";

    }

  }

}


/* =====================================================
   INITIAL PROFILE
===================================================== */

renderProfile();


/* =====================================================
   API CALL
===================================================== */

async function call(
  path,
  body = {}
) {

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


    const text =
      await response.text();


    let result;


    try {

      result =
        text
          ? JSON.parse(text)
          : {};

    } catch (error) {

      console.error(
        "Invalid JSON:",
        text
      );

      return {
        ok: false,
        error:
          "Server returned an invalid response."
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
        "Connection error. Please try again."
    };

  }

}


/* =====================================================
   NUMBER FORMAT
===================================================== */

function formatNumber(
  value,
  decimals = 2
) {

  const number =
    Number(value || 0);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString(
    undefined,
    {
      minimumFractionDigits:
        decimals > 0
          ? 0
          : 0,

      maximumFractionDigits:
        decimals
    }
  );

}


/* =====================================================
   RENDER USER
===================================================== */

function render(user) {

  if (!user) {
    return;
  }


  state =
    user;


  /* Balance */

  const balance =
    $("balance");

  if (balance) {

    balance.textContent =
      `${formatNumber(
        user.balance,
        4
      )} MRX`;

  }


  /* Mining rate */

  const rate =
    $("rate");

  if (rate) {

    const miningRate =
      Number(
        user.mining_rate ??
        user.miningRate ??
        DEFAULT_MINING_RATE
      );

    rate.textContent =
      `${miningRate} MRX/hour`;

  }


  /* Mining start */

  if (
    user.mining_started_at
  ) {

    const timestamp =
      Number(
        user.mining_started_at
      );

    if (
      Number.isFinite(timestamp) &&
      timestamp > 0
    ) {

      miningStart =
        timestamp;

    }

  }


  updateMiningTimer();

}


/* =====================================================
   STATUS
===================================================== */

function setStatus(
  message
) {

  const status =
    $("status");

  if (status) {

    status.textContent =
      message || "";

  }

}


/* =====================================================
   MINING TIMER
===================================================== */

function updateMiningTimer() {

  const timer =
    $("timer");

  const progressBar =
    $("progressBar");

  const progressText =
    $("progressText");

  const miningStatus =
    $("miningStatus");


  if (!timer) {
    return;
  }


  /*
     No mining session
  */

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
      MAX_MINING_SECONDS -
      elapsed
    );


  const hours =
    Math.floor(
      remaining / 3600
    );


  const minutes =
    Math.floor(
      (
        remaining % 3600
      ) / 60
    );


  const seconds =
    remaining % 60;


  timer.textContent =
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`;


  const percentage =
    Math.min(
      100,
      (
        elapsed /
        MAX_MINING_SECONDS
      ) * 100
    );


  if (progressBar) {

    progressBar.style.width =
      `${percentage}%`;

  }


  if (progressText) {

    progressText.textContent =
      `${Math.floor(
        percentage
      )}%`;

  }


  if (miningStatus) {

    miningStatus.textContent =
      remaining > 0
        ? "MINING ACTIVE"
        : "MINING COMPLETE";

  }

}


/* =====================================================
   REFERRAL DATA
===================================================== */

async function loadReferral() {

  if (!telegramAvailable()) {
    return;
  }


  const id =
    getTelegramId();


  if (!id) {
    return;
  }


  try {

    const response =
      await fetch(
        `/api/referral/${encodeURIComponent(
          id
        )}`
      );


    const result =
      await response.json();


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
          result.referralEarnings || 0,
          4
        )} MRX`;

    }


  } catch (error) {

    console.error(
      "Referral error:",
      error
    );

  }

}


/* =====================================================
   BOOTSTRAP
===================================================== */

async function boot() {

  refreshTelegramUser();

  renderProfile();


  if (!telegramAvailable()) {

    setStatus(
      "Please open MineRush2026 from Telegram."
    );

    console.warn(
      "Telegram user is unavailable."
    );

    return;

  }


  setStatus(
    "Connecting to MineRush2026..."
  );


  const telegramId =
    getTelegramId();


  /*
     Send both user and telegram_id
     because current server.js supports both.
  */

  const result =
    await call(
      "/api/bootstrap",
      {

        user: {

          id:
            telegramUser.id,

          username:
            telegramUser.username ||
            "",

          first_name:
            telegramUser.first_name ||
            "",

          photo_url:
            telegramUser.photo_url ||
            ""

        },

        telegram_id:
          telegramId,

        username:
          telegramUser.username ||
          "",

        first_name:
          telegramUser.first_name ||
          "",

        initData:
          initData

      }
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


  render(
    result.user
  );


  if (
    result.user &&
    result.user.mining_started_at
  ) {

    miningStart =
      Number(
        result.user.mining_started_at
      );

  }


  updateMiningTimer();


  await loadReferral();


  setStatus(
    "Ready to mine"
  );

}


/* =====================================================
   MINING CLAIM
===================================================== */

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


      claim.disabled =
        true;


      setStatus(
        "Processing mining..."
      );


      const result =
        await call(
          "/api/mining/claim",
          {
            telegram_id:
              getTelegramId()
          }
        );


      if (result.ok) {

        render(
          result.user
        );


        if (
          result.user &&
          result.user.mining_started_at
        ) {

          miningStart =
            Number(
              result.user.mining_started_at
            );

        }


        updateMiningTimer();


        setStatus(
          "Mining reward claimed successfully!"
        );


      } else {

        setStatus(
          result.error ||
          "Mining failed."
        );

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


/* =====================================================
   DAILY BONUS
===================================================== */

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
          "/api/daily",
          {
            telegram_id:
              getTelegramId()
          }
        );


      if (result.ok) {

        render(
          result.user
        );


        alert(
          `🎁 +${formatNumber(
            result.amount,
            4
          )} MRX Daily Bonus!`
        );


        setStatus(
          "Daily bonus claimed successfully!"
        );


      } else {

        alert(
          result.error ||
          "Daily bonus unavailable."
        );


        setStatus(
          result.error ||
          "Daily bonus unavailable."
        );

      }


      daily.disabled =
        false;

    }
  );

}


/* =====================================================
   WATCH AD
===================================================== */

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


  adRunning =
    true;


  if (ad) {

    ad.disabled =
      true;

    ad.textContent =
      "📺 Opening Ad...";

  }


  setStatus(
    "Preparing advertisement..."
  );


  const result =
    await call(
      "/api/ad/start",
      {
        telegram_id:
          getTelegramId()
      }
    );


  if (!result.ok) {

    resetAdButton();


    if (result.cooldown) {

      const seconds =
        Number(
          result.remainingSeconds || 0
        );


      const minutes =
        Math.max(
          1,
          Math.ceil(
            seconds / 60
          )
        );


      alert(
        `⏳ Please wait ${minutes} minute(s) before watching another ad.`
      );


    } else {

      alert(
        result.error ||
        "Unable to start advertisement."
      );

    }


    setStatus(
      result.error ||
      "Advertisement unavailable."
    );


    return;

  }


  adToken =
    result.token;


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
    "Advertisement opened. Please keep the session active."
  );


  /*
     Open SmartLink
  */

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


/* =====================================================
   AD TIMER
===================================================== */

function startAdTimer() {

  stopAdTimer();


  adTimer =
    setInterval(
      () => {

        if (!adExpiresAt) {

          stopAdTimer();

          return;

        }


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

          stopAdTimer();

          claimAdReward();

        }

      },
      500
    );

}


/* =====================================================
   STOP AD TIMER
===================================================== */

function stopAdTimer() {

  if (adTimer) {

    clearInterval(
      adTimer
    );

    adTimer =
      null;

  }

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


  adToken =
    null;


  setStatus(
    "Verifying advertisement..."
  );


  const result =
    await call(
      "/api/ad/claim",
      {

        telegram_id:
          getTelegramId(),

        token

      }
    );


  if (result.ok) {

    render(
      result.user
    );


    alert(
      `🎉 +${formatNumber(
        result.amount,
        4
      )} MRX Ad Reward!`
    );


    setStatus(
      "Ad reward added successfully!"
    );


  } else {

    alert(
      result.error ||
      "Ad reward could not be claimed."
    );


    setStatus(
      result.error ||
      "Ad reward could not be claimed."
    );

  }


  resetAdButton();

}


/* =====================================================
   RESET AD BUTTON
===================================================== */

function resetAdButton() {

  stopAdTimer();


  adRunning =
    false;


  adToken =
    null;


  adExpiresAt =
    null;


  if (ad) {

    ad.disabled =
      false;

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


      try {

        const id =
          getTelegramId();


        const response =
          await fetch(
            `/api/referral/${encodeURIComponent(
              id
            )}`
          );


        const result =
          await response.json();


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
            "Referral link is unavailable."
          );

          return;

        }


        const shareUrl =
          `https://t.me/share/url?url=${
            encodeURIComponent(link)
          }&text=${
            encodeURIComponent(
              "⛏️ Join MineRush2026 and start mining MRX!"
            )
          }`;


        /*
           Telegram share
        */

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

      }

    }
  );

}


/* =====================================================
   WITHDRAW
===================================================== */

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
        Number(
          state?.minWithdrawUSDT ||
          DEFAULT_MIN_WITHDRAW
        );


      const mrxPerUsdt =
        Number(
          state?.mrxPerUSDT ||
          DEFAULT_MRX_PER_USDT
        );


      const amount =
        prompt(
          `USDT amount (minimum ${minimum}):`,
          String(minimum)
        );


      if (
        amount === null ||
        amount.trim() === ""
      ) {

        return;

      }


      const numericAmount =
        Number(
          amount.trim()
        );


      if (
        !Number.isFinite(
          numericAmount
        ) ||
        numericAmount < minimum
      ) {

        alert(
          `Minimum withdrawal is ${minimum} USDT.`
        );

        return;

      }


      const requiredMRX =
        numericAmount *
        mrxPerUsdt;


      if (
        state &&
        Number(state.balance || 0) <
          requiredMRX
      ) {

        alert(
          `Insufficient MRX balance.\n\nRequired: ${formatNumber(
            requiredMRX,
            4
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
        wallet.trim() === ""
      ) {

        return;

      }


      const cleanWallet =
        wallet.trim();


      /*
         Basic TRC20 address check.
         TRON addresses normally start with T
         and contain 34 characters.
      */

      if (
        !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
          cleanWallet
        )
      ) {

        alert(
          "Please enter a valid USDT TRC20 wallet address."
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

            telegram_id:
              getTelegramId(),

            amount_usdt:
              numericAmount,

            wallet:
              cleanWallet

          }
        );


      if (result.ok) {

        render(
          result.user
        );


        alert(
          `💸 Withdrawal #${result.withdrawal_id} submitted successfully.\n\nAmount: ${numericAmount} USDT\nNetwork: TRC20\n\nStatus: Pending`
        );


        setStatus(
          "Withdrawal submitted and waiting for processing."
        );


      } else {

        alert(
          result.error ||
          "Withdrawal failed."
        );


        setStatus(
          result.error ||
          "Withdrawal failed."
        );

      }


      withdraw.disabled =
        false;

    }
  );

}


/* =====================================================
   MINING TIMER LOOP
===================================================== */

setInterval(
  updateMiningTimer,
  1000
);


/* =====================================================
   VISIBILITY CHANGE
===================================================== */

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      !document.hidden
    ) {

      refreshTelegramUser();

      renderProfile();

      updateMiningTimer();

    }

  }
);


/* =====================================================
   START APP
===================================================== */

boot();
