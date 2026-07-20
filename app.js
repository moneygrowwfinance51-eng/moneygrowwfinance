// ===================================================================
// StarkLoan — app.js
// Core application logic: multi-step form navigation, document upload
// handling, Google Sheets/Apps Script communication, WhatsApp handoff.
// Loaded BEFORE pixel-tracking.js — that file's top-level pixel-init
// code calls getCfg(), which is defined here.
// ===================================================================

const STORE = 'mg_leads_v1';
const GSHEET_URL = 'https://script.google.com/macros/s/AKfycbw2wtzpfWgahjn_n-2XP8J_sMqlZD3jx5fIxHEpvR81EZhxzBkFk1lHNU3-JR3dtfflCw/exec';
// Must match API_SECRET in your Apps Script exactly. This only filters out
// random bots/scanners — it is visible to anyone who views this page's
// source, so it is not a substitute for real authentication.
const API_SECRET = 'CHANGE_THIS_TO_A_RANDOM_STRING_1234';

// Single source of truth for the Grievance Officer contact — used in the
// document-consent popup below. Update this ONE line rather than editing
// email addresses in multiple places, which is how display text and
// mailto links end up mismatched.
const GRIEVANCE_EMAIL = 'mali.kamlesh85@gmail.com';

function sendToSheet(lead){
  if(!GSHEET_URL || GSHEET_URL.indexOf('PASTE_')===0) return Promise.resolve();
  return fetch(GSHEET_URL,{
    method:'POST',
    mode:'no-cors',
    headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({action:'createLead',lead:lead,secret:API_SECRET})
  }).catch(()=>{});
}
function uploadFileToDrive(rowId,doc){
  if(!GSHEET_URL || GSHEET_URL.indexOf('PASTE_')===0) return Promise.resolve();
  return fetch(GSHEET_URL,{
    method:'POST',
    mode:'no-cors',
    headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({action:'uploadFile',rowId:rowId,fileName:doc.name,fileType:doc.type,fileData:doc.data,label:doc.label,secret:API_SECRET})
  }).catch(()=>{});
}
async function createLeadAndGetRowId(lead){
  if(!GSHEET_URL || GSHEET_URL.indexOf('PASTE_')===0) return null;
  try{
    const controller=new AbortController();
    const timeoutId=setTimeout(()=>controller.abort(),15000);
    const res=await fetch(GSHEET_URL,{
      method:'POST',
      headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'createLead',lead:lead,secret:API_SECRET}),
      signal:controller.signal
    });
    clearTimeout(timeoutId);
    const json=await res.json();
    return json.rowId||null;
  }catch(err){return null}
}
const CFG_STORE = 'mg_site_v1';

function getCfg(){try{return JSON.parse(localStorage.getItem(CFG_STORE)||'{}')}catch{return{}}}
function getLeads(){try{return JSON.parse(localStorage.getItem(STORE)||'[]')}catch{return[]}}
function saveLeads(l){localStorage.setItem(STORE,JSON.stringify(l))}

// ── RESUME TOKEN ──
// Lets a dropped-off user return via a WhatsApp link and land back on the
// exact step they left off on, instead of retyping name/phone/etc.
// One token per in-progress application, kept in localStorage so it
// survives a page reload even before it's in the URL.
const RESUME_STORE='mg_resume_token';

function getOrCreateResumeToken(){
  let t=localStorage.getItem(RESUME_STORE);
  if(!t){
    t=(crypto.randomUUID?crypto.randomUUID():(Date.now().toString(36)+Math.random().toString(36).slice(2))).replace(/-/g,'').slice(0,16);
    localStorage.setItem(RESUME_STORE,t);
  }
  return t;
}
function clearResumeToken(){
  localStorage.removeItem(RESUME_STORE);
}

// Puts ?resume=<token> in the address bar without reloading the page, so
// if the user copies the URL or it's captured for the WhatsApp link, it
// carries the token. Preserves any other existing query params.
function putResumeTokenInURL(token){
  const url=new URL(window.location.href);
  url.searchParams.set('resume',token);
  window.history.replaceState(null,'',url.toString());
}

async function fetchLeadByToken(token){
  if(!GSHEET_URL || GSHEET_URL.indexOf('PASTE_')===0) return null;
  try{
    const controller=new AbortController();
    const timeoutId=setTimeout(()=>controller.abort(),15000);
    const res=await fetch(GSHEET_URL,{
      method:'POST',
      headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'getLead',token:token,secret:API_SECRET}),
      signal:controller.signal
    });
    clearTimeout(timeoutId);
    const json=await res.json();
    return json.lead||null;
  }catch(err){return null}
}

// On page load, checks for ?resume=<token> in the URL. If it matches an
// in-progress (Partial) lead, pre-fills the form and jumps straight to
// the step they left off on — never back to name/phone.
async function checkResumeOnLoad(){
  const params=new URLSearchParams(window.location.search);
  const token=params.get('resume');
  if(!token)return;

  const lead=await fetchLeadByToken(token);
  if(!lead || (lead.status!=='Partial' && lead.status!=='Docs Invalid'))return;

  localStorage.setItem(RESUME_STORE,token);
  currentLeadId=lead.rowId?Number(lead.rowId):Date.now();
  currentRowId=lead.rowId||null;

  if(lead.loanType){
    aLT=lead.loanType;
    const tabMap={'Home Loan':'home','Loan Against Property':'lap','Personal Loan':'personal','Business Loan':'business'};
    const tabKey=tabMap[lead.loanType];
    if(tabKey){
      document.querySelectorAll('.ltab').forEach(t=>t.classList.remove('active'));
      const el=document.getElementById('tab-'+tabKey);
      if(el)el.classList.add('active');
    }
  }

  const setVal=(id,val)=>{const el=document.getElementById(id);if(el&&val)el.value=val;};
  setVal('fn',lead.name);
  setVal('fp',lead.phone);
  setVal('fa',lead.amount);
  setVal('fem',lead.emp);
  setVal('fi',lead.income);
  setVal('fc',lead.city);
  setVal('fexist',lead.existingLoan);

  openApplyModal();
  document.getElementById('step1').style.display='none';

  if(lead.lastStep==='step3' || lead.status==='Docs Invalid'){
    document.getElementById('sb2').style.background='var(--g)';
    document.getElementById('step2').style.display='none';
    document.getElementById('step3').style.display='';
    renderDocRequirements();
    showDocPurposeModal();
    toast(lead.status==='Docs Invalid' ? 'One document needs to be re-uploaded' : 'Welcome back — pick up where you left off','ok');
  }else{
    document.getElementById('sb2').style.background='var(--g)';
    document.getElementById('step2').style.display='';
    toast('Welcome back — pick up where you left off','ok');
  }

  document.getElementById('apply').scrollIntoView({behavior:'smooth',block:'start'});
}
document.addEventListener('DOMContentLoaded',checkResumeOnLoad);
function toggleMenu(){
  const m=document.getElementById('nlinks');
  const icon=document.getElementById('nburgerIcon');
  const open=m.classList.toggle('open');
  icon.setAttribute('href','#icon-'+(open?'x':'menu-2'));
}
function closeMenu(){
  const m=document.getElementById('nlinks');
  const icon=document.getElementById('nburgerIcon');
  m.classList.remove('open');
  icon.setAttribute('href','#icon-menu-2');
}

function toast(msg,type='ok'){
  const t=document.getElementById('toast');
  t.innerHTML='<svg class="icon"><use href="#icon-'+(type==='ok'?'check':type==='err'?'alert-circle':'brand-whatsapp')+'"/></svg>'+msg;
  t.className=type;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),4000);
}

// ── APPLICATION MODAL ──
// The intake form lives inside this modal now. Every "Apply"/"Check
// Eligibility" button on the page calls goToApply() (pixel-tracking.js),
// which fires a tracking event and then calls openApplyModal() here.
function openApplyModal(){
  document.getElementById('applyModalOverlay').style.display='flex';
  document.body.style.overflow='hidden';
}
function closeApplyModal(){
  document.getElementById('applyModalOverlay').style.display='none';
  document.body.style.overflow='';
}

// Friendly, non-"loan"-worded labels for on-page display only. The
// underlying loanType values ('Personal Loan', 'Business Loan', etc.)
// are left exactly as-is everywhere else — Google Sheet columns, the
// WhatsApp message body, and all tracking/value-calculation lookups in
// pixel-tracking.js key off these exact strings, so renaming them there
// would silently break the backend. This map only affects what a visitor
// sees rendered on screen.
const LOAN_TYPE_DISPLAY={
  'Personal Loan':'Personal Finance',
  'Business Loan':'Business Finance',
  'Home Loan':'Home Finance',
  'Loan Against Property':'Property-Backed Finance'
};
function displayLoanType(lt){
  return LOAN_TYPE_DISPLAY[lt]||lt;
}

let aLT='Personal Loan';
function selTab(k){
  const m={'home':'Home Loan','lap':'Loan Against Property','personal':'Personal Loan','business':'Business Loan'};
  const newType=m[k]||k;

  if(newType===aLT){
    document.getElementById('apply').scrollIntoView({behavior:'smooth'});
    return;
  }

  const hasData=document.getElementById('fn').value.trim()||document.getElementById('fp').value.trim()||
    document.getElementById('fa').value||document.getElementById('fem').value||Object.keys(docFiles).length>0;
  if(hasData){
    const ok=confirm('Switching to '+newType+' will start a fresh form and clear what you\'ve entered so far. Continue?');
    if(!ok)return;
  }

  aLT=newType;
  document.querySelectorAll('.ltab').forEach(t=>t.classList.remove('active'));
  const el=document.getElementById('tab-'+k);
  if(el)el.classList.add('active');
  resetApplyForm();
  document.getElementById('apply').scrollIntoView({behavior:'smooth'});
  fireEvent('select_loan_type',{loan_type:aLT});
}

function resetApplyForm(){
  document.getElementById('fn').value='';
  document.getElementById('fp').value='';
  document.getElementById('fa').value='';
  document.getElementById('fem').value='';
  document.getElementById('fi').value='';
  document.getElementById('fc').value='';
  document.getElementById('fexist').value='No existing loan';
  const consentEl=document.getElementById('fconsent');
  if(consentEl)consentEl.checked=false;
  const docConsentEl=document.getElementById('fdocconsent');
  if(docConsentEl)docConsentEl.checked=false;
  docFiles={};
  currentLeadId=null;
  docUploadEventFired=false;
  document.getElementById('sb2').style.background='var(--bdr)';
  document.getElementById('step2').style.display='none';
  document.getElementById('step3').style.display='none';
  document.getElementById('step3form').style.display='';
  document.getElementById('step3engage').style.display='none';
  document.getElementById('step3success').style.display='none';
  docChunkIndex=0;currentRowId=null;rowIdPromise=null;
  const btn=document.getElementById('docNextBtn');
  btn.disabled=false;
  btn.innerHTML='Next <svg class="icon"><use href="#icon-arrow-right"/></svg>';
  document.getElementById('step1').style.display='';
}

function startOver(){
  const ok=confirm('This will clear everything you\'ve entered and start the form over. Continue?');
  if(!ok)return;
  resetApplyForm();
  document.getElementById('apply').scrollIntoView({behavior:'smooth',block:'start'});
}

function onPhoneInput(){
  const el=document.getElementById('fp');
  el.value=el.value.replace(/\D/g,'').slice(0,10);
}

function buildWAMessage(lead){
  const cfg=getCfg();
  const waNum=(cfg.waNumber||'917073177874').replace(/[^0-9]/g,'');
  const typeKeyword=lead.loanType.replace(/\s+/g,'');
  const msg=`Hello! I want to apply for a loan. [Ref: ApplyLoan_${typeKeyword}]

👤 Name: ${lead.name}
📞 Phone: ${lead.phone}
💰 Loan Type: ${lead.loanType}
📉 Amount: ${lead.amount}
💼 Employment: ${lead.emp}
🏦 Existing Loan: ${lead.existingLoan}
🏙 City: ${lead.city||'—'}

Please confirm my application and let me know the next steps. Thank you!`;
  return 'https://wa.me/'+waNum+'?text='+encodeURIComponent(msg);
}

function livePreview(){}

let docFiles={};
const MAX_FILE_MB=5;

const DOC_REQUIREMENTS={
  'Salaried':[
    {key:'aadhaar',label:'Aadhaar Card'},
    {key:'pan',label:'PAN Card'},
    {key:'salaryslip',label:'Salary Slip (Last 3 Months)'},
    {key:'form16',label:'Form 16'},
    {key:'bankstatement',label:'Bank Statement (Last 6 Months)'},
    {key:'photo',label:'Passport Size Photo'}
  ],
  'Business':[
    {key:'aadhaar',label:'Aadhaar Card'},
    {key:'pan',label:'PAN Card'},
    {key:'itr',label:'ITR (Last 2 Years)'},
    {key:'bizreg',label:'Firm Registration (Udyam / GST / BRN / Shop Act License)'},
    {key:'bankstatement',label:'Bank Statement (Last 6 Months)'},
    {key:'photo',label:'Passport Size Photo'}
  ]
};

function empCategory(){
  const emp=document.getElementById('fem').value;
  return emp==='Salaried' ? 'Salaried' : 'Business';
}

function docRow(it){
  return `
    <div class="docrow" data-key="${it.key}">
      <div class="docrow-label"><svg class="icon"><use href="#icon-file-text"/></svg> ${it.label}</div>
      <label class="docrow-btn" for="docup_${it.key}"><svg class="icon"><use href="#icon-upload"/></svg> Upload</label>
      <input type="file" id="docup_${it.key}" accept="image/*,application/pdf" style="display:none" onchange="handleDocFile(event,'${it.key}')">
      <div id="docrow-status-${it.key}" class="docrow-status"></div>
    </div>`;
}

function chunkArray(arr,size){
  const out=[];
  for(let i=0;i<arr.length;i+=size)out.push(arr.slice(i,i+size));
  return out;
}

let docChunks=[];
let docChunkIndex=0;
let currentRowId=null;
let rowIdPromise=null;

function getRowId(){
  if(currentRowId)return Promise.resolve(currentRowId);
  if(rowIdPromise)return rowIdPromise.then(id=>{currentRowId=id;return id});
  return Promise.resolve(null);
}

function renderDocRequirements(){
  const cat=empCategory();
  document.getElementById('docLoanType').textContent=displayLoanType(aLT);
  docChunks=chunkArray(DOC_REQUIREMENTS[cat],3);
  docChunkIndex=0;
  renderDocChunk();
}

function renderDocChunk(){
  const items=docChunks[docChunkIndex]||[];
  const isLast=docChunkIndex===docChunks.length-1;
  const container=document.getElementById('docUploadList');
  container.innerHTML=
    `<p style="font-size:11.5px;font-weight:700;color:var(--mu);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Step ${docChunkIndex+1} of ${docChunks.length}</p>`
    + items.map(docRow).join('');
  items.forEach(it=>renderDocStatus(it.key));

  const nextBtn=document.getElementById('docNextBtn');
  nextBtn.innerHTML=isLast
    ? '<svg class="icon"><use href="#icon-brand-whatsapp"/></svg> Submit Application'
    : 'Next <svg class="icon"><use href="#icon-arrow-right"/></svg>';
  nextBtn.onclick=isLast?submitLead:docChunkNext;
}

function docChunkNext(){
  const items=docChunks[docChunkIndex]||[];
  getRowId().then(rowId=>{
    if(!rowId)return;
    items.forEach(it=>{
      const f=docFiles[it.key];
      if(f && !f.uploaded){
        f.uploaded=true;
        uploadFileToDrive(rowId,f);
        trackDocUpload();
      }
    });
  });
  docChunkIndex++;
  renderDocChunk();
  document.getElementById('step3').scrollIntoView({behavior:'smooth',block:'start'});
}

function renderDocStatus(key){
  const el=document.getElementById('docrow-status-'+key);
  if(!el)return;
  const f=docFiles[key];
  if(!f){el.innerHTML='';el.classList.remove('filled');return}
  el.classList.add('filled');
  el.innerHTML=`<span><svg class="icon"><use href="#icon-circle-check"/></svg> ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)</span><span class="docrow-rm" onclick="removeDocFile('${key}')">✕</span>`;
}

function removeDocFile(key){
  delete docFiles[key];
  renderDocStatus(key);
  const input=document.getElementById('docup_'+key);
  if(input)input.value='';
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result.split(',')[1]);
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}

let filesConverting=0;

async function handleDocFile(e,key){
  const file=e.target.files[0];
  e.target.value='';
  if(!file)return;

  const items=DOC_REQUIREMENTS[empCategory()];
  const label=(items.find(it=>it.key===key)||{}).label||key;

  if(file.size>MAX_FILE_MB*1024*1024){
    toast(label+' file is over '+MAX_FILE_MB+'MB — please choose a smaller file','err');
    return;
  }

  const statusEl=document.getElementById('docrow-status-'+key);
  if(statusEl){
    statusEl.classList.remove('filled');
    statusEl.innerHTML='<span><svg class="icon" style="animation:spin 1s linear infinite;display:inline-block"><use href="#icon-loader"/></svg> Processing '+file.name+'...</span>';
  }
  filesConverting++;

  try{
    const base64=await fileToBase64(file);
    const docObj={label,name:file.name,type:file.type,size:file.size,data:base64,uploaded:false};
    docFiles[key]=docObj;
    renderDocStatus(key);

    getRowId().then(rowId=>{
      if(rowId){
        docObj.uploaded=true;
        uploadFileToDrive(rowId,docObj);
        trackDocUpload();
      }
    });
  }catch(err){
    toast('Could not read the file for '+label,'err');
    if(statusEl)statusEl.innerHTML='';
  }finally{
    filesConverting--;
  }
}

let currentLeadId=null;

function goStep2(){
  const name=document.getElementById('fn').value.trim();
  const phone=document.getElementById('fp').value.trim();
  if(!name){toast('Please enter your full name','err');return}
  if(!/^\d{10}$/.test(phone)){toast('Enter a valid 10-digit phone number','err');return}
  const consentEl=document.getElementById('fconsent');
  if(consentEl && !consentEl.checked){toast('Please agree to the Privacy Policy to continue','err');return}

  const leads=getLeads();
  currentLeadId=Date.now();
  const resumeToken=getOrCreateResumeToken();
  leads.unshift({
    id:currentLeadId,name,phone,
    loanType:aLT,amount:'',emp:'',income:'',city:'',existingLoan:'',
    date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
    dateRaw:new Date().toISOString(),
    status:'Partial',
    resumeToken:resumeToken,
    lastStep:'step2',
    consentGiven:true,
    consentTimestamp:new Date().toISOString()
  });
  saveLeads(leads);
  sendToSheet(leads[0]);
  putResumeTokenInURL(resumeToken);
  fireEvent('lead_step1',{loan_type:aLT});

  document.getElementById('sb2').style.background='var(--g)';
  document.getElementById('step1').style.display='none';
  document.getElementById('step2').style.display='';
  document.getElementById('step2').scrollIntoView({behavior:'smooth',block:'start'});
}

function backToStep1(){
  document.getElementById('sb2').style.background='var(--bdr)';
  document.getElementById('step2').style.display='none';
  document.getElementById('step1').style.display='';
  document.getElementById('step1').scrollIntoView({behavior:'smooth',block:'start'});
}

// ── DOCUMENT PURPOSE NOTICE (bilingual, dynamic) ──
// Shows a plain-language notice of exactly which documents are being
// collected, why, and who they're shared with — BEFORE the person can
// upload anything. Content is rendered fresh each time so it always
// reflects their actual name and their actual required document list
// (Salaried vs Business), in whichever language they pick.
//
// Only English and Hindi are offered on purpose. Machine-translating a
// consent/rights document into languages nobody here can verify risks
// subtly misstating what someone is agreeing to — which undermines the
// consent rather than strengthening it. Hindi covers the large majority
// of the actual customer base; add further languages only with a proper
// human translation review, not by auto-generating more entries below.
const DOC_CONSENT_I18N={
  en:{
    title:'Before you upload your documents',
    intro:'We collect these documents for one purpose only: to process your loan application.',
    consentPrefix:'I consent to share my',
    consentSuffix:'with StarkLoan for the purpose of processing my loan application.',
    purposeLabel:'Purpose:',
    purposeText:'Used to confirm your identity, income, and eligibility.',
    sharingLabel:'Sharing:',
    sharingText:'Shared only with the specific RBI-regulated bank/NBFC partner assessing your application.',
    rightsLabel:'Your Rights:',
    rightsText:'You have the right to review, correct, or withdraw your consent at any time by contacting us.',
    grievanceLabel:'Grievance Redressal:',
    grievanceText:'For any queries or to exercise your rights, contact our Grievance Officer at',
    fullDetails:'Full details are available in our',
    privacyPolicy:'Privacy Policy',
    button:'I Agree & Continue',
    nameFallback:'Applicant',
    docJoiner:'and'
  },
  hi:{
    title:'दस्तावेज़ अपलोड करने से पहले',
    intro:'हम ये दस्तावेज़ केवल एक उद्देश्य के लिए एकत्र करते हैं: आपके लोन आवेदन को प्रोसेस करने के लिए।',
    consentPrefix:'मैं अपना',
    consentSuffix:'लोन आवेदन प्रोसेस करने के उद्देश्य से StarkLoan के साथ साझा करने की सहमति देता/देती हूँ।',
    purposeLabel:'उद्देश्य:',
    purposeText:'आपकी पहचान, आय और पात्रता की पुष्टि के लिए उपयोग किया जाता है।',
    sharingLabel:'साझाकरण:',
    sharingText:'केवल उस विशिष्ट RBI-विनियमित बैंक/NBFC पार्टनर के साथ साझा किया जाता है जो आपके आवेदन का मूल्यांकन कर रहा है।',
    rightsLabel:'आपके अधिकार:',
    rightsText:'आपको किसी भी समय हमसे संपर्क करके अपनी सहमति की समीक्षा करने, सुधारने या वापस लेने का अधिकार है।',
    grievanceLabel:'शिकायत निवारण:',
    grievanceText:'किसी भी प्रश्न या अपने अधिकारों का प्रयोग करने के लिए, हमारे शिकायत अधिकारी से संपर्क करें:',
    fullDetails:'पूरी जानकारी हमारी',
    privacyPolicy:'गोपनीयता नीति',
    button:'मैं सहमत हूँ और जारी रखें',
    nameFallback:'आवेदक',
    docJoiner:'और'
  }
};
let docConsentLang=localStorage.getItem('mg_doc_consent_lang')||'en';

function formatDocList(items,joiner){
  const labels=items.map(it=>it.label);
  if(labels.length===0)return '';
  if(labels.length===1)return labels[0];
  return labels.slice(0,-1).join(', ')+' '+joiner+' '+labels[labels.length-1];
}

function renderDocPurposeModal(){
  const t=DOC_CONSENT_I18N[docConsentLang]||DOC_CONSENT_I18N.en;
  const name=(document.getElementById('fn')?document.getElementById('fn').value.trim():'')||t.nameFallback;
  const items=DOC_REQUIREMENTS[empCategory()]||DOC_REQUIREMENTS['Salaried'];
  const docList=formatDocList(items,t.docJoiner);
  const grievanceEmail=GRIEVANCE_EMAIL;

  const html=`
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px">
      <button type="button" onclick="setDocConsentLang('en')" style="font-size:12px;font-weight:${docConsentLang==='en'?'700':'500'};padding:4px 10px;border-radius:6px;border:1px solid var(--bdr);background:${docConsentLang==='en'?'var(--g)':'#fff'};color:${docConsentLang==='en'?'#fff':'var(--tx)'};cursor:pointer;font-family:inherit">English</button>
      <button type="button" onclick="setDocConsentLang('hi')" style="font-size:12px;font-weight:${docConsentLang==='hi'?'700':'500'};padding:4px 10px;border-radius:6px;border:1px solid var(--bdr);background:${docConsentLang==='hi'?'var(--g)':'#fff'};color:${docConsentLang==='hi'?'#fff':'var(--tx)'};cursor:pointer;font-family:inherit">हिंदी</button>
    </div>
    <h3 style="font-family:var(--font-display);font-size:19px;font-weight:700;margin-bottom:12px">${t.title}</h3>
    <p style="font-size:14px;color:var(--tx);margin-bottom:10px">${t.intro}</p>
    <div style="background:#f0f9f4;border:1px solid var(--g);border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13.5px;color:var(--tx);line-height:1.6">
      ${t.consentPrefix} <strong>${name}</strong> — ${docList} — ${t.consentSuffix}
    </div>
    <ul style="font-size:13.5px;color:#374151;padding-left:1.2rem;margin-bottom:14px;line-height:1.8;list-style:none">
      <li><strong>${t.purposeLabel}</strong> ${t.purposeText}</li>
      <li><strong>${t.sharingLabel}</strong> ${t.sharingText}</li>
      <li><strong>${t.rightsLabel}</strong> ${t.rightsText}</li>
      <li><strong>${t.grievanceLabel}</strong> ${t.grievanceText} <a href="mailto:${grievanceEmail}" style="color:var(--g);text-decoration:underline">${grievanceEmail}</a></li>
    </ul>
    <p style="font-size:12px;color:var(--mu);margin-bottom:16px">${t.fullDetails} <a href="privacy-policy.html" target="_blank" rel="noopener" style="color:var(--g);text-decoration:underline">${t.privacyPolicy}</a>.</p>
    <button type="button" class="abtn" style="margin-top:0" onclick="recordDocConsent()">${t.button}</button>
  `;
  const container=document.getElementById('docPurposeModalContent');
  if(container)container.innerHTML=html;
}

function setDocConsentLang(lang){
  docConsentLang=lang;
  localStorage.setItem('mg_doc_consent_lang',lang);
  renderDocPurposeModal();
}

function showDocPurposeModal(){
  const modal=document.getElementById('docPurposeModal');
  if(!modal)return;
  renderDocPurposeModal();
  modal.style.display='flex';
}
function dismissDocPurposeModal(){
  const modal=document.getElementById('docPurposeModal');
  if(modal)modal.style.display='none';
}
async function recordDocConsent(){
  const t=DOC_CONSENT_I18N[docConsentLang]||DOC_CONSENT_I18N.en;
  const name=(document.getElementById('fn') ? document.getElementById('fn').value.trim() : '')||t.nameFallback;
  const phone=document.getElementById('fp') ? document.getElementById('fp').value.trim() : '';
  const items=DOC_REQUIREMENTS[empCategory()]||DOC_REQUIREMENTS['Salaried'];
  const docList=formatDocList(items,t.docJoiner);
  const consentTimestamp=new Date().toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
  const consentText='I, '+name+' ('+phone+'), consent to share my '+docList+' with StarkLoan for the purpose of processing my loan application. Recorded on '+consentTimestamp+' [language: '+docConsentLang+'].';

  dismissDocPurposeModal();

  let rowId=currentRowId;
  if(!rowId && rowIdPromise){
    try{rowId=await rowIdPromise}catch(e){}
  }
  // If the row hasn't been created yet for some reason, don't block the
  // user over it — this is a non-critical background save, same
  // philosophy as document uploads and CAPI events elsewhere in this file.
  if(!rowId)return;
  if(!GSHEET_URL || GSHEET_URL.indexOf('PASTE_')===0)return;

  fetch(GSHEET_URL,{
    method:'POST',
    mode:'no-cors',
    headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({action:'saveConsentRecord',rowId:rowId,name:name,phone:phone,consentText:consentText,secret:API_SECRET})
  }).catch(()=>{});
}

function goStep3(){
  const amount=document.getElementById('fa').value;
  const emp=document.getElementById('fem').value;
  if(!amount){toast('Please select the loan amount required','err');return}
  if(!emp){toast('Please select your employment type','err');return}

  const leads=getLeads();
  const lead={
    id:currentLeadId,
    name:document.getElementById('fn').value.trim(),
    phone:document.getElementById('fp').value.trim(),
    city:document.getElementById('fc').value.trim(),
    loanType:aLT,amount,emp,
    income:document.getElementById('fi').value,
    existingLoan:document.getElementById('fexist').value,
    date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
    dateRaw:new Date().toISOString(),
    status:'Partial',
    resumeToken:getOrCreateResumeToken(),
    lastStep:'step3'
  };
  const idx=leads.findIndex(l=>l.id===currentLeadId);
  if(idx>-1){leads[idx]=lead}else{leads.unshift(lead)}
  saveLeads(leads);

  currentRowId=null;
  rowIdPromise=createLeadAndGetRowId(lead);

  document.getElementById('step2').style.display='none';
  document.getElementById('step3').style.display='';
  renderDocRequirements();
  showDocPurposeModal();
  document.getElementById('step3').scrollIntoView({behavior:'smooth',block:'start'});
}

function backToStep2(){
  document.getElementById('step3').style.display='none';
  document.getElementById('step2').style.display='';
  document.getElementById('step2').scrollIntoView({behavior:'smooth',block:'start'});
}

function engageAnswered(btn,val){
  document.querySelectorAll('#engageOpts .ltab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  window._engageAnswer=val;
}

function setEngageProgress(pct,text){
  const bar=document.getElementById('engageProgressBar');
  const txt=document.getElementById('engageProgressText');
  if(bar)bar.style.width=Math.max(8,Math.min(100,pct))+'%';
  if(txt && text)txt.textContent=text;
}

async function submitLead(){
  const name=document.getElementById('fn').value.trim();
  const phone=document.getElementById('fp').value.trim();
  const amount=document.getElementById('fa').value;
  const emp=document.getElementById('fem').value;
  if(filesConverting>0){toast('Please wait — still processing your document(s)...','err');return}

  const hasFiles=Object.keys(docFiles).length>0;

  if(hasFiles){
    const docConsentEl=document.getElementById('fdocconsent');
    if(docConsentEl && !docConsentEl.checked){
      toast('Please confirm the document upload declaration to continue','err');
      return;
    }
  }

  const leads=getLeads();
  const lead={
    id:currentLeadId||Date.now(),name,phone,
    city:document.getElementById('fc').value.trim(),
    loanType:aLT,amount,emp,
    income:document.getElementById('fi').value,
    existingLoan:document.getElementById('fexist').value,
    date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
    dateRaw:new Date().toISOString(),
    status:'New',
    resumeToken:getOrCreateResumeToken(),
    lastStep:'complete',
    docConsentTimestamp:new Date().toISOString()
  };
  const idx=leads.findIndex(l=>l.id===currentLeadId);
  if(idx>-1){leads[idx]=lead}else{leads.unshift(lead)}
  saveLeads(leads);

  const waURL=buildWAMessage(lead);
  document.getElementById('waContinueBtn').href=waURL;

  // Shared event ID lets Meta de-duplicate the browser Pixel event and the
  // server-side Conversions API event below — both describe the same
  // real-world conversion, so Meta should count it once, not twice.
  const capiEventId='lead_'+lead.id;

  const LEAD_VALUE=calcLeadValue(aLT,amount);

  if(typeof fbq==='function') fbq('track','Lead',{loan_type:aLT,currency:'INR',value:LEAD_VALUE},{eventID:capiEventId});
  fireEvent('generate_lead',{currency:'INR',loan_type:aLT,value:LEAD_VALUE});

  // Send the matching server-side event via Apps Script — NOT directly to
  // Meta from the browser. This keeps your CAPI access token out of the
  // page entirely (it lives only in Apps Script's Script Properties).
  if(GSHEET_URL && GSHEET_URL.indexOf('PASTE_')!==0){
    fetch(GSHEET_URL,{
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'sendCAPI',eventName:'Lead',eventId:capiEventId,name:name,phone:phone,loanType:aLT,value:LEAD_VALUE,secret:API_SECRET})
    }).catch(()=>{});
  }

  createLeadAndGetRowId(lead);

  const lastItems=docChunks[docChunkIndex]||[];

  if(!hasFiles){
    document.getElementById('step3successMsg').textContent='Your details are saved. Redirecting you to WhatsApp…';
    document.getElementById('step3form').style.display='none';
    document.getElementById('step3success').style.display='';
    toast('Application submitted!','ok');
    clearResumeToken();
    setTimeout(()=>{ window.location.href=waURL; },1200);
    return;
  }

  document.getElementById('step3form').style.display='none';
  document.getElementById('step3engage').style.display='';
  document.getElementById('step3engage').scrollIntoView({behavior:'smooth',block:'start'});
  setEngageProgress(15,'Uploading your documents securely…');

  const rowId=await getRowId();
  let uploadPromises=[];
  if(rowId){
    lastItems.forEach(it=>{
      const f=docFiles[it.key];
      if(f && !f.uploaded){
        f.uploaded=true;
        uploadPromises.push(uploadFileToDrive(rowId,f));
        trackDocUpload();
      }
    });
  }

  setEngageProgress(55,'Almost done…');

  const minWait=new Promise(res=>setTimeout(res,3000));
  const maxWait=new Promise(res=>setTimeout(res,8000));
  const uploadsDone=uploadPromises.length?Promise.allSettled(uploadPromises):Promise.resolve();

  await Promise.race([
    Promise.all([minWait,uploadsDone]).then(()=>setEngageProgress(100,'All set!')),
    maxWait.then(()=>setEngageProgress(100,'All set!'))
  ]);

  document.getElementById('step3engage').style.display='none';
  document.getElementById('step3successMsg').textContent='Your details and documents are saved. Redirecting you to WhatsApp…';
  document.getElementById('step3success').style.display='';
  toast('Application submitted!','ok');
  clearResumeToken();

  window.location.href=waURL;
}
