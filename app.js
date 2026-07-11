// ===================================================================
// StarkLoan Leads — Apps Script v5 (hardened + Meta CAPI)
// Paste this WHOLE file into Apps Script (replacing everything),
// Save, then Deploy → Manage deployments → Edit → New version → Deploy
// ===================================================================

const FOLDER_NAME = 'StarkLoan - Loan Documents';
const HEADERS = ['Timestamp','Name','Phone','Loan Type','Amount','Employment','Income','City','Existing Loan','Status','Documents'];

// Shared secret — this is NOT strong security (anyone who views your
// site's page source can read it), but it filters out random bots and
// scanners that try posting to Apps Script URLs blindly. Change this
// to your own random string, and update the matching value in your
// site's index.html (search for API_SECRET there).
const API_SECRET = 'CHANGE_THIS_TO_A_RANDOM_STRING_1234';

// Hard server-side limits — these matter because a client-side check
// (like the 5MB limit in your browser JS) can always be bypassed by
// anyone who calls this URL directly, skipping your website entirely.
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg','image/png','image/webp','application/pdf'];
const MAX_FIELD_LEN = 200;

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function clip_(val) {
  if (val === undefined || val === null) return '';
  return String(val).slice(0, MAX_FIELD_LEN);
}

// Finds an existing 'Partial' row for this phone, or appends a new row.
function upsertLeadRow_(lead) {
  const sheet = getSheet_();
  const row = [
    new Date(),
    clip_(lead.name),
    clip_(lead.phone),
    clip_(lead.loanType),
    clip_(lead.amount),
    clip_(lead.emp),
    clip_(lead.income),
    clip_(lead.city),
    clip_(lead.existingLoan),
    clip_(lead.status),
    ''
  ];

  let targetRow = -1;
  if (lead.phone) {
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][2]) === String(lead.phone) && data[i][9] === 'Partial') {
        targetRow = i + 1;
        break;
      }
    }
  }

  if (targetRow > 0) {
    const existingDocs = sheet.getRange(targetRow, 11).getValue();
    sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
    if (existingDocs) sheet.getRange(targetRow, 11).setValue(existingDocs);
  } else {
    sheet.appendRow(row);
    targetRow = sheet.getLastRow();
  }
  return targetRow;
}

// Safely appends a document link, locked so parallel requests
// writing to the same row never overwrite each other.
function appendDocLink_(rowId, label, url) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_();
    const range = sheet.getRange(rowId, 11);
    const current = range.getValue();
    range.setValue(current ? current + '\n' + label + ': ' + url : label + ': ' + url);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Basic gate — rejects requests that don't carry the shared secret.
    // Again: a determined attacker can extract this from your page
    // source, so treat this as spam reduction, not real security.
    if (data.secret !== API_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({status:'error', message:'Unauthorized'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION 1 — save/update the lead's text fields, return the row number
    if (data.action === 'createLead') {
      const rowId = upsertLeadRow_(data.lead || {});
      return ContentService.createTextOutput(JSON.stringify({status:'success', rowId}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION 2 — handle ONE file (called many times in parallel from the site)
    if (data.action === 'uploadFile') {
      if (!data.rowId || !data.fileData) {
        return ContentService.createTextOutput(JSON.stringify({status:'error', message:'Missing rowId or fileData'}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const fileType = data.fileType || 'application/octet-stream';
      if (ALLOWED_FILE_TYPES.indexOf(fileType) === -1) {
        return ContentService.createTextOutput(JSON.stringify({status:'error', message:'File type not allowed'}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const bytes = Utilities.base64Decode(data.fileData);
      if (bytes.length > MAX_FILE_BYTES) {
        return ContentService.createTextOutput(JSON.stringify({status:'error', message:'File exceeds 5MB limit'}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const folder = getFolder_();
      const blob = Utilities.newBlob(bytes, fileType, clip_(data.fileName) || 'document');
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      appendDocLink_(data.rowId, clip_(data.label) || 'Document', file.getUrl());
      return ContentService.createTextOutput(JSON.stringify({status:'success'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION 3 — forward a conversion event (Lead or Lead_DocUpload) to
    // Meta's Conversions API from the SERVER side. Your Meta access token
    // lives only in this script's Script Properties (Project Settings →
    // Script Properties) — it is never sent to or visible from the
    // browser/website. data.eventName selects which event fires; the
    // event_id must match the one sent client-side via fbq(..., {eventID})
    // for Meta to deduplicate the browser and server copies of the same event.
    if (data.action === 'sendCAPI') {
      sendMetaCAPI_(data);
      return ContentService.createTextOutput(JSON.stringify({status:'success'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({status:'error', message:'Unknown action'}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status:'error', message: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Hashes a value with SHA-256 as hex, lowercase — the format Meta's
// Conversions API requires for personal data like phone/name.
function sha256Hex_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalized, Utilities.Charset.UTF_8);
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// Sends one conversion event to Meta's Conversions API — used for both
// the initial 'Lead' event (form submit) and the 'Lead_DocUpload' event
// (each document upload), selected via data.eventName. Failures here are
// logged but never break the lead-saving flow above — losing an ad
// tracking event is much less costly than losing a real applicant's data.
function sendMetaCAPI_(data) {
  const props = PropertiesService.getScriptProperties();
  const pixelId = props.getProperty('META_PIXEL_ID');
  const accessToken = props.getProperty('META_ACCESS_TOKEN');
  if (!pixelId || !accessToken) return; // CAPI not configured yet — skip silently

  // Indian mobile numbers need the country code for Meta's matching to work
  const rawPhone = String(data.phone || '').replace(/\D/g, '');
  const phoneForHash = rawPhone.length === 10 ? '91' + rawPhone : rawPhone;

  // Defaults to 'Lead' so older calls to this action (without eventName)
  // keep working exactly as before.
  const eventName = clip_(data.eventName) || 'Lead';

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: clip_(data.eventId),
      action_source: 'website',
      user_data: {
        ph: [sha256Hex_(phoneForHash)],
        fn: [sha256Hex_(data.name)]
      },
      custom_data: {
        loan_type: clip_(data.loanType),
        currency: 'INR',
        value: Number(data.value) || 0
      }
    }]
  };

  try {
    UrlFetchApp.fetch(
      'https://graph.facebook.com/v20.0/' + pixelId + '/events?access_token=' + accessToken,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
  } catch (err) {
    // Swallow errors — a CAPI failure should never surface to the user
    // or block their application from being saved.
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status:'StarkLoan script v5 is live'}))
    .setMimeType(ContentService.MimeType.JSON);
}
