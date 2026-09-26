import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Package, Pencil, ArrowLeft, Archive, ArchiveRestore, History, RefreshCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, useDebounced, useLookups } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { fmtMoney, fmtQty } from '../lib/format.js';
import {
  Button, EmptyState, ErrorBanner, Input, Modal, PageHeader, Pagination, Segmented, Select, Spinner, Tag,
} from '../components/ui.jsx';

const UOMS = ['Units', 'kg', 'g', 'L', 'mL', 'm', 'cm', 'Box', 'Pack', 'Pair', 'Dozen'];

export function StockLevel({ onHand, min, uom }) {
  const tone = onHand <= 0 ? 'text-brick' : min != null && onHand <= min ? 'text-amber' : 'text-ink';
  return (
    <span className={`num font-medium ${tone}`}>
      {fmtQty(onHand)} <span className="font-normal text-ink-3">{uom}</span>
    </span>
  );
}

export function ProductFormModal({ open, onClose, product, onSaved }) {
  const { categories, locations } = useLookups();
  const toast = useToast();
  const isEdit = !!product;
  const empty = { name: '', sku: '', category_id: '', uom: 'Units', unit_cost: '', initial_stock: '', initial_location_id: '' };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const internal = locations.filter((l) => l.type === 'internal');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setV(product ? { ...empty, ...product, category_id: product.category_id ?? '', unit_cost: product.unit_cost ?? '' } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);
  useEffect(() => {
    if (open && !isEdit && !v.initial_location_id && internal.length) {
      setV((x) => ({ ...x, initial_location_id: internal.find((l) => l.is_default)?.id ?? internal[0].id }));
    }
  }, [open, isEdit, internal, v.initial_location_id]);

  const set = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: v.name, sku: v.sku, uom: v.uom, category_id: v.category_id || null, unit_cost: v.unit_cost || 0,
        ...(!isEdit && v.initial_stock ? { initial_stock: v.initial_stock, initial_location_id: v.initial_location_id } : {}),
      };
      const saved = isEdit ? await api.put(`/products/${product.id}`, body) : await api.post('/products', body);
      toast(isEdit ? 'Product updated' : `${saved.name} created`);
      onSaved(saved);
      onClose();
    } catch (err) { setErrors({ ...err.fields, _form: err.message }); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit product' : 'New product'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{isEdit ? 'Save changes' : 'Create product'}</Button></>}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        {errors._form && !Object.keys(errors).some((k) => k !== '_form') && <p className="text-[14px] text-brick sm:col-span-2">{errors._form}</p>}
        <Input label="Name" className="sm:col-span-2" value={v.name} onChange={set('name')} error={errors.name} placeholder="e.g. Steel Rods 12mm" />
        <Input label="SKU / code" value={v.sku} onChange={(e) => set('sku')({ target: { value: e.target.value.toUpperCase() } })}
          error={errors.sku} placeholder="RM-STL-ROD12" hint="Letters, numbers and dashes" />
        <Select label="Category" value={v.category_id} onChange={set('category_id')} error={errors.category_id}>
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label="Unit of measure" value={v.uom} onChange={set('uom')} error={errors.uom}>
          {UOMS.map((u) => <option key={u}>{u}</option>)}
        </Select>
        <Input label="Unit cost (₹)" type="number" min="0" step="0.01" value={v.unit_cost} onChange={set('unit_cost')} error={errors.unit_cost} />
        {!isEdit && (
          <div className="grid gap-4 rounded-lg bg-canvas p-4 sm:col-span-2 sm:grid-cols-2">
            <Input label="Initial stock (optional)" type="number" min="0" step="any" value={v.initial_stock} onChange={set('initial_stock')} error={errors.initial_stock} />
            <Select label="Stored at" value={v.initial_location_id} onChange={set('initial_location_id')} error={errors.initial_location_id} disabled={!v.initial_stock}>
              {internal.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
            </Select>
            <p className="text-[12.5px] text-ink-3 sm:col-span-2">Initial stock is recorded as an inventory adjustment, so it shows up in the move history like every other change.</p>
          </div>
        )}
      </form>
    </Modal>
  );
}

export function ProductsList() {
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { categories, warehouses } = useLookups();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const stock = params.get('stock') ?? 'all';
  const category = params.get('category_id') ?? '';
  const warehouse = params.get('warehouse_id') ?? '';
  const setParam = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }); setPage(1); };

  const { data, loading, error, reload } = useApi('/products', { search: debounced, stock, category_id: category, warehouse_id: warehouse, page });
  useEffect(() => setPage(1), [debounced]);

  return (
    <>
      <PageHeader title="Products" subtitle="Everything you stock, with live quantities across locations."
        actions={isManager && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New product</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <input className="input h-9 w-full sm:w-64" placeholder="Search name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          <Segmented label="Stock" value={stock} onChange={(v) => setParam('stock', v === 'all' ? '' : v)} options={[
            { value: 'all', label: 'All' }, { value: 'in', label: 'In stock' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' },
          ]} />
          <select className="input h-9 w-auto" value={category} onChange={(e) => setParam('category_id', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input h-9 w-auto" value={warehouse} onChange={(e) => setParam('warehouse_id', e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        {error ? <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div>
          : loading && !data ? <Spinner />
          : data.items.length === 0 ? (
            <EmptyState icon={Package} title={debounced || stock !== 'all' || category ? 'No products match these filters' : 'No products yet'}
              action={isManager && !debounced && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Add your first product</Button>}>
              {!debounced && stock === 'all' && 'Add products to start receiving and tracking stock.'}
            </EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th className="text-right">On hand</th><th className="text-right">Reorder at</th><th className="text-right">Unit cost</th></tr></thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr key={p.id} className="clickable" onClick={() => navigate(`/products/${p.id}`)}>
                        <td className="font-medium">
                          <Link to={`/products/${p.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-plum">{p.name}</Link>
                          {!p.active && <Tag className="ml-2">Archived</Tag>}
                        </td>
                        <td className="num text-ink-2">{p.sku}</td>
                        <td className="text-ink-2">{p.category_name ?? '—'}</td>
                        <td className="whitespace-nowrap text-right"><StockLevel onHand={p.on_hand} min={p.min_qty} uom={p.uom} /></td>
                        <td className="num text-right text-ink-2">{p.min_qty != null ? fmtQty(p.min_qty) : '—'}</td>
                        <td className="num text-right text-ink-2">{fmtMoney(p.unit_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )}
      </div>
      <ProductFormModal open={creating} onClose={() => setCreating(false)} onSaved={(p) => navigate(`/products/${p.id}`)} />
    </>
  );
}

function RuleModal({ open, onClose, productId, rule, onSaved }) {
  const { warehouses } = useLookups();
  const toast = useToast();
  const [v, setV] = useState({ warehouse_id: '', min_qty: '', max_qty: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setErrors({}); setV(rule ? { warehouse_id: rule.warehouse_id, min_qty: rule.min_qty, max_qty: rule.max_qty } : { warehouse_id: warehouses[0]?.id ?? '', min_qty: '', max_qty: '' }); }
  }, [open, rule, warehouses]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { product_id: productId, ...v };
      rule ? await api.put(`/reorder-rules/${rule.id}`, body) : await api.post('/reorder-rules', body);
      toast('Reordering rule saved');
      onSaved(); onClose();
    } catch (e) { setErrors({ ...e.fields, _form: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={rule ? 'Edit reordering rule' : 'Add reordering rule'} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save rule</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Warehouse" className="sm:col-span-2" value={v.warehouse_id} onChange={(e) => setV({ ...v, warehouse_id: e.target.value })} error={errors.warehouse_id}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Input label="Minimum" type="number" min="0" value={v.min_qty} onChange={(e) => setV({ ...v, min_qty: e.target.value })} error={errors.min_qty} hint="Alert at or below this" />
        <Input label="Maximum" type="number" min="0" value={v.max_qty} onChange={(e) => setV({ ...v, max_qty: e.target.value })} error={errors.max_qty} hint="Replenish up to this" />
      </div>
    </Modal>
  );
}

export function ProductDetail() {
  const { id } = useParams();
  const { isManager } = useAuth();
  const toast = useToast();
  const { data: p, loading, error, reload } = useApi(`/products/${id}`);
  const [editing, setEditing] = useState(false);
  const [rule, setRule] = useState(null); // null = closed, {} = new, object = edit

  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (loading && !p) return <Spinner />;

  const toggleArchive = async () => {
    try { await api.patch(`/products/${p.id}/archive`, { active: !p.active }); toast(p.active ? 'Product archived' : 'Product restored'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const deleteRule = async (r) => {
    try { await api.del(`/reorder-rules/${r.id}`); toast('Rule removed'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader
        back={<Link to="/products" className="mb-2 inline-flex items-center gap-1 text-[13.5px] text-ink-2 hover:text-ink"><ArrowLeft size={14} /> Products</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{p.name}{!p.active && <Tag>Archived</Tag>}</span>}
        subtitle={<span className="num">{p.sku} · {p.category_name ?? 'No category'} · {p.uom}</span>}
        actions={<>
          <Link to={`/moves?product_id=${p.id}`}><Button icon={History}>Move history</Button></Link>
          {isManager && <Button icon={p.active ? Archive : ArchiveRestore} onClick={toggleArchive}>{p.active ? 'Archive' : 'Restore'}</Button>}
          {isManager && <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {[
          ['On hand', p.on_hand, 'text-ink'],
          ['Incoming', p.incoming, 'text-teal'],
          ['Outgoing', p.outgoing, 'text-brick'],
          ['Forecast', p.forecast, p.forecast < 0 ? 'text-brick' : 'text-ink'],
        ].map(([label, n, tone]) => (
          <div key={label} className="bg-white px-5 py-4">
            <p className="text-[13px] text-ink-2">{label}</p>
            <p className={`num mt-0.5 text-[24px] font-semibold tracking-[-0.01em] ${tone}`}>{fmtQty(n)} <span className="text-[14px] font-normal text-ink-3">{p.uom}</span></p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card">
          <h2 className="border-b border-line px-5 py-3.5 font-semibold">Stock by location</h2>
          {p.stock.length === 0 ? <EmptyState icon={Package} title="Not in stock anywhere">Receive it with a new receipt.</EmptyState> : (
            <table className="table">
              <thead><tr><th>Warehouse</th><th>Location</th><th className="text-right">Quantity</th></tr></thead>
              <tbody>
                {p.stock.map((s) => (
                  <tr key={s.location_id}>
                    <td>{s.warehouse_name}</td>
                    <td className="text-ink-2">{s.code}/{s.location_name}</td>
                    <td className="num text-right font-medium">{fmtQty(s.quantity)} <span className="font-normal text-ink-3">{p.uom}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card self-start">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">Reordering rules</h2>
            {isManager && <Button size="sm" icon={Plus} onClick={() => setRule({})}>Add rule</Button>}
          </div>
          {p.reorder_rules.length === 0 ? (
            <EmptyState icon={RefreshCcw} title="No rule yet">Set a minimum to get low-stock alerts and one-click replenishment.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {p.reorder_rules.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1">
                    <p className="text-[14.5px] font-medium">{r.warehouse_name}</p>
                    <p className="num text-[13px] text-ink-2">Min {fmtQty(r.min_qty)} · Max {fmtQty(r.max_qty)} {p.uom}</p>
                  </div>
                  {isManager && <>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setRule(r)} aria-label="Edit rule" />
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => deleteRule(r)} aria-label="Delete rule" />
                  </>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ProductFormModal open={editing} onClose={() => setEditing(false)} product={p} onSaved={reload} />
      <RuleModal open={!!rule} onClose={() => setRule(null)} productId={p.id} rule={rule?.id ? rule : null} onSaved={reload} />
    </>
  );
}
