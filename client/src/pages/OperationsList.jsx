import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, List, Columns3, Inbox } from 'lucide-react';
import { useApi, useDebounced, useLookups } from '../lib/hooks.js';
import { fmtDate, fmtQty, locName, STATUS_META, TYPE_BY_PATH, TYPE_META } from '../lib/format.js';
import { Button, EmptyState, ErrorBanner, PageHeader, Pagination, Route, Segmented, Spinner, StatusBadge, Tag } from '../components/ui.jsx';

const SUBTITLES = {
  receipt: 'Goods arriving from vendors. Validating adds them to stock.',
  delivery: 'Goods leaving for customers. Validating takes them out of stock.',
  internal: 'Stock moving between racks, floors and warehouses. Totals stay the same.',
  adjustment: 'Physical counts. Validating corrects recorded stock to what was counted.',
};

function routeFor(o) {
  const from = locName(o.source_name, o.source_wh);
  return o.type === 'adjustment' ? `Count at ${from}` : <Route from={from} to={locName(o.dest_name, o.dest_wh)} />;
}

function Kanban({ items }) {
  const cols = ['draft', 'waiting', 'ready', 'done'];
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
      {cols.map((status) => {
        const list = items.filter((o) => o.status === status);
        return (
          <div key={status} className="min-w-0 rounded-lg bg-canvas p-2.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <StatusBadge status={status} />
              <span className="num text-[13px] text-ink-3">{list.length}</span>
            </div>
            <div className="space-y-2">
              {list.map((o) => (
                <Link key={o.id} to={`/operations/${o.id}`} className="block rounded-md border border-line bg-white p-3 transition-colors hover:border-plum/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[14px] font-semibold">{o.reference}</span>
                    {o.is_late && <Tag tone="amber">Late</Tag>}
                  </div>
                  {o.partner && <p className="mt-0.5 truncate text-[13.5px] text-ink">{o.partner}</p>}
                  <p className="mt-1 truncate text-[12.5px] text-ink-2">{routeFor(o)}</p>
                  <p className="num mt-1.5 text-[12.5px] text-ink-3">{fmtDate(o.scheduled_date)} · {o.line_count} {o.line_count === 1 ? 'product' : 'products'}</p>
                </Link>
              ))}
              {list.length === 0 && <p className="px-1 py-3 text-[13px] text-ink-3">Nothing here</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OperationsList() {
  const { kind } = useParams();
  const type = TYPE_BY_PATH[kind];
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { warehouses } = useLookups();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [view, setView] = useState('list');
  const status = params.get('status') ?? 'open';
  const warehouse = params.get('warehouse_id') ?? '';
  const late = params.get('late') === '1';
  const setParam = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }); setPage(1); };
  useEffect(() => { setPage(1); setSearch(''); }, [kind]);

  const { data, loading, error, reload } = useApi(type ? '/operations' : null, {
    type, status: view === 'kanban' || status === 'all' ? '' : status, warehouse_id: warehouse, search: debounced, late: late || '', page,
    pageSize: view === 'kanban' ? 100 : 25,
  });
  if (!type) return <Navigate to="/dashboard" replace />;
  const meta = TYPE_META[type];

  return (
    <>
      <PageHeader title={meta.plural} subtitle={SUBTITLES[type]}
        actions={<Button variant="primary" icon={Plus} onClick={() => navigate(`/operations/new/${type}`)}>New {meta.label.toLowerCase()}</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <input className="input h-9 w-full sm:w-60" placeholder={`Reference, ${meta.partner?.toLowerCase() ?? 'product'} or SKU`}
            value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          {view === 'list' && (
            <select className="input h-9 w-auto" value={status} onChange={(e) => setParam('status', e.target.value === 'open' ? '' : e.target.value || 'all')} aria-label="Status">
              <option value="open">Open (not done)</option>
              {Object.entries(STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
              <option value="all">Any status</option>
            </select>
          )}
          <select className="input h-9 w-auto" value={warehouse} onChange={(e) => setParam('warehouse_id', e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 text-[13.5px] text-ink-2">
            <input type="checkbox" checked={late} onChange={(e) => setParam('late', e.target.checked ? '1' : '')} className="accent-plum" /> Late only
          </label>
          <div className="ml-auto">
            <Segmented label="View" value={view} onChange={setView} options={[
              { value: 'list', label: <span className="flex items-center gap-1.5"><List size={14} /> List</span> },
              { value: 'kanban', label: <span className="flex items-center gap-1.5"><Columns3 size={14} /> Board</span> },
            ]} />
          </div>
        </div>

        {error ? <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div>
          : loading && !data ? <Spinner />
          : view === 'kanban' ? <Kanban items={data.items} />
          : data.items.length === 0 ? (
            <EmptyState icon={Inbox} title={`No ${meta.plural.toLowerCase()} here`}
              action={<Button variant="primary" icon={Plus} onClick={() => navigate(`/operations/new/${type}`)}>New {meta.label.toLowerCase()}</Button>}>
              Try another status filter, or create one.
            </EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr>
                    <th>Reference</th>
                    {meta.partner && <th>{meta.partner}</th>}
                    <th>{type === 'adjustment' ? 'Location' : 'Route'}</th>
                    <th>Scheduled</th>
                    <th className="text-right">Products</th>
                    <th className="text-right">Status</th>
                  </tr></thead>
                  <tbody>
                    {data.items.map((o) => (
                      <tr key={o.id} className="clickable" onClick={() => navigate(`/operations/${o.id}`)}>
                        <td className="whitespace-nowrap"><Link to={`/operations/${o.id}`} onClick={(e) => e.stopPropagation()} className="num font-medium hover:text-plum">{o.reference}</Link></td>
                        {meta.partner && <td className="max-w-[200px] truncate">{o.partner ?? <span className="text-ink-3">—</span>}</td>}
                        <td className="max-w-[260px] text-ink-2">{routeFor(o)}</td>
                        <td className="whitespace-nowrap text-ink-2">{fmtDate(o.scheduled_date)} {o.is_late && <Tag tone="amber">Late</Tag>}</td>
                        <td className="num text-right text-ink-2">{o.line_count} <span className="text-ink-3">({fmtQty(o.total_qty)})</span></td>
                        <td className="text-right"><StatusBadge status={o.status} /></td>
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
