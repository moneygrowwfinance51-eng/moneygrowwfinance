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
  docFiles={};
  currentLeadId=null;
  docUploadEventFired=false;
  document.getElementById('sb2').style.background='var(--bdr)';
  document.getElementById('sb3').style.background='var(--bdr)';
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
  document.getElementById('docLoanType').textContent=aLT;
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

  const leads=getLeads();
  currentLeadId=Date.now();
  leads.unshift({
    id:currentLeadId,name,phone,
    loanType:aLT,amount:'',emp:'',income:'',city:'',existingLoan:'',
    date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
    dateRaw:new Date().toISOString(),
    status:'Partial'
  });
  saveLeads(leads);
  sendToSheet(leads[0]);
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
    status:'Partial'
  };
  const idx=leads.findIndex(l=>l.id===currentLeadId);
  if(idx>-1){leads[idx]=lead}else{leads.unshift(lead)}
  saveLeads(leads);

  currentRowId=null;
  rowIdPromise=createLeadAndGetRowId(lead);

  document.getElementById('sb3').style.background='var(--g)';
  document.getElementById('step2').style.display='none';
  document.getElementById('step3').style.display='';
  renderDocRequirements();
  document.getElementById('step3').scrollIntoView({behavior:'smooth',block:'start'});
}

function backToStep2(){
  document.getElementById('sb3').style.background='var(--bdr)';
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

  const leads=getLeads();
  const lead={
    id:currentLeadId||Date.now(),name,phone,
    city:document.getElementById('fc').value.trim(),
    loanType:aLT,amount,emp,
    income:document.getElementById('fi').value,
    existingLoan:document.getElementById('fexist').value,
    date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
    dateRaw:new Date().toISOString(),
    status:'New'
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

  window.location.href=waURL;
}