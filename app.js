const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const API = "https://minerush2026-1.onrender.com";

const telegramUser =
  tg?.initDataUnsafe?.user || null;

let state = null;

const $ = (id) =>
  document.getElementById(id);

function setLoading(show) {
  const loading = $("loading");

  if (!loading) return;

  loading.classList.toggle(
    "hidden",
    !show
  );
}

function setStatus(message) {
  $("status").textContent = message;
}

function render(user) {
  state = user;

  const balance =
    Number(user.balance || 0);

  $("balance").textContent =
    `${balance.toLocaleString()} MRX`;

  $("miniBalance").textContent =
    `${balance.toLocaleString()} MRX`;
}

async function call(path, body) {
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

    const data =
      await response.json();

    return data;

  } catch (error) {

    return {
      ok: false,
      error:
        "Unable to connect to MineRush2026 server"
    };
  }
}

async function boot() {

  if (!telegramUser) {

    $("username").textContent =
      "Open this app inside Telegram";

    $("telegramId").textContent =
      "Not available";

    setStatus(
      "Please open MineRush2026 from Telegram"
    );

    return;
  }

  $("username").textContent =
    telegramUser.first_name ||
    telegramUser.username ||
    "Telegram User";

  $("telegramId").textContent =
    String(telegramUser.id);

  setLoading(true);

  const result =
    await call(
      "/api/bootstrap",
      {
        user: telegramUser
      }
    );

  setLoading(false);

  if (!result.ok) {

    setStatus(
      result.error ||
      "Could not connect"
    );

    return;
  }

  render(result.user);

  $("rate").textContent =
    `${result.miningRate} MRX/hour`;

  setStatus(
    "Mining is ready"
  );
}

$("claim").onclick =
  async function () {

    if (!telegramUser) {
      setStatus(
        "Open the app inside Telegram"
      );
      return;
    }

    $("claim").disabled = true;

    setLoading(true);

    setStatus(
      "Checking mining..."
    );

    const result =
      await call(
        "/api/mining/claim",
        {
          telegram_id:
            String(telegramUser.id)
        }
      );

    setLoading(false);

    $("claim").disabled = false;

    if (!result.ok) {

      setStatus(
        result.error ||
        "Mining claim failed"
      );

      return;
    }

    render(result.user);

    setStatus(
      "Mining claimed successfully ⛏️"
    );
  };


$("daily").onclick =
  async function () {

    if (!telegramUser) {
      setStatus(
        "Open the app inside Telegram"
      );
      return;
    }

    setLoading(true);

    const result =
      await call(
        "/api/daily",
        {
          telegram_id:
            String(telegramUser.id)
        }
      );

    setLoading(false);

    if (!result.ok) {

      alert(
        result.error ||
        "Daily bonus unavailable"
      );

      return;
    }

    render(result.user);

    alert(
      `🎁 +${result.amount} MRX daily bonus!`
    );
  };


$("ad").onclick =
  async function () {

    if (!telegramUser) {
      setStatus(
        "Open the app inside Telegram"
      );
      return;
    }

    const confirmed =
      confirm(
        "Watch an ad to receive the current MVP reward?"
      );

    if (!confirmed) return;

    setLoading(true);

    const result =
      await call(
        "/api/ad/reward",
        {
          telegram_id:
            String(telegramUser.id)
        }
      );

    setLoading(false);

    if (!result.ok) {

      alert(
        result.error ||
        "Ad reward failed"
      );

      return;
    }

    render(result.user);

    alert(
      `📺 +${result.amount} MRX reward!`
    );
  };


$("ref").onclick =
  async function () {

    if (!telegramUser) {
      setStatus(
        "Open the app inside Telegram"
      );
      return;
    }

    const link =
      `https://t.me/MineRush2026_bot?start=ref_${telegramUser.id}`;

    try {

      if (
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        await navigator.clipboard.writeText(
          link
        );
      }

      if (tg) {

        tg.showPopup({
          title: "Referral Link",
          message: link,
          buttons: [
            {
              id: "ok",
              type: "ok",
              text: "Done"
            }
          ]
        });

      } else {

        alert(
          `Your referral link:\n\n${link}`
        );
      }

    } catch (error) {

      alert(
        `Your referral link:\n\n${link}`
      );
    }
  };


$("withdraw").onclick =
  async function () {

    if (!telegramUser) {
      setStatus(
        "Open the app inside Telegram"
      );
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
        "Minimum withdrawal is 10 USDT"
      );

      return;
    }

    const wallet =
      prompt(
        "Enter your USDT TRC20 wallet address:"
      );

    if (!wallet) return;

    if (wallet.trim().length < 20) {

      alert(
        "Please enter a valid wallet address"
      );

      return;
    }

    const confirmed =
      confirm(
        `Submit withdrawal of ${numericAmount} USDT?`
      );

    if (!confirmed) return;

    setLoading(true);

    const result =
      await call(
        "/api/withdraw",
        {
          telegram_id:
            String(telegramUser.id),

          amount_usdt:
            numericAmount,

          wallet:
            wallet.trim()
        }
      );

    setLoading(false);

    if (!result.ok) {

      alert(
        result.error ||
        "Withdrawal failed"
      );

      return;
    }

    render(result.user);

    alert(
      `Withdrawal #${result.withdrawal_id} submitted successfully.`
    );
  };


boot();
