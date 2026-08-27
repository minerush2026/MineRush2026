const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const API = "";

/* =========================
   ADSTERRA SMART LINK
========================= */

const ADSTERRA_SMART_LINK =
  "https://www.profitableratecpmnetwork.com/twctf2wz?key=804533b9d3b330dbd99ce3caee91c75f";


/* =========================
   TELEGRAM USER
========================= */

const user =
  tg?.initDataUnsafe?.user || {
    id: "demo-" + Date.now(),
    first_name: "Demo",
    username: ""
  };


/* =========================
   STATE
========================= */

let state = null;

let miningStart = null;

let adToken = null;

let adExpiresAt = null;

let adRunning = false;

let adTimer = null;

const MAX_MINING_SECONDS =
  12 * 60 * 60;


/* =========================
   HELPER
========================= */

const $ = id =>
  document.getElementById(id);


/* =========================
   WELCOME
========================= */

const welcome =
  $("welcome");

if (welcome) {

  welcome.textContent =
    `Welcome, ${user.first_name || "Miner"}`;
}


/* =========================
   API CALL
========================= */

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

    const data =
      await response.json();

    return data;

  } catch (error) {

    console.error(
      "API Error:",
      error
    );

    return {
      ok: false,
      error:
        "Connection error. Please try again."
    };
  }
}


/* =========================
   RENDER USER
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

  const refCount =
    $("refCount");

  if (
    refCount &&
    u.referral_count !== undefined
  ) {

    refCount.textContent =
      Number(
        u.referral_count || 0
      ).toLocaleString();
  }

  const refEarned =
    $("refEarned");

  if (
    refEarned &&
    u.referral_earnings !== undefined
  ) {

    refEarned.textContent =
      `${Number(
        u.referral_earnings || 0
      ).toLocaleString()} MRX`;
  }
}


/* =========================
   MINING TIMER
========================= */

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


  /* No mining yet */

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
      (
        Date.now() -
        miningStart
      ) / 1000
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
   LOAD REFERRAL
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


    if (!result.ok) {

      console.error(
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

  const status =
    $("status");


  if (status) {

    status.textContent =
      "Connecting...";
  }


  const result =
    await call(
      "/api/bootstrap",
      {
        user
      }
    );


  if (!result.ok) {

    if (status) {

      status.textContent =
        result.error ||
        "Unable to connect";
    }

    return;
  }


  render(
    result.user
  );


  const rate =
    $("rate");


  if (rate) {

    rate.textContent =
      `${result.miningRate} MRX/hour`;
  }


  if (
    result.user.mining_started_at
  ) {

    miningStart =
      Number(
        result.user.mining_started_at
      );
  }


  updateMiningTimer();


  await loadReferral();


  if (status) {

    status.textContent =
      "Ready";
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

      claim.disabled =
        true;


      const status =
        $("status");


      if (status) {

        status.textContent =
          "⛏️ Processing...";
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

        render(
          result.user
        );


        if (
          result.user.mining_started_at
        ) {

          miningStart =
            Number(
              result.user
                .mining_started_at
            );
        }


        updateMiningTimer();


        if (status) {

          status.textContent =
            "⛏️ Mining started!";
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

          claim.disabled =
            false;

        },
        700
      );
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
    async () => {

      daily.disabled =
        true;


      const result =
        await call(
          "/api/daily",
          {
            telegram_id:
              String(user.id)
          }
        );


      if (result.ok) {

        render(
          result.user
        );


        alert(
          `🎁 +${result.amount} MRX Daily Bonus!`
        );

      } else {

        alert(
          result.error ||
          "Daily bonus unavailable"
        );
      }


      daily.disabled =
        false;
    }
  );
}


/* =================================================
   WATCH AD
================================================= */

const ad =
  $("ad");


/* =========================
   RESET AD
========================= */

function resetAdButton() {

  adRunning =
    false;

  adToken =
    null;

  adExpiresAt =
    null;


  if (adTimer) {

    clearInterval(
      adTimer
    );

    adTimer =
      null;
  }


  if (ad) {

    ad.disabled =
      false;

    ad.textContent =
      "📺 Watch Ad";
  }
}


/* =========================
   OPEN AD
========================= */

function openAd() {

  try {

    /*
      Telegram Mini App
    */

    if (
      tg &&
      typeof tg.openLink ===
      "function"
    ) {

      tg.openLink(
        ADSTERRA_SMART_LINK
      );

      return;
    }


    /*
      Normal browser
    */

    window.open(
      ADSTERRA_SMART_LINK,
      "_blank"
    );

  } catch (error) {

    console.error(
      "Unable to open ad:",
      error
    );


    /*
      Fallback
    */

    window.location.href =
      ADSTERRA_SMART_LINK;
  }
}


/* =========================
   START AD SESSION
========================= */

async function startAd() {

  if (adRunning) {
    return;
  }


  adRunning =
    true;


  if (ad) {

    ad.disabled =
      true;

    ad.textContent =
      "📺 Starting Ad...";
  }


  /*
    Ask server for an
    ad session.
  */

  const result =
    await call(
      "/api/ad/start",
      {
        telegram_id:
          String(user.id)
      }
    );


  /*
    Server rejected.
  */

  if (!result.ok) {

    adRunning =
      false;


    if (ad) {

      ad.disabled =
        false;

      ad.textContent =
        "📺 Watch Ad";
    }


    if (
      result.cooldown
    ) {

      const seconds =
        Number(
          result.remainingSeconds ||
          0
        );


      const minutes =
        Math.ceil(
          seconds / 60
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


    return;
  }


  /*
    Save server session.
  */

  adToken =
    result.token;


  adExpiresAt =
    Number(
      result.expiresAt
    );


  /*
    Server decides the
    actual watch duration.

    Your server should now
    be configured for 30 seconds.
  */

  const watchSeconds =
    Number(
      result.watchSeconds ||
      30
    );


  /*
    Open Adsterra.
  */

  openAd();


  /*
    Start countdown.
  */

  if (ad) {

    ad.textContent =
      `⏳ Ad ${watchSeconds}s`;
  }


  /*
    Countdown based on
    server expiry time.
  */

  adTimer =
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

          if (
            secondsLeft > 0
          ) {

            ad.textContent =
              `⏳ Ad ${secondsLeft}s`;

          } else {

            ad.textContent =
              "🎁 Claiming...";
          }
        }


        /*
          Time finished.
        */

        if (
          secondsLeft <= 0
        ) {

          clearInterval(
            adTimer
          );

          adTimer =
            null;


          claimAdReward();
        }

      },
      500
    );
}


/* =========================
   CLAIM AD REWARD
========================= */

async function claimAdReward() {

  if (!adToken) {

    resetAdButton();

    return;
  }


  const token =
    adToken;


  /*
    Remove token locally
    so double-click cannot
    submit it twice.
  */

  adToken =
    null;


  const result =
    await call(
      "/api/ad/claim",
      {
        telegram_id:
          String(user.id),

        token
      }
    );


  if (result.ok) {

    render(
      result.user
    );


    alert(
      `🎉 +${result.amount} MRX Ad Reward!`
    );

  } else {

    alert(
      result.error ||
      "Ad reward could not be claimed."
    );
  }


  resetAdButton();
}


/* =========================
   WATCH AD BUTTON
========================= */

if (ad) {

  ad.addEventListener(
    "click",
    startAd
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
          error
        );


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


      if (!amount) {
        return;
      }


      const numericAmount =
        Number(amount);


      if (
        !Number.isFinite(
          numericAmount
        ) ||
        numericAmount < 10
      ) {

        alert(
          "Minimum withdrawal is 10 USDT."
        );

        return;
      }


      /*
        Current exchange rate:
        1000 MRX = 1 USDT

        Therefore:
        10 USDT = 10,000 MRX
      */

      const requiredMRX =
        numericAmount * 1000;


      if (
        state &&
        Number(state.balance || 0) <
        requiredMRX
      ) {

        alert(
          `You need ${requiredMRX.toLocaleString()} MRX for ${numericAmount} USDT.`
        );

        return;
      }


      const wallet =
        prompt(
          "USDT TRC20 wallet address:"
        );


      if (!wallet) {
        return;
      }


      const result =
        await call(
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

        render(
          result.user
        );


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
   MINING TIMER LOOP
========================= */

setInterval(
  updateMiningTimer,
  1000
);


/* =========================
   START APP
========================= */

boot();
