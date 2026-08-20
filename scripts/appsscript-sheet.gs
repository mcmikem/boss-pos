// Google Apps Script that receive rows from the POS and appends them to your
// spreadsheet in tidy columns.
//
// HOW TO SET UP (about 2 minutes):
//   1. Open the Google Sheet where you want records saved.
//   2. Menu: Extensions -> Apps Script
//   3. Delete any sample code, paste this whole file, click Save.
//   4. Click Deploy -> New deployment -> type "Web app".
//      Execute as: Me | Who has access: Anyone (this URL is your password)
//      Click Deploy, then copy the "Web app URL" (ends in /exec).
//   5. In the POS app: Settings -> Google Sheets -> paste that URL -> Test Connection.
//
// Every new sale and expense from now on lands in this spreadsheet, with one
// row per sale / per expense. Nothing in the POS stops working if this file is
// changed — the POS sends rows and ignores replies.

// Sheet names. Sales and Expenses are created automatically on first use.
const SALES_SHEET = 'Sales';
const EXPENSES_SHEET = 'Expenses';
const LOG_SHEET = 'Log';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const type = (body.type || '').toString().toLowerCase();

    if (type === 'sale') appendSale(body.data);
    else if (type === 'expense') appendExpense(body.data);
    else appendLog(body.data);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function appendSale(data) {
  const sheet = getOrCreate(SALES_SHEET, [
    'Timestamp', 'Order No', 'Payment', 'Total', 'Subtotal', 'Tax',
    'Discount', 'Seller', 'Customer', 'Items', 'Sale ID',
  ]);
  const orderKey = (data.orderNumber || data.id || '').toString().trim();
  const saleIdKey = (data.id || '').toString().trim();
  // Idempotency: a retried push must not add the same sale twice. Prefer the
  // unique Sale ID (column K); fall back to the Order No only when no id came
  // through, so a reused order number can't swallow a real new sale.
  if (saleIdKey) {
    if (sheetHasValue(sheet, 'K', saleIdKey)) return;
  } else if (orderKey && sheetHasValue(sheet, 'B', orderKey)) {
    return;
  }
  const items = (data.items || [])
    .map((i) => i.productName + (i.qty > 1 ? ' x' + i.qty : ''))
    .join(', ');
  sheet.appendRow([
    data.timestamp || '', data.orderNumber || '', data.paymentMethod || '',
    data.total != null ? data.total : '', data.subtotal != null ? data.subtotal : '',
    data.tax != null ? data.tax : '', data.discount || '',
    data.staffName || '', data.customerName || '', items, data.id || '',
  ]);
}

function appendExpense(data) {
  const sheet = getOrCreate(EXPENSES_SHEET, ['Timestamp', 'Category', 'Description', 'Amount', 'Expense ID']);
  const idKey = (data.id || data.expenseId || '').toString().trim();
  if (idKey && sheetHasValue(sheet, 'E', idKey)) {
    return;
  }
  sheet.appendRow([
    data.timestamp || '', data.category || '', data.description || '',
    data.amount != null ? data.amount : '', idKey,
  ]);
}

// True if the given column contains the exact value anywhere below the header.
function sheetHasValue(sheet, column, value) {
  const lastRow = Math.min(sheet.getLastRow(), 2000);
  if (lastRow <= 1) return false;
  const values = sheet.getRange(column + '2:' + column + lastRow).getValues();
  return values.some(function (row) { return String(row[0]).trim() === String(value).trim(); });
}

function appendLog(data) {
  const sheet = getOrCreate(LOG_SHEET, ['Timestamp', 'Whatever was sent']);
  sheet.appendRow([new Date().toISOString(), data ? JSON.stringify(data) : '']);
}

// Get the tab or create it with headers.
function getOrCreate(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setFontColor('#ffffff')
      .setBackground('#14532d');
    sheet.setFrozenRows(1);
  }
  return sheet;
}