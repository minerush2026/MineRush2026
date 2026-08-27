"use strict";

/* =====================================================
TELEGRAM MINI APP
===================================================== */

const tg = window.Telegram?.WebApp || null;

if (tg) {
tg.ready();
tg.expand();
}

const API = "";

const telegramUser =
tg?.initDataUnsafe?.user || null;

const initData =
tg?.initData || "";

let state = null;
let miningStart = null;

let adToken = null;
let adExpiresAt = null;
let adTimer = null;
let adRunning = false;

const MAX_MINING_SECONDS =
12 * 60 * 60;

/* =====================================================
DOM HELPER
===================================================== */

const $ = (id) =>
document.getElementById(id);

/* =====================================================
TELEGRAM USER
===================================================== */

function telegramAvailable() {
return Boolean(
tg &&
telegramUser &&
telegramUser.id
);
}

function getTelegramUser() {

if (!telegramAvailable()) {
return null;
}

return {
id: String(
telegramUser.id
),

username:
  String(
    telegramUser.username || ""
  ),

first_name:
  String(
    telegramUser.first_name || "Miner"
  )

};
}

/* =====================================================
WELCOME
===================================================== */

const welcome =
$("welcome");

if (welcome) {

welcome.textContent =
"Welcome, ${ telegramUser?.first_name || "Miner" }";
}

/* =====================================================
API REQUEST
===================================================== */

async function call(
endpoint,
body = {}
) {

try {

const requestBody = {
  ...body,

  /*
     server.js-এর জন্য Telegram user
  */

  user:
    getTelegramUser(),

  /*
     Telegram Mini App data
     ভবিষ্যতের verification-এর জন্য রাখা
  */

  initData
};

const response =
  await fetch(
    API + endpoint,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(
          requestBody
        )
    }
  );

const text =
  await response.text();

let result;

try {

  result =
    JSON.parse(text);

} catch (error) {

  console.error(
    "Invalid server response:",
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
  "API request error:",
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
RENDER USER
===================================================== */

function render(userData) {

if (!userData) {
return;
}

state =
userData;

const balance =
$("balance");

if (balance) {

balance.textContent =
  `${Number(
    userData.balance || 0
  ).toLocaleString()} MRX`;

}

const rate =
$("rate");

if (rate) {

const miningRate =
  Number(
    userData.mining_rate ??
    userData.miningRate ??
    0
  );

if (miningRate > 0) {

  rate.textContent =
    `${miningRate} MRX/hour`;
}

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

/* ---------------------------------------------------
Mining not started
--------------------------------------------------- */

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

/* ---------------------------------------------------
Calculate elapsed time
--------------------------------------------------- */

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
"${String(hours).padStart(2, "0")}:" +
"${String(minutes).padStart(2, "0")}:" +
"${String(seconds).padStart(2, "0")}";

/* ---------------------------------------------------
Progress
--------------------------------------------------- */

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

try {

const response =
  await fetch(
    `/api/referral/${encodeURIComponent(
      String(
        telegramUser.id
      )
    )}`,
    {
      method: "GET",

      headers: {
        "X-Telegram-Init-Data":
          initData
      }
    }
  );


const result =
  await response.json();


if (!result.ok) {
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
  "Referral load error:",
  error
);

}
}

/* =====================================================
BOOTSTRAP
===================================================== */

async function boot() {

const status =
$("status");

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
"/api/bootstrap"
);

if (!result.ok) {

if (status) {

  status.textContent =
    result.error ||
    "Unable to connect.";
}

console.error(
  "Bootstrap error:",
  result.error
);

return;

}

/* ---------------------------------------------------
User
--------------------------------------------------- */

render(
result.user
);

/* ---------------------------------------------------
Mining rate
--------------------------------------------------- */

const rate =
$("rate");

if (
rate &&
Number(
result.miningRate
) > 0
) {

rate.textContent =
  `${result.miningRate} MRX/hour`;

}

/* ---------------------------------------------------
Mining start
--------------------------------------------------- */

if (
result.user &&
result.user.mining_started_at
) {

miningStart =
  Number(
    result.user.mining_started_at
  );

} else {

miningStart =
  null;

}

updateMiningTimer();

/* ---------------------------------------------------
Referral
--------------------------------------------------- */

await loadReferral();

if (status) {

status.textContent =
  "Ready to mine";

}
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
      "Please open the app from Telegram."
    );

    return;
  }


  claim.disabled =
    true;


  const status =
    $("status");


  if (status) {

    status.textContent =
      "Processing mining...";
  }


  const result =
    await call(
      "/api/mining/claim"
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


    if (status) {

      status.textContent =
        "Mining claimed successfully!";
    }

  } else {

    if (status) {

      status.textContent =
        result.error ||
        "Mining claim failed.";
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
      "Please open the app from Telegram."
    );

    return;
  }


  daily.disabled =
    true;


  const result =
    await call(
      "/api/daily"
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
  "Please open the app from Telegram."
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

const result =
await call(
"/api/ad/start"
);

if (!result.ok) {

resetAdButton();


if (result.cooldown) {

  const minutes =
    Math.max(
      1,
      Math.ceil(
        Number(
          result.remainingSeconds ||
          0
        ) / 60
      )
    );


  alert(
    `⏳ Please wait ${minutes} minute(s).`
  );

} else {

  alert(
    result.error ||
    "Unable to start ad."
  );
}


return;

}

adToken =
result.token;

adExpiresAt =
Number(
result.expiresAt
);

/* ---------------------------------------------------
Open advertisement
--------------------------------------------------- */

try {

if (
  tg &&
  typeof tg.openLink ===
    "function" &&
  result.adUrl
) {

  tg.openLink(
    result.adUrl
  );

} else if (
  result.adUrl
) {

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

/* ---------------------------------------------------
Clear old timer
--------------------------------------------------- */

if (adTimer) {

clearInterval(
  adTimer
);

adTimer =
  null;

}

/* ---------------------------------------------------
Countdown
--------------------------------------------------- */

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

      ad.textContent =
        secondsLeft > 0
          ? `⏳ Ad ${secondsLeft}s`
          : "🎁 Claiming...";
    }


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

/* =====================================================
RESET AD BUTTON
===================================================== */

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
      "Please open the app from Telegram."
    );

    return;
  }


  try {

    const response =
      await fetch(
        `/api/referral/${encodeURIComponent(
          String(
            telegramUser.id
          )
        )}`,
        {
          method: "GET",

          headers: {
            "X-Telegram-Init-Data":
              initData
          }
        }
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
      String(
        result.referralLink || ""
      );


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
      "Please open the app from Telegram."
    );

    return;
  }


  const amount =
    prompt(
      "USDT amount (minimum 10):",
      "10"
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


  if (
    wallet === null ||
    wallet.trim() === ""
  ) {

    return;
  }


  const cleanWallet =
    wallet.trim();


  const result =
    await call(
      "/api/withdraw",
      {
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
      `💸 Withdrawal #${result.withdrawal_id} submitted.`
    );

  } else {

    alert(
      result.error ||
      "Withdrawal failed."
    );
  }
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
START
===================================================== */

boot();
