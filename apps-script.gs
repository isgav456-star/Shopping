/**
 * רישום קניות לגיליון – "הקניות שלנו"
 * מדביקים את הקוד הזה ב-Extensions → Apps Script מתוך הגיליון, ומפרסמים כ-Web app
 * (Execute as: Me, Who has access: Anyone). את כתובת ה-/exec מדביקים בהגדרות האפליקציה.
 */
const SHEET_NAME = 'קניות';
const HEADERS = ['מזהה', 'תאריך', 'שעה', 'רשימה', 'סוג קנייה', 'סכום (₪)', 'מספר מוצרים', 'מוצרים', 'נרשם ע״י'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.ping) return out_({ ok: true, pong: true });
    if (!body.id) return out_({ ok: false, error: 'missing id' });

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = sheet_();
      const last = sh.getLastRow();
      const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().flat() : [];
      if (ids.indexOf(body.id) === -1) {
        const d = new Date(body.date);
        const tz = 'Asia/Jerusalem';
        sh.appendRow([
          body.id,
          Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
          Utilities.formatDate(d, tz, 'HH:mm'),
          body.list || '',
          body.kind || '',
          Number(body.price) || 0,
          Number(body.count) || 0,
          body.items || '',
          body.by || ''
        ]);
        sh.getRange(sh.getLastRow(), 6).setNumberFormat('₪#,##0.00');
      }
    } finally {
      lock.releaseLock();
    }
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return out_({ ok: true, info: 'Shopping sheet endpoint is running' });
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setRightToLeft(true);
    sh.hideColumns(1);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
