import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, History } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useDebounced, useLookups } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { downloadCsv, fmtDate, fmtQty, TYPE_META } from '../lib/format.js';
import { Button, EmptyState, ErrorBanner, PageHeader, Pagination, Route, Spinner, TypeTag } from '../components/ui.jsx';

export default function Moves() {
  const [params, setParams] = useSearchParams();
  const { warehouses } = useLookups();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const f = {
    product_id: params.get('product_id') ?? '',
    warehouse_id: params.get('warehouse_id') ?? '',
    type: params.get('type') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const setParam = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }); setPage(1); };
  useEffect(() => setPage(1), [debounced]);

  const query = { ...f, search: debounced };
  const { data, loading, error, reload } = useApi('/moves', { ...query, page, pageSize: 30 });
  const { data: product } = useApi(f.product_id ? `/products/${f.product_id}` : null);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = [];
      for (let p = 1; ; p++) {
        const res = await api.get('/moves', { ...query, page: p, pageSize: 200 });
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
      }
      downloadCsv(`stock-moves-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Date', 'Reference', 'Type', 'SKU', 'Product', 'From', 'To', 'Quantity', 'Unit', 'Stock change', 'Balance after', 'By'],
        ...all.map((m) => [new Date(m.created_at).toISOString(), m.reference, TYPE_META[m.operation_type].label, m.sku, m.product_name,
          m.from_name, m.to_name, m.quantity, m.uom, m.delta, m.balance, m.user_name ?? '']),
      ]);
      toast(`Exported ${all.length} moves`);
    } catch (e) { toast(e.message, 'error'); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title="Move history"
        subtitle={product ? <>Every change to <Link className="font-medium text-plum hover:underline" to={`/products/${product.id}`}>{product.name}</Link>, newest first. Balance is the total on hand after each move.</>
          : 'The stock ledger. Every move is permanent: mistakes are corrected with returns or counts, never edits.'}
        actions={<Button icon={Download} loading={exporting} onClick={exportCsv} disabled={!data?.total}>Export CSV</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <input className="input h-9 w-full sm:w-56" placeholder="Reference, SKU or product" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search moves" />
          <select className="input h-9 w-auto" value={f.type} onChange={(e) => setParam('type', e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {Object.entries(TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.plural}</option>)}
          </select>
          <select className="input h-9 w-auto" value={f.warehouse_id} onChange={(e) => setParam('warehouse_id', e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2">From
            <input type="date" className="input h-9 w-auto" value={f.from} onChange={(e) => setParam('from', e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2">To
            <input type="date" className="input h-9 w-auto" value={f.to} onChange={(e) => setParam('to', e.target.value)} /></label>
          {f.product_id && <Button size="sm" variant="ghost" onClick={() => setParam('product_id', '')}>Show all products</Button>}
        </div>
        {error ? <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div>
          : loading && !data ? <Spinner />
          : data.items.length === 0 ? <EmptyState icon={History} title="No moves match these filters">Validated receipts, deliveries, transfers and counts appear here.</EmptyState>
          : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr>
                    <th>Date</th><th>Reference</th><th>Product</th><th>From → To</th>
                    <th className="text-right">Change</th>{f.product_id && <th className="text-right">Balance</th>}<th>By</th>
                  </tr></thead>
                  <tbody>
                    {data.items.map((m) => (
                      <tr key={m.id}>
                        <td className="num whitespace-nowrap text-ink-2">{fmtDate(m.created_at, true)}</td>
                        <td className="whitespace-nowrap">
                          <Link to={`/operations/${m.operation_id}`} className="num font-medium hover:text-plum">{m.reference}</Link>
                          <div className="mt-0.5"><TypeTag type={m.operation_type} /></div>
                        </td>
                        <td>
                          <button onClick={() => setParam('product_id', m.product_id)} className="text-left hover:text-plum">
                            <span className="block font-medium">{m.product_name}</span><span className="num text-[12.5px] text-ink-3">{m.sku}</span>
                          </button>
                        </td>
                        <td className="max-w-[260px]"><Route from={m.from_name} to={m.to_name} /></td>
                        <td className={`num whitespace-nowrap text-right font-semibold ${m.delta > 0 ? 'text-teal' : m.delta < 0 ? 'text-brick' : 'text-ink-3'}`}>
                          {m.delta === 0
                            ? <span className="font-normal text-ink-2">{fmtQty(m.quantity)} {m.uom} moved</span>
                            : <>{m.delta > 0 ? '+' : ''}{fmtQty(m.delta)} <span className="font-normal text-ink-3">{m.uom}</span></>}
                        </td>
                        {f.product_id && <td className="num text-right font-medium">{fmtQty(m.balance)}</td>}
                        <td className="whitespace-nowrap text-ink-2">{m.user_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )}
      </div>
    </>
  );
}
