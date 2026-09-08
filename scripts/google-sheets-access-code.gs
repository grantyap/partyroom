/**
 * Bound Google Apps Script for the Form response sheet.
 * Script properties: EARLY_ACCESS_SECRET and, optionally, SHEET_NAME.
 * Sheet headers: "Access Code" and "Access Count".
 *
 * TODO(early-access): Delete this script when paid access replaces invite codes.
 */
function doPost(event) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);

  try {
    const body = JSON.parse(event.postData.contents || "{}");
    const properties = PropertiesService.getScriptProperties();
    if (!body.secret || body.secret !== properties.getProperty("EARLY_ACCESS_SECRET")) {
      return json({ valid: false }, 403);
    }

    const sheet = SpreadsheetApp.getActive().getSheetByName(
      properties.getProperty("SHEET_NAME") || "Form Responses 1",
    );
    if (!sheet) return json({ valid: false }, 500);

    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const codeColumn = headers.indexOf("Access Code");
    const countColumn = headers.indexOf("Access Count");
    if (codeColumn < 0 || countColumn < 0) return json({ valid: false }, 500);

    const wanted = String(body.code || "")
      .trim()
      .toUpperCase();
    const rowOffset = findCodeRow(values, wanted, codeColumn);
    if (!wanted || rowOffset < 0) return json({ valid: false }, 200);

    const row = rowOffset + 2;
    const countCell = sheet.getRange(row, countColumn + 1);
    countCell.setValue((Number(countCell.getValue()) || 0) + 1);
    return json({ valid: true }, 200);
  } finally {
    lock.releaseLock();
  }
}

function findCodeRow(values, wanted, codeColumn) {
  return values.slice(1).findIndex(
    (row) =>
      String(row[codeColumn] || "")
        .trim()
        .toUpperCase() === wanted,
  );
}

function testFindCodeRow() {
  console.assert(findCodeRow([["Access Code"], ["alpha"], ["BRAVO"]], "ALPHA", 0) === 0);
  console.assert(findCodeRow([["Access Code"], ["alpha"]], "MISSING", 0) === -1);
}

function json(body, status) {
  // Apps Script web apps always return HTTP 200; status is included for diagnostics.
  return ContentService.createTextOutput(JSON.stringify({ ...body, status: status })).setMimeType(
    ContentService.MimeType.JSON,
  );
}
