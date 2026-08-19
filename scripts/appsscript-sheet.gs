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
    'Discount', 'Seller', 'Customer', 'Items',
  ]);
  const items = (data.items || [])
    .map((i) => i.productName + (i.qty > 1 ? ' x' + i.qty : ''))
    .join(', ');
  sheet.appendRow([
    data.timestamp || '', data.orderNumber || '', data.paymentMethod || '',
    data.total != null ? data.total : '', data.subtotal != null ? data.subtotal : '',
    data.tax != null ? data.tax : '', data.discount || '',
    data.staffName || '', data.customerName || '', items,
  ]);
}

function appendExpense(data) {
  const sheet = getOrCreate(EXPENSES_SHEET, ['Timestamp', 'Category', 'Description', 'Amount']);
  sheet.appendRow([
    data.timestamp || '', data.category || '', data.description || '',
    data.amount != null ? data.amount : '',
  ]);
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