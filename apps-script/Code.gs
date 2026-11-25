/**
 * Onhand bridge for one Google Sheet. Paste into Extensions > Apps Script of
 * the sheet, set the script property ONHAND_TOKEN, and deploy as a web app
 * (execute as: me, access: anyone). Only the Onhand server calls it, and every
 * call must carry the token.
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
  var ss = SpreadsheetApp.getActive();
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

function leadsTab_() {
  var ss = SpreadsheetApp.getActive();
  var tab = ss.getSheetByName(LEADS_TAB);
  if (!tab) {
    tab = ss.insertSheet(LEADS_TAB);
    tab.appendRow(LEAD_HEADERS);
    tab.setFrozenRows(1);
  }
  return tab;
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
