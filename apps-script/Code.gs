/**
 * Onhand bridge for one Google Sheet. Paste into Extensions > Apps Script of
 * the sheet (or a standalone project with the script property SHEET_ID set to
 * the sheet's id), run setup() once to create the token, and deploy as a web
 * app (execute as: me, access: anyone). Only the Onhand server calls it, and
 * every call must carry the token.
 *
 * GET  ?token=...&action=ping           -> { ok, name, tabs }
 * GET  ?token=...&action=read&tab=Units -> the tab as CSV, values as displayed
 * POST { token, action: "lead", ... }   -> appends a row to the Leads tab and
 *                                          creates a Gmail draft
 */

var LEADS_TAB = 'Leads';
var LEAD_HEADERS = ['Date', 'Client', 'Source tab', 'Requests', 'Last filters', 'Shortlisted rows', 'Shortlist', 'What the client said', 'Draft'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!authorised_(p.token)) return json_({ ok: false, error: 'bad token' });
  var ss = book_();
  if (p.action === 'ping') {
    return json_({ ok: true, name: ss.getName(), tabs: ss.getSheets().map(function (s) { return s.getName(); }) });
  }
  if (p.action === 'read') {
    var sheet = ss.getSheetByName(p.tab || '');
    if (!sheet) return json_({ ok: false, error: 'no tab named ' + p.tab });
    var csv = sheet.getDataRange().getDisplayValues().map(function (row) {
      return row.map(csvCell_).join(',');
    }).join('\n');
    return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
  }
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'body is not JSON' });
  }
  if (!authorised_(body.token)) return json_({ ok: false, error: 'bad token' });
  if (body.action !== 'lead') return json_({ ok: false, error: 'unknown action' });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var shortlist = body.shortlist || [];
    var draft = GmailApp.createDraft(body.to || '', body.subject || 'Options from today', body.body || '');
    var draftUrl = 'https://mail.google.com/mail/u/0/#drafts?compose=' + draft.getMessage().getId();

    var leads = leadsTab_();
    leads.appendRow([
      new Date(),
      body.client || '',
      body.tab || '',
      body.requests || 0,
      body.filters || '',
      shortlist.map(function (s) { return 'r' + s.r; }).join(', '),
      shortlist.map(function (s) { return s.line; }).join('\n'),
      (body.transcript || []).join('\n'),
      draftUrl,
    ]);
    return json_({ ok: true, row: leads.getLastRow(), draftUrl: draftUrl });
  } finally {
    lock.releaseLock();
  }
}

/** The sheet this script sits in, or, for a standalone script, the one named by the SHEET_ID property. */
function book_() {
  var active = SpreadsheetApp.getActive();
  if (active) return active;
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
}

function leadsTab_() {
  var ss = book_();
  var tab = ss.getSheetByName(LEADS_TAB);
  if (!tab) {
    tab = ss.insertSheet(LEADS_TAB);
    tab.appendRow(LEAD_HEADERS);
    tab.setFrozenRows(1);
  }
  return tab;
}

/**
 * Run once from the editor. Creates ONHAND_TOKEN if it is missing and prints
 * it, so it can be copied into SHEET_SCRIPT_TOKEN on the server. Also asks for
 * the Sheets and Gmail permissions the web app needs.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('ONHAND_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('ONHAND_TOKEN', token);
  }
  var ss = book_();
  GmailApp.getDrafts();
  Logger.log('Sheet: ' + ss.getName() + ', tabs: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
  Logger.log('ONHAND_TOKEN=' + token);
}

function authorised_(token) {
  var want = PropertiesService.getScriptProperties().getProperty('ONHAND_TOKEN');
  return Boolean(want) && token === want;
}

function csvCell_(v) {
  var s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
