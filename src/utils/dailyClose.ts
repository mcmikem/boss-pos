import { Sale, Expense, Product } from '../types';

export function printDailyClose(dateStr: string, sales: Sale[], expenses: Expense[], products: Product[]) {
  const day = dateStr || new Date().toISOString().slice(0,10);
  const daySales = sales.filter(s => (s.timestamp || '').slice(0,10) === day && !s.refunded);
  const dayExpenses = expenses.filter(e => (e.timestamp || '').slice(0,10) === day);
  const revenue = daySales.reduce((a,s)=>a+s.total,0);
  const cogs = daySales.reduce((a,s)=>a + s.items.reduce((b,it)=>b + (it.unitCost||0)*it.qty, 0), 0);
  const gross = revenue - cogs;
  const expTotal = dayExpenses.reduce((a,e)=>a+e.amount,0);
  const net = gross - expTotal;
  const low = products.filter(p=>!p.isService && p.stockQty <= (p.lowStockThreshold||5)).slice(0,10);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Daily Close ${day}</title>
  <style>body{font-family:system-ui, sans-serif; padding:24px; color:#111} h1{font-size:18px} table{width:100%; border-collapse:collapse; margin:12px 0} th,td{border:1px solid #ddd; padding:6px 8px; text-align:left; font-size:12px} th{background:#f5f5f5} .muted{color:#666; font-size:11px} .right{text-align:right}</style></head><body>
  <h1>Daily Close — ${day}</h1><div class="muted">Generated ${new Date().toLocaleString()}</div>
  <table><tr><th>Revenue</th><th>COGS</th><th>Gross</th><th>Expenses</th><th>Net</th></tr><tr><td>${revenue.toLocaleString()}</td><td>${cogs.toLocaleString()}</td><td>${gross.toLocaleString()}</td><td>${expTotal.toLocaleString()}</td><td><b>${net.toLocaleString()}</b></td></tr></table>
  <h3>Sales (${daySales.length})</h3><table><tr><th>Order</th><th>Time</th><th>Items</th><th class="right">Total</th><th>Pay</th></tr>${daySales.map(s=>`<tr><td>${s.orderNumber}</td><td>${new Date(s.timestamp).toLocaleTimeString()}</td><td>${s.items.map(i=>`${i.productName}×${i.qty}`).join(', ')}</td><td class="right">${s.total.toLocaleString()}</td><td>${s.paymentMethod}</td></tr>`).join('') || '<tr><td colspan=5 class="muted">No sales</td></tr>'}</table>
  <h3>Expenses (${dayExpenses.length})</h3><table><tr><th>Time</th><th>Description</th><th>Cat</th><th class="right">Amount</th></tr>${dayExpenses.map(e=>`<tr><td>${new Date(e.timestamp).toLocaleTimeString()}</td><td>${e.description}</td><td>${e.category}</td><td class="right">${e.amount.toLocaleString()}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">No expenses</td></tr>'}</table>
  ${low.length ? `<h3>Low stock</h3><table><tr><th>Product</th><th class="right">Qty</th><th class="right">Threshold</th></tr>${low.map(p=>`<tr><td>${p.name}</td><td class="right">${p.stockQty}</td><td class="right">${p.lowStockThreshold||5}</td></tr>`).join('')}</table>` : ''}
  <p class="muted">IMAC POS — keep for records</p><script>window.print()</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
