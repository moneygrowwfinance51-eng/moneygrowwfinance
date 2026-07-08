// ===================================================================
// StarkLoan — pixel-tracking.js
// Value-based Meta tracking engine: Pixel + server-side CAPI dedup via
// shared eventId, one honest value calculation (calcLeadValue), and
// non-monetary funnel signals (DocumentUploadStarted, ApplyIntent).
// Must be loaded AFTER app.js (uses getCfg() from app.js at load time).
// ===================================================================


(function(){
  const cfg = getCfg();
  if(cfg.gaId && cfg.gaId.trim()){
    const s1=document.createElement('script');
    s1.async=true;
    s1.src='https://www.googletagmanager.com/gtag/js?id='+cfg.gaId;
    document.head.appendChild(s1);
    const s2=document.createElement('script');
    s2.textContent="window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','"+cfg.gaId+"');";
    document.head.appendChild(s2);
    window._gaEnabled=true;
  }
  if(cfg.metaPixelId && cfg.metaPixelId.trim()){
    const s=document.createElement('script');
    s.textContent="!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','"+cfg.metaPixelId+"');fbq('track','PageView');";
    document.head.appendChild(s);
    window._metaEnabled=true;
  }
})();

function fireEvent(evName, params){
  if(typeof gtag==='function') gtag('event', evName, params||{});
  if(typeof fbq==='function') fbq('track', evName, params||{});
}

// ── META PIXEL VALUE CALCULATION ──
// Converts the loan-amount select option into a representative rupee
// figure. These are the amount-range option strings from the <select
// id="fa"> exactly as they appear in the form — keep them in sync if the
// dropdown options ever change.
const AMOUNT_VALUE_MAP={
  'Below ₹5 Lakhs':300000,
  '₹5–10 Lakhs':750000,
  '₹10–25 Lakhs':1750000,
  '₹25–50 Lakhs':3750000,
  '₹50 Lakhs–1 Crore':7500000,
  'Above ₹1 Crore':12500000
};
function amountToNumber(amountStr){
  return AMOUNT_VALUE_MAP[amountStr]||0;
}

// Payout % — what StarkLoan earns from the lender per disbursed loan
const PAYOUT_PCT={'Personal Loan':0.02,'Business Loan':0.02,'Home Loan':0.01,'Loan Against Property':0.01};
const DEFAULT_PAYOUT_PCT=0.015;

// Closure % — historical lead-to-disbursal conversion rate, used for the
// initial form-submission value (before documents are in hand)
const CLOSURE_PCT={'Personal Loan':0.05,'Business Loan':0.04,'Home Loan':0.03,'Loan Against Property':0.03};
const DEFAULT_CLOSURE_PCT=0.04;

function getPayoutPct(loanType){return PAYOUT_PCT[loanType] ?? DEFAULT_PAYOUT_PCT}
function getClosurePct(loanType){return CLOSURE_PCT[loanType] ?? DEFAULT_CLOSURE_PCT}

// Value = Loan Amount * Payout % * Closure %
// This is the ONLY value calculation used anywhere in this file — one
// honest expected-value estimate, used consistently, never inflated for
// a different event type. Document-upload progress is tracked separately
// below as a non-monetary signal, not a second "value" event.
function calcLeadValue(loanType,amountStr){
  const amount=amountToNumber(amountStr);
  return Math.round(amount*getPayoutPct(loanType)*getClosurePct(loanType));
}

// Fires a genuinely custom event name via fbq('trackCustom', ...) — Meta
// treats this differently from fbq('track', ...), which is reserved for
// its own predefined standard event names. Pass eventId to let Meta
// deduplicate this browser-side event against a matching server-side
// Conversions API event carrying the same event_id.
function fireCustomEvent(evName,params,eventId){
  if(typeof fbq==='function'){
    if(eventId) fbq('trackCustom',evName,params||{},{eventID:eventId});
    else fbq('trackCustom',evName,params||{});
  }
  if(typeof gtag==='function') gtag('event',evName,params||{});
}

// Fired ONCE per lead, on their first successful document upload — an
// honest mid-funnel signal ("this person started uploading documents")
// with NO fabricated value attached. It is intentionally NOT fired again
// for the 2nd, 3rd, 4th... document — uploading more files doesn't mean
// a new conversion happened, it's still the same one applicant. Sending
// real, non-inflated signals is what actually helps Meta's algorithm find
// more people who behave like your real good leads — inflating this with
// a fake "boosted" value would just teach it to chase the wrong pattern.
let docUploadEventFired=false;

function trackDocUpload(){
  if(docUploadEventFired) return;
  docUploadEventFired=true;

  const eventId='docupload_'+(currentLeadId||Date.now());
  fireCustomEvent('DocumentUploadStarted',{loan_type:aLT},eventId);

  if(GSHEET_URL && GSHEET_URL.indexOf('PASTE_')!==0){
    const name=document.getElementById('fn').value.trim();
    const phone=document.getElementById('fp').value.trim();
    fetch(GSHEET_URL,{
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'sendCAPI',eventName:'DocumentUploadStarted',eventId:eventId,name:name,phone:phone,loanType:aLT,secret:API_SECRET})
    }).catch(()=>{});
  }
}

// Fires a click-intent event, then opens the application modal (defined
// in app.js). Every "Apply" / "Check Eligibility" entry point on the page
// calls this one function with a different `source` label, so we always
// know which CTA actually drove someone into the form.
function goToApply(source){
  fireEvent('ApplyIntent',{cta_source:source});
  openApplyModal();
}
