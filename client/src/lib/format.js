export const TYPE_META = {
  receipt:    { label: 'Receipt',    plural: 'Receipts',   path: 'receipts',    partner: 'Supplier', tone: 'teal' },
  delivery:   { label: 'Delivery',   plural: 'Deliveries', path: 'deliveries',  partner: 'Customer', tone: 'brick' },
  internal:   { label: 'Transfer',   plural: 'Internal transfers', path: 'transfers', partner: null, tone: 'sky' },
  adjustment: { label: 'Adjustment', plural: 'Adjustments', path: 'adjustments', partner: null, tone: 'amber' },
};
export const TYPE_BY_PATH = Object.fromEntries(Object.entries(TYPE_META).map(([k, v]) => [v.path, k]));

export const STATUS_META = {
  draft:    { label: 'Draft',    cls: 'bg-canvas text-ink-2 ring-line' },
  waiting:  { label: 'Waiting',  cls: 'bg-amber-soft text-amber ring-amber/25' },
  ready:    { label: 'Ready',    cls: 'bg-sky-soft text-sky ring-sky/25' },
  done:     { label: 'Done',     cls: 'bg-teal-soft text-teal ring-teal/25' },
  canceled: { label: 'Canceled', cls: 'bg-brick-soft text-brick ring-brick/20' },
};

const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const fmtQty = (n) => qtyFmt.format(Number(n) || 0);
export const fmtMoney = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);

export function fmtDate(value, withTime = false) {
  if (!value) return '—';
  const d = typeof value === 'string' && value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleString('en-IN', withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

/** 'WH/Stock' for warehouse locations, plain name for virtual ones */
export const locName = (name, whCode) => (whCode ? `${whCode}/${name}` : name);

export function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
