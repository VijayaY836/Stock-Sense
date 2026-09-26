import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, PackageX, PackageSearch, RefreshCcw, Plus, Inbox } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLookups } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { fmtDate, fmtMoney, fmtQty, locName, STATUS_META } from '../lib/format.js';
import { Button, EmptyState, ErrorBanner, PageHeader, Route, Segmented, Select, Spinner, StatusBadge, Tag, TypeTag } from '../components/ui.jsx';

function FlowNode({ title, children, strong }) {
  return (
    <div className={`rounded-xl px-5 py-4 ${strong ? 'bg-ink text-white' : 'border border-dashed border-ink-3/40 text-ink-2'}`}>
      <p className={`text-[13px] ${strong ? 'text-white/60' : ''}`}>{title}</p>
      {children}
    </div>
  );
}

/** A labelled arrow between nodes. It IS the KPI: click to open those operations. */
function FlowEdge({ to, count, late, label, tone }) {
  const color = { teal: 'text-teal', brick: 'text-brick' }[tone];
  return (
    <Link to={to} className="group relative flex flex-col items-center justify-center px-2 py-3 text-center" aria-label={`${count} ${label}`}>
      <span className={`num text-[34px] font-semibold leading-none tracking-[-0.02em] ${color} group-hover:underline decoration-2 underline-offset-4`}>{count}</span>
      <span className="mt-1.5 text-[13px] text-ink-2">{label}</span>
      <svg className={`mt-2 h-3 w-full max-w-[64px] rotate-90 md:max-w-[140px] md:rotate-0 ${color}`} viewBox="0 0 140 12" preserveAspectRatio="none" aria-hidden="true">
        <path d="M2 6h128" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" style={{ animation: count ? 'flow 1.4s linear infinite' : 'none' }} />
        <path d="M128 1l8 5-8 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      {late > 0 && <Tag tone="amber" className="mt-3 md:mt-1.5">{late} late</Tag>}
    </Link>
  );
}

function StockFlow({ d }) {
  const k = d.kpis;
  return (
    <section className="card overflow-hidden" aria-label="Stock flow">
      <div className="grid items-center gap-2 p-5 md:grid-cols-[1fr_1.1fr_1.5fr_1.1fr_1fr] md:p-6">
        <FlowNode title="Vendors"><p className="mt-1 text-[15px] font-medium text-ink">Goods arrive</p></FlowNode>
        <FlowEdge to="/operations/receipts?status=open" count={k.pending_receipts} late={d.pending.receipt.late} label="Pending receipts" tone="teal" />
        <FlowNode title="On hand" strong>
          <p className="num mt-1 text-[30px] font-semibold leading-tight tracking-[-0.02em]">{k.in_stock}<span className="text-[16px] font-normal text-white/60"> of {k.total_products} products</span></p>
          <p className="mt-0.5 text-[14px] text-white/70">{fmtMoney(k.stock_value)} stock value</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/12 pt-3 text-[13.5px]">
            <Link to="/operations/transfers?status=open" className="text-white/80 hover:text-white hover:underline">
              <span className="num font-semibold text-white">{k.scheduled_transfers}</span> {k.scheduled_transfers === 1 ? 'transfer' : 'transfers'} scheduled
            </Link>
            <Link to="/operations/adjustments?status=open" className="text-white/80 hover:text-white hover:underline">
              <span className="num font-semibold text-white">{k.pending_adjustments}</span> {k.pending_adjustments === 1 ? 'count' : 'counts'} to review
            </Link>
          </div>
        </FlowNode>
        <FlowEdge to="/operations/deliveries?status=open" count={k.pending_deliveries} late={d.pending.delivery.late} label="Pending deliveries" tone="brick" />
        <FlowNode title="Customers"><p className="mt-1 text-[15px] font-medium text-ink">Orders ship</p></FlowNode>
      </div>
      <div className="grid border-t border-line sm:grid-cols-2">
        <Link to="/products?stock=low" className="flex items-center gap-3 px-6 py-3.5 hover:bg-amber-soft/50 sm:border-r sm:border-line">
          <AlertTriangle size={18} className="text-amber" />
          <span className="text-[14.5px]"><span className="num font-semibold">{k.low_stock}</span> low stock</span>
          <span className="ml-auto text-[13px] text-ink-3">at or below reorder minimum</span>
        </Link>
        <Link to="/products?stock=out" className="flex items-center gap-3 border-t border-line px-6 py-3.5 hover:bg-brick-soft/50 sm:border-t-0">
          <PackageX size={18} className="text-brick" />
          <span className="text-[14.5px]"><span className="num font-semibold">{k.out_of_stock}</span> out of stock</span>
          <span className="ml-auto text-[13px] text-ink-3">nothing on hand</span>
        </Link>
      </div>
    </section>
  );
}

function LowStock({ items, warehouseId, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const replenish = async (p) => {
    const whs = warehouseId ? [Number(warehouseId)] : p.rule_warehouses ?? [];
    setBusy(p.id);
    try {
      const { created } = await api.post('/replenish', { items: whs.map((w) => ({ product_id: p.id, warehouse_id: w })) });
      if (!created.length) toast('Enough is already on order for this product');
      else {
        toast(`Draft receipt ${created.map((c) => c.reference).join(', ')} created`);
        if (created.length === 1) navigate(`/operations/${created[0].id}`);
      }
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="font-semibold">Needs attention</h2>
        <Link to="/reordering" className="text-[13.5px] font-medium text-plum hover:underline">Reordering rules</Link>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Stock levels look healthy">Nothing is below its reorder minimum.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((p) => {
            const pct = p.min_qty ? Math.min(100, (p.on_hand / p.min_qty) * 100) : 0;
            return (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/products/${p.id}`} className="block truncate text-[14.5px] font-medium hover:text-plum">{p.name}</Link>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-canvas">
                      <div className={`h-full rounded-full ${p.on_hand === 0 ? 'bg-brick' : 'bg-amber'}`} style={{ width: `${Math.max(pct, 3)}%` }} />
                    </div>
                    <span className="num text-[12.5px] text-ink-2">
                      {fmtQty(p.on_hand)}{p.min_qty != null && ` / min ${fmtQty(p.min_qty)}`} {p.uom}
                    </span>
                  </div>
                </div>
                {p.rule_warehouses?.length ? (
                  <Button size="sm" icon={RefreshCcw} loading={busy === p.id} onClick={() => replenish(p)}>Replenish</Button>
                ) : <Tag tone="brick">No rule</Tag>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const FLOW_TYPES = [
  { type: 'receipt', label: 'Receipts', tone: 'teal' },
  { type: 'delivery', label: 'Deliveries', tone: 'brick' },
  { type: 'internal', label: 'Transfers', tone: 'sky' },
  { type: 'adjustment', label: 'Adjustments', tone: 'plum' },
];
const BAR_CLS = { teal: 'bg-teal', brick: 'bg-brick', sky: 'bg-sky', plum: 'bg-plum' };
const TEXT_CLS = { teal: 'text-teal', brick: 'text-brick', sky: 'text-sky', plum: 'text-plum' };

function Last7Days({ data }) {
  const rows = FLOW_TYPES.map((f) => ({ ...f, ...(data?.[f.type] ?? { qty: 0, operations: 0 }) }));
  const max = Math.max(1, ...rows.map((r) => r.qty));
  const empty = rows.every((r) => r.qty === 0);
  return (
    <section className="card">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="font-semibold">Last 7 days</h2>
      </div>
      {empty ? (
        <EmptyState icon={PackageSearch} title="No stock movement yet">Moves from the last 7 days will show up here.</EmptyState>
      ) : (
        <ul className="space-y-3.5 px-5 py-4">
          {rows.map((r) => (
            <li key={r.type}>
              <div className="mb-1 flex items-baseline justify-between text-[13.5px]">
                <span className="text-ink-2">{r.label}</span>
                <span className="num text-ink-2">
                  <span className={`font-semibold ${TEXT_CLS[r.tone]}`}>{fmtQty(r.qty)}</span>{' '}
                  · {r.operations} {r.operations === 1 ? 'op' : 'ops'}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-canvas">
                <div
                  className={`h-full rounded-full ${BAR_CLS[r.tone]}`}
                  style={{ width: `${r.qty > 0 ? Math.max((r.qty / max) * 100, 4) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OperationsPanel({ warehouseId, categoryId }) {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('open');
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi('/operations', {
    type, status, warehouse_id: warehouseId, category_id: categoryId, pageSize: 8,
  });
  return (
    <section className="card min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="font-semibold">Operations</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Document type" value={type} onChange={setType} options={[
            { value: '', label: 'All' }, { value: 'receipt', label: 'Receipts' }, { value: 'delivery', label: 'Delivery' },
            { value: 'internal', label: 'Internal' }, { value: 'adjustment', label: 'Adjustments' },
          ]} />
          <select className="input h-8.5 w-auto py-1 text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="open">Open (not done)</option>
            <option value="">Any status</option>
            {Object.entries(STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>
        </div>
      </div>
      {error ? <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div>
        : loading && !data ? <Spinner />
        : data.items.length === 0 ? <EmptyState icon={Inbox} title="No operations match these filters" />
        : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Reference</th><th>Route</th><th>Scheduled</th><th className="text-right">Status</th></tr></thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => navigate(`/operations/${o.id}`)}>
                    <td className="whitespace-nowrap">
                      <Link to={`/operations/${o.id}`} className="num font-medium hover:text-plum" onClick={(e) => e.stopPropagation()}>{o.reference}</Link>
                      <div className="mt-0.5"><TypeTag type={o.type} /></div>
                    </td>
                    <td className="max-w-[240px]"><Route from={locName(o.source_name, o.source_wh)} to={o.type === 'adjustment' ? 'count' : locName(o.dest_name, o.dest_wh)} /></td>
                    <td className="whitespace-nowrap text-ink-2">
                      {fmtDate(o.scheduled_date)} {o.is_late && <Tag tone="amber">Late</Tag>}
                    </td>
                    <td className="text-right"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

export default function Dashboard() {
  const { warehouses, categories } = useLookups();
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const { data, error, loading, reload } = useApi('/dashboard', { warehouse_id: warehouseId, category_id: categoryId });

  return (
    <>
      <PageHeader title="Dashboard" subtitle="What’s coming in, what’s going out, and what needs you today."
        actions={<>
          <Select aria-label="Warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-44">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Link to="/operations/new/receipt"><Button variant="primary" icon={Plus}>New receipt</Button></Link>
        </>} />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : data && (
        <div className="space-y-6">
          <StockFlow d={data} />
          <div className="grid gap-6 xl:grid-cols-[1fr_1.55fr]">
            <div className="space-y-6">
              <LowStock items={data.low_stock} warehouseId={warehouseId} onDone={reload} />
              <Last7Days data={data.last7days} />
            </div>
            <OperationsPanel warehouseId={warehouseId} categoryId={categoryId} />
          </div>
        </div>
      )}
    </>
  );
}