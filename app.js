const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const API = ""; // same-origin when frontend is served by your reverse proxy
const user = tg?.initDataUnsafe?.user || {id:"demo-"+Date.now(),first_name:"Demo",username:""};

let state = null;
const $ = id => document.getElementById(id);

async function call(path, body) {
  const r = await fetch(API + path, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return r.json();
}
function render(u){
  state=u;
  $("balance").textContent = `${Number(u.balance||0).toLocaleString()} MRX`;
}
async function boot(){
  const r=await call("/api/bootstrap",{user});
  if(r.ok){render(r.user);$("rate").textContent=`${r.miningRate} MRX/hour`;}
  else $("status").textContent=r.error||"Could not connect";
}
$("claim").onclick=async()=>{
  const r=await call("/api/mining/claim",{telegram_id:String(user.id)});
  if(r.ok){render(r.user);$("status").textContent="Mining claimed successfully";}
  else $("status").textContent=r.error;
};
$("daily").onclick=async()=>{
  const r=await call("/api/daily",{telegram_id:String(user.id)});
  if(r.ok){render(r.user);alert(`+${r.amount} MRX daily bonus!`)} else alert(r.error);
};
$("ad").onclick=async()=>{
  // Replace this MVP action with your verified Adsterra reward flow.
  const r=await call("/api/ad/reward",{telegram_id:String(user.id)});
  if(r.ok){render(r.user);alert(`+${r.amount} MRX ad reward (MVP)`)} else alert(r.error);
};
$("ref").onclick=()=>{
  const link=`https://t.me/MineRush2026_bot?start=ref_${user.id}`;
  if(navigator.clipboard) navigator.clipboard.writeText(link);
  alert(`Your referral link:\n${link}`);
};
$("withdraw").onclick=async()=>{
  const amount=prompt("USDT amount (minimum 10):","10");
  if(!amount)return;
  const wallet=prompt("USDT TRC20 wallet address:");
  if(!wallet)return;
  const r=await call("/api/withdraw",{telegram_id:String(user.id),amount_usdt:Number(amount),wallet});
  if(r.ok){render(r.user);alert(`Withdrawal #${r.withdrawal_id} submitted.`)} else alert(r.error);
};
boot();
