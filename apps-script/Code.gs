/**
 * Sodjakfarm B2B – Google Sheets bridge for the invoice web app.
 *
 * Paste this file into the order spreadsheet:  Extensions → Apps Script.
 * 1. Change TOKEN below to your own secret word (the web app asks for the same word once).
 * 2. Deploy → New deployment → type "Web app"
 *      Execute as: Me      Who has access: Anyone
 *    Copy the Web app URL into the web app (Settings → Google Sheet connection).
 * 3. Reload the spreadsheet: a "Sodjakfarm" menu appears with "Assign invoice numbers".
 *
 * The web endpoint only READS the sheet. Only the menu (run by you inside the sheet) writes.
 */

const CONFIG = {
  TOKEN: 'CHANGE-ME',
  ORDERS: 'B2B Orders',
  CUSTOMERS: 'Customers',
  PRODUCTS: 'Products',
  INVOICES: 'Invoices',
  PREFIX: 'TG',
};

// B2B Orders columns (1-based)
const COL = {
  ORDER_DATE: 1, CUSTOMER: 2, PO: 3, PRODUCT: 4, ORDERED: 5, DELIVERED: 6,
  DELIVERY_DATE: 7, INVOICE: 8, UNIT_PRICE: 9, AMOUNT: 10, NOTE: 11, PRICE_CODE: 12,
};
const NUM_COLS = 12;

/* ─────────────────────────── sheet menu ─────────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sodjakfarm')
    .addItem('Assign invoice numbers', 'assignInvoiceNumbers')
    .addToUi();
}

/**
 * Gives every row that has a delivery date but no invoice number a number.
 * Rows with the same delivery date + customer + PO share one number.
 * Format: 2026-TG-MMDD01, 02, … per delivery date. Existing numbers are never changed.
 * Unit Price and Price Code of numbered rows are frozen (formula → value), so adding a
 * newer price code later doesn't alter issued invoices.
 */
function assignInvoiceNumbers() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const sh = ss.getSheetByName(CONFIG.ORDERS);
    const last = lastDataRow_(sh);
    if (last < 2) { SpreadsheetApp.getUi().alert('No orders found.'); return; }
    const values = sh.getRange(2, 1, last - 1, NUM_COLS).getValues();

    const seqByDay = {};   // "2026-TG-1009" -> highest sequence used
    const noByKey = {};    // "2026-10-09|Customer|PO" -> invoice no
    values.forEach(row => {
      const no = String(row[COL.INVOICE - 1] || '').trim();
      if (!no) return;
      const m = no.match(/^(\d{4}-[A-Z]+-\d{4})(\d+)$/);
      if (m) seqByDay[m[1]] = Math.max(seqByDay[m[1]] || 0, Number(m[2]));
      const d = row[COL.DELIVERY_DATE - 1];
      if (d instanceof Date) noByKey[groupKey_(row, tz)] = no;
    });

    // groups that still need a number, in sheet order
    const pending = {};
    const order = [];
    values.forEach((row, i) => {
      if (!row[COL.CUSTOMER - 1] || !row[COL.PRODUCT - 1]) return;
      if (String(row[COL.INVOICE - 1] || '').trim()) return;
      if (!(row[COL.DELIVERY_DATE - 1] instanceof Date)) return;
      const key = groupKey_(row, tz);
      if (!pending[key]) { pending[key] = []; order.push(key); }
      pending[key].push(i);
    });

    const assigned = [];
    const skipped = [];
    const newInvoices = [];
    order.forEach(key => {
      const idx = pending[key];
      const hasDelivered = idx.some(i => values[i][COL.DELIVERED - 1] !== '');
      const first = values[idx[0]];
      const label = `${first[COL.CUSTOMER - 1]} ${first[COL.PO - 1] || ''}`.trim();
      if (!hasDelivered) { skipped.push(`${label}: no Delivered Qty yet`); return; }
      let no = noByKey[key];
      if (!no) {
        const d = first[COL.DELIVERY_DATE - 1];
        const day = Utilities.formatDate(d, tz, 'yyyy') + '-' + CONFIG.PREFIX + '-' +
                    Utilities.formatDate(d, tz, 'MMdd');
        const seq = (seqByDay[day] || 0) + 1;
        seqByDay[day] = seq;
        no = day + String(seq).padStart(2, '0');
        noByKey[key] = no;
        newInvoices.push([no, d, first[COL.CUSTOMER - 1], first[COL.PO - 1]]);
      }
      idx.forEach(i => {
        const r = i + 2;
        sh.getRange(r, COL.INVOICE).setValue(no);
        const price = values[i][COL.UNIT_PRICE - 1];
        if (price !== '') sh.getRange(r, COL.UNIT_PRICE).setValue(price);
        const code = values[i][COL.PRICE_CODE - 1];
        if (code !== '') sh.getRange(r, COL.PRICE_CODE).setValue(code);
      });
      const noPrice = idx.filter(i => !Number(values[i][COL.UNIT_PRICE - 1]));
      assigned.push(`${no}  ${label}` + (noPrice.length ? '  ⚠ unit price missing' : ''));
    });

    if (newInvoices.length) appendInvoices_(ss, newInvoices);

    const msg = [];
    msg.push(assigned.length ? 'Assigned:\n' + assigned.join('\n') : 'Nothing to assign.');
    if (skipped.length) msg.push('\nSkipped:\n' + skipped.join('\n'));
    SpreadsheetApp.getUi().alert(msg.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

function appendInvoices_(ss, rows) {
  const sh = ss.getSheetByName(CONFIG.INVOICES);
  if (!sh) return;
  const existing = new Set(
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 3).getValues()
      .map(r => r[0] + '|' + r[2]));
  let r = lastDataRow_(sh) + 1;
  rows.forEach(([no, date, customer, po]) => {
    if (existing.has(no + '|' + customer)) return;
    const o = `'${CONFIG.ORDERS}'`;
    sh.getRange(r, 1, 1, 6).setValues([[
      no, date, customer, po,
      `=SUMIFS(${o}!$J:$J,${o}!$H:$H,$A${r},${o}!$B:$B,$C${r})`,
      `=IFERROR($B${r}+VLOOKUP($C${r},${CONFIG.CUSTOMERS}!$A:$G,7,FALSE),"")`,
    ]]);
    sh.getRange(r, 2).setNumberFormat('yyyy-mm-dd');
    sh.getRange(r, 6).setNumberFormat('yyyy-mm-dd');
    sh.getRange(r, 5).setNumberFormat('#,##0');
    r++;
  });
}

/* ─────────────────────────── web endpoint (read only) ─────────────────────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!CONFIG.TOKEN || CONFIG.TOKEN === 'CHANGE-ME' || p.token !== CONFIG.TOKEN) {
    return json_({ ok: false, error: 'unauthorized' });
  }
  try {
    if (p.action === 'dates') return json_({ ok: true, dates: listDates_() });
    if (p.action === 'invoices') {
      return json_({ ok: true, invoices: buildInvoices_({ date: p.date, no: p.no }) });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Recent delivery dates with how many invoices / unnumbered groups each has. */
function listDates_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const map = {};
  readOrders_(ss).forEach(row => {
    const d = row[COL.DELIVERY_DATE - 1];
    if (!(d instanceof Date) || !row[COL.CUSTOMER - 1]) return;
    const day = fmtDate_(d, tz);
    map[day] = map[day] || { date: day, invoices: {}, pending: {} };
    const no = String(row[COL.INVOICE - 1] || '').trim();
    const key = groupKey_(row, tz);
    if (no) map[day].invoices[no + '|' + row[COL.CUSTOMER - 1]] = 1;
    else map[day].pending[key] = 1;
  });
  return Object.values(map)
    .map(x => ({ date: x.date, invoices: Object.keys(x.invoices).length, pending: Object.keys(x.pending).length }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60);
}

/** Invoices for one delivery date (filter.date = yyyy-MM-dd) or one invoice number (filter.no). */
function buildInvoices_(filter) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const customers = readTable_(ss, CONFIG.CUSTOMERS);
  const products = readTable_(ss, CONFIG.PRODUCTS);
  const dueByInvoice = {};
  const invSh = ss.getSheetByName(CONFIG.INVOICES);
  if (invSh && invSh.getLastRow() > 1) {
    invSh.getRange(2, 1, invSh.getLastRow() - 1, 6).getValues().forEach(r => {
      if (r[0] && r[5] instanceof Date) dueByInvoice[r[0] + '|' + r[2]] = fmtDate_(r[5], tz);
    });
  }

  const groups = {};
  const order = [];
  readOrders_(ss).forEach(row => {
    const customer = String(row[COL.CUSTOMER - 1] || '').trim();
    if (!customer || !row[COL.PRODUCT - 1]) return;
    const d = row[COL.DELIVERY_DATE - 1];
    const day = d instanceof Date ? fmtDate_(d, tz) : '';
    const no = String(row[COL.INVOICE - 1] || '').trim();
    if (filter.no) { if (no !== String(filter.no).trim()) return; }
    else if (!day || day !== filter.date) return;

    const key = no ? no + '|' + customer : 'pending|' + groupKey_(row, tz);
    if (!groups[key]) {
      const c = customers[customer] || {};
      const days = Number(c['Payment Days']);
      groups[key] = {
        no: no || null,
        pending: !no,
        customer: customer,
        billTo: c['Bill To (on invoice)'] || customer,
        mobile: str_(c['Mobile']),
        email: str_(c['Email']),
        address: str_(c['Address']),
        priceGroup: str_(c['Price Group']),
        vatRate: (Number(c['VAT %']) || 0) / 100,
        poNo: str_(row[COL.PO - 1]),
        orderDate: row[COL.ORDER_DATE - 1] instanceof Date ? fmtDate_(row[COL.ORDER_DATE - 1], tz) : '',
        deliveryDate: day,
        dueDate: dueByInvoice[no + '|' + customer] ||
          (d instanceof Date ? fmtDate_(new Date(d.getTime() + (isNaN(days) ? 30 : days) * 864e5), tz) : ''),
        lines: [],
      };
      order.push(key);
    }
    const pkey = String(row[COL.PRODUCT - 1]);
    const prod = products[pkey] || {};
    groups[key].lines.push({
      product: pkey,
      name: prod['Name on Invoice'] || pkey,
      ordered: numOrNull_(row[COL.ORDERED - 1]),
      delivered: numOrNull_(row[COL.DELIVERED - 1]),
      unitPrice: numOrNull_(row[COL.UNIT_PRICE - 1]),
      amount: numOrNull_(row[COL.AMOUNT - 1]),
      note: str_(row[COL.NOTE - 1]),
      priceCode: str_(row[COL.PRICE_CODE - 1]),
    });
  });
  return order.map(k => groups[k]);
}

/* ─────────────────────────── helpers ─────────────────────────── */

function readOrders_(ss) {
  const sh = ss.getSheetByName(CONFIG.ORDERS);
  const last = lastDataRow_(sh);
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, NUM_COLS).getValues();
}

/** Reads a tab with a header row into { firstColumnValue: {header: value} }. */
function readTable_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return {};
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = vals[0].map(h => String(h).trim());
  const out = {};
  vals.slice(1).forEach(r => {
    const k = String(r[0] || '').trim();
    if (!k) return;
    out[k] = {};
    head.forEach((h, i) => { out[k][h] = r[i]; });
  });
  return out;
}

/** Last row that has a customer in column B (formula-only rows don't count). */
function lastDataRow_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return 1;
  const col = sh.getRange(1, 2, n, 1).getValues();
  for (let i = n - 1; i >= 1; i--) if (String(col[i][0]).trim()) return i + 1;
  return 1;
}

function groupKey_(row, tz) {
  const d = row[COL.DELIVERY_DATE - 1];
  return [d instanceof Date ? fmtDate_(d, tz) : '', String(row[COL.CUSTOMER - 1]).trim(),
          String(row[COL.PO - 1] || '').trim()].join('|');
}

function fmtDate_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function numOrNull_(v) { return v === '' || v === null || isNaN(Number(v)) ? null : Number(v); }
