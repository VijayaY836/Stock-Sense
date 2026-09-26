import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, CheckCheck, Ban, Undo2, Trash2, Save, Printer, ScanLine, Plus, X, ListChecks, RotateCw,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, useLookups } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { fmtDate, fmtQty, todayISO, TYPE_META } from '../lib/format.js';
import { Button, ErrorBanner, Input, Modal, Select, Spinner, StatusBadge, Tag, Textarea, TypeTag } from '../components/ui.jsx';

// ------------------------------------------------------------------ Odoo-style status bar
function StatusBar({ status, type }) {
  if (status === 'canceled') return <StatusBadge status="canceled" />;
  const steps = type === 'receipt' || type === 'adjustment' ? ['draft', 'ready', 'done'] : ['draft', 'waiting', 'ready', 'done'];
  const labels = { draft: 'Draft', waiting: 'Waiting', ready: 'Ready', done: 'Done' };
  const current = steps.indexOf(status);
  return (
    <ol className="flex overflow-hidden rounded-md border border-line bg-white text-[13px]" aria-label="Status">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined}
          className={`relative px-3.5 py-1.5 font-medium ${i === current ? 'bg-plum text-white' : i < current ? 'text-ink-2' : 'text-ink-3'} ${i > 0 ? 'border-l border-line' : ''}`}>
          {labels[s]}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ product picker (type to search, arrows + enter)
function ProductPicker({ products, value, onChange, exclude, error, autoFocus }) {
  const selected = products.find((p) => p.id === value);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    return products.filter((p) => !exclude.has(p.id) && (!t || p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t))).slice(0, 8);
  }, [term, products, exclude]);
  const pick = (p) => { onChange(p); setTerm(''); setOpen(false); };

  if (selected && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full text-left">
        <span className="block font-medium">{selected.name}</span>
        <span className="num block text-[12.5px] text-ink-3">{selected.sku}</span>
      </button>
    );
  }
  return (
    <div className="relative">
      <input className={`input h-9 ${error ? 'input-error' : ''}`} placeholder="Search product or SKU" value={term} autoFocus={autoFocus || open}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); if (matches[active]) pick(matches[active]); }
          if (e.key === 'Escape') setOpen(false);
        }} aria-label="Product" />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {matches.length === 0 && <li className="px-3 py-2 text-[13.5px] text-ink-3">No matching products</li>}
          {matches.map((p, i) => (
            <li key={p.id}>
              <button type="button" onMouseDown={() => pick(p)} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[14px] ${i === active ? 'bg-plum-soft' : ''}`}>
                <span className="truncate">{p.name}</span><span className="num shrink-0 text-[12.5px] text-ink-3">{p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ main page
const blankLine = () => ({ key: Math.random().toString(36).slice(2), product_id: null, quantity: '' });

export default function Operation() {
  const { kind, type: newType } = useParams();
  const id = /^\d+$/.test(kind ?? '') ? kind : undefined; // /operations/:kind with a numeric id
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const { isManager } = useAuth();
  const { warehouses, locations } = useLookups();
  const { data: productsPage } = useApi('/products', { pageSize: 200 });
  const products = productsPage?.items ?? [];
  const { data: op, error: loadError, reload } = useApi(isNew ? null : `/operations/${id}`);

  const type = isNew ? newType : op?.type;
  const meta = TYPE_META[type];
  const editable = isNew || op?.status === 'draft';

  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([blankLine()]);
  const [errors, setErrors] = useState({});
  const [shortages, setShortages] = useState({});
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const scanRef = useRef(null);
  const createdId = useRef(null);
  const [scan, setScan] = useState('');

  const internal = locations.filter((l) => l.type === 'internal');
  const byType = (t) => locations.find((l) => l.type === t);

  // Initialise the form from the loaded operation, or defaults for a new one
  useEffect(() => {
    if (isNew) {
      if (!locations.length || form) return;
      const def = internal.find((l) => l.is_default) ?? internal[0];
      const other = internal.find((l) => l.id !== def?.id);
      setForm({
        partner: '', scheduled_date: todayISO(), notes: '',
        source_location_id: { receipt: byType('vendor')?.id, delivery: def?.id, internal: def?.id, adjustment: def?.id }[newType] ?? '',
        dest_location_id: { receipt: def?.id, delivery: byType('customer')?.id, internal: other?.id, adjustment: def?.id }[newType] ?? '',
      });
    } else if (op) {
      setForm({
        partner: op.partner ?? '', scheduled_date: op.scheduled_date, notes: op.notes ?? '',
        source_location_id: op.source_location_id, dest_location_id: op.dest_location_id,
      });
      setLines(op.lines.map((l) => ({ key: String(l.id), product_id: l.product_id, quantity: l.quantity, system_qty: l.system_qty })));
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, locations, isNew, newType]);

  // Live stock at the source location, so the user sees availability before validating
  const { data: stockHere } = useApi(form?.source_location_id && type !== 'receipt' ? '/stock' : null,
    { location_id: form?.source_location_id }, [op?.status]);

  if (loadError) return <ErrorBanner error={loadError} onRetry={reload} />;
  if (isNew && !meta) return <ErrorBanner error={{ message: 'Unknown operation type' }} />;
  if (!form || (!isNew && !op)) return <Spinner />;

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); setDirty(true); };
  const setLine = (key, patch) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); setDirty(true); setShortages({}); };
  const removeLine = (key) => { setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [blankLine()])); setDirty(true); };
  const used = new Set(lines.map((l) => l.product_id).filter(Boolean));
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  const payload = () => ({
    type,
    partner: form.partner,
    scheduled_date: form.scheduled_date,
    notes: form.notes,
    source_location_id: form.source_location_id || undefined,
    dest_location_id: form.dest_location_id || undefined,
    lines: lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, quantity: l.quantity === '' ? undefined : l.quantity })),
  });

  const handleError = (e) => {
    const f = e.fields || {};
    if (f.shortages) setShortages(Object.fromEntries(f.shortages.map((s) => [s.product_id, s])));
    setErrors(f);
    toast(e.message, 'error');
  };

  /** Save (create or update). Returns the saved operation id. */
  const save = async ({ quiet } = {}) => {
    setErrors({});
    if (isNew && createdId.current) {
      // Already created on an earlier click (e.g. a validation that failed): update it, never duplicate
      await api.put(`/operations/${createdId.current}`, payload());
      return createdId.current;
    }
    if (isNew) {
      const created = await api.post('/operations', payload());
      createdId.current = created.id;
      if (!quiet) toast(`${created.reference} created`);
      return created.id;
    }
    if (dirty) {
      await api.put(`/operations/${op.id}`, payload());
      setDirty(false);
      if (!quiet) toast('Changes saved');
    }
    return op.id;
  };

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (e) { handleError(e); } finally { setBusy(''); }
  };

  const doSave = () => run('save', async () => {
    const savedId = await save();
    if (isNew) navigate(`/operations/${savedId}`, { replace: true }); else reload();
  });

  const doAction = (name, path, message) => run(name, async () => {
    const savedId = editable ? await save({ quiet: true }) : op.id;
    const res = await api.post(`/operations/${savedId}/${path}`);
    if (name === 'confirm' || name === 'check') {
      toast(res.status === 'ready' ? `${res.reference} is ready: all stock is available` : `${res.reference} is waiting for stock`,
        res.status === 'ready' ? 'success' : 'error');
      if (res.shortages?.length) setShortages(Object.fromEntries(res.shortages.map((s) => [s.product_id, s])));
    } else toast(message(res));
    if (isNew || savedId !== op?.id) navigate(`/operations/${savedId}`, { replace: true }); else reload();
  });

  const doReturn = () => run('return', async () => {
    const ret = await api.post(`/operations/${op.id}/return`);
    toast(`Return ${ret.reference} created as a draft`);
    navigate(`/operations/${ret.id}`);
  });

  const doDelete = () => run('delete', async () => {
    await api.del(`/operations/${op.id}`);
    toast(`${op.reference} deleted`);
    navigate(`/operations/${meta.path}`);
  });

  /** Barcode scanners type the SKU and press Enter: add the product or bump its quantity */
  const onScan = (e) => {
    e.preventDefault();
    const sku = scan.trim().toUpperCase();
    if (!sku) return;
    const p = products.find((x) => x.sku === sku);
    if (!p) { toast(`No product with SKU ${sku}`, 'error'); return; }
    setLines((ls) => {
      const existing = ls.find((l) => l.product_id === p.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, quantity: Number(l.quantity || 0) + 1 } : l));
      const blank = ls.find((l) => !l.product_id);
      if (blank) return ls.map((l) => (l === blank ? { ...l, product_id: p.id, quantity: 1 } : l));
      return [...ls, { ...blankLine(), product_id: p.id, quantity: 1 }];
    });
    setDirty(true);
    setScan('');
  };

  const status = isNew ? 'draft' : op.status;
  const title = isNew ? `New ${meta.label.toLowerCase()}` : op.reference;
  const isAdj = type === 'adjustment';
  const showAvailable = type === 'delivery' || type === 'internal' || isAdj;
  const locOpt = (l) => <option key={l.id} value={l.id}>{l.full_name}</option>;
  const warehouseName = (locId) => {
    const l = locations.find((x) => x.id === Number(locId));
    return warehouses.find((w) => w.id === l?.warehouse_id)?.name;
  };

  // ---- action buttons by status
  const actions = [];
  if (editable) actions.push(<Button key="save" icon={Save} loading={busy === 'save'} onClick={doSave} disabled={!isNew && !dirty}>Save</Button>);
  if (status === 'draft' && !isAdj && type !== 'receipt') actions.push(<Button key="confirm" icon={ListChecks} loading={busy === 'confirm'} onClick={() => doAction('confirm', 'confirm')}>Mark as to do</Button>);
  if (status === 'waiting') actions.push(<Button key="check" icon={RotateCw} loading={busy === 'check'} onClick={() => doAction('check', 'check')}>Check availability</Button>);
  if (['draft', 'waiting', 'ready'].includes(status) && (!isAdj || isManager)) {
    actions.push(<Button key="validate" variant="primary" icon={CheckCheck} loading={busy === 'validate'}
      onClick={() => doAction('validate', 'validate', (r) => `${r.reference} validated. Stock updated.`)}>{isAdj ? 'Apply count' : 'Validate'}</Button>);
  }
  if (status === 'done' && !isAdj) actions.push(<Button key="return" icon={Undo2} loading={busy === 'return'} onClick={doReturn}>Return</Button>);
  if (status === 'done') actions.push(<Button key="print" icon={Printer} onClick={() => window.print()}>Print</Button>);
  if (!isNew && ['draft', 'waiting', 'ready'].includes(status)) actions.push(<Button key="cancel" variant="ghost" icon={Ban} onClick={() => setConfirmCancel(true)}>Cancel</Button>);
  if (!isNew && ['draft', 'canceled'].includes(status)) actions.push(<Button key="delete" variant="danger" icon={Trash2} loading={busy === 'delete'} onClick={doDelete}>Delete</Button>);

  return (
    <div className="print:text-black">
      <Link to={`/operations/${meta.path}`} className="mb-2 inline-flex items-center gap-1 text-[13.5px] text-ink-2 hover:text-ink print:hidden">
        <ArrowLeft size={14} /> {meta.plural}
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="num text-[26px] font-semibold tracking-[-0.01em]">{title}</h1>
            <TypeTag type={type} />
            {op?.is_late && <Tag tone="amber">Late</Tag>}
          </div>
          {op?.return_of_reference && <p className="mt-1 text-[14px] text-ink-2">Return of <Link className="text-plum hover:underline" to={`/operations/${op.return_of_id}`}>{op.return_of_reference}</Link></p>}
          {op?.returns?.length > 0 && <p className="mt-1 text-[14px] text-ink-2">Returned by {op.returns.map((r) => <Link key={r.id} className="mr-2 text-plum hover:underline" to={`/operations/${r.id}`}>{r.reference}</Link>)}</p>}
        </div>
        <StatusBar status={status} type={type} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2 print:hidden">{actions}</div>

      {status === 'waiting' && (
        <div className="mb-5 rounded-lg border border-amber/30 bg-amber-soft px-4 py-3 text-[14px] text-amber">
          Some products aren’t available at the source location yet. It becomes Ready by itself when stock arrives, or you can check again.
        </div>
      )}
      {isAdj && !isManager && ['draft', 'ready'].includes(status) && (
        <div className="mb-5 rounded-lg border border-sky/25 bg-sky-soft px-4 py-3 text-[14px] text-sky">
          Save your count here. An Inventory Manager reviews and applies it.
        </div>
      )}

      <div className="card mb-6">
        <div className="grid gap-5 p-5 md:grid-cols-2 lg:grid-cols-3">
          {meta.partner && (
            <Input label={type === 'receipt' ? 'Receive from (supplier)' : 'Deliver to (customer)'} value={form.partner} onChange={set('partner')}
              disabled={!editable} error={errors.partner} placeholder={type === 'receipt' ? 'Supplier name' : 'Customer name'} />
          )}
          {type === 'receipt' && (
            <Select label="Destination" value={form.dest_location_id} onChange={set('dest_location_id')} disabled={!editable} error={errors.dest_location_id}
              hint={warehouseName(form.dest_location_id)}>{internal.map(locOpt)}</Select>
          )}
          {(type === 'delivery' || type === 'internal') && (
            <Select label="Source location" value={form.source_location_id} onChange={set('source_location_id')} disabled={!editable} error={errors.source_location_id}
              hint={warehouseName(form.source_location_id)}>{internal.map(locOpt)}</Select>
          )}
          {type === 'internal' && (
            <Select label="Destination location" value={form.dest_location_id} onChange={set('dest_location_id')} disabled={!editable} error={errors.dest_location_id}
              hint={warehouseName(form.dest_location_id)}>{internal.map(locOpt)}</Select>
          )}
          {isAdj && (
            <Select label="Counted at" value={form.source_location_id} onChange={set('source_location_id')} disabled={!editable} error={errors.source_location_id}
              hint={warehouseName(form.source_location_id)}>{internal.map(locOpt)}</Select>
          )}
          {op?.return_of_id && (
            <div><p className="label">Route</p><p className="py-2 text-[15px]">{op.source_name} → {op.dest_name}</p></div>
          )}
          <Input label="Scheduled date" type="date" value={form.scheduled_date ?? ''} onChange={set('scheduled_date')} disabled={!editable} error={errors.scheduled_date} />
          <Textarea label={isAdj ? 'Reason' : 'Notes'} className="md:col-span-2 lg:col-span-3" rows={2} value={form.notes} onChange={set('notes')} disabled={!editable}
            placeholder={isAdj ? 'e.g. Weekly cycle count, damaged in handling' : 'Anything the team should know'} />
        </div>
        {!isNew && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-[13px] text-ink-2">
            <span>Created by {op.created_by_name ?? '—'}</span>
            {op.validated_at && <span>Validated by {op.validated_by_name} on {fmtDate(op.validated_at, true)}</span>}
          </div>
        )}
      </div>

      <section className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="font-semibold">{isAdj ? 'Counted products' : 'Products'}</h2>
          {editable && (
            <form onSubmit={onScan} className="relative print:hidden">
              <ScanLine size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} className="input h-8.5 w-56 pl-8 text-[13.5px]"
                placeholder="Scan or type SKU, then Enter" aria-label="Scan SKU" />
            </form>
          )}
        </div>
        {errors.lines && <p className="px-5 pt-3 text-[13.5px] text-brick">{errors.lines}</p>}
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr>
              <th className="min-w-[240px]">Product</th>
              {showAvailable && <th className="text-right">{isAdj ? 'Recorded' : 'Available'}</th>}
              <th className="w-40 text-right">{isAdj ? 'Counted' : 'Quantity'}</th>
              {isAdj && <th className="text-right">Difference</th>}
              <th className="w-20">Unit</th>
              {editable && <th className="w-10 print:hidden"><span className="sr-only">Remove</span></th>}
            </tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById[l.product_id];
                const recorded = status === 'done' && isAdj ? l.system_qty : stockHere?.[l.product_id] ?? 0;
                const short = shortages[l.product_id];
                const needsMore = showAvailable && !isAdj && p && status !== 'done' && Number(l.quantity) > recorded;
                const diff = isAdj && p && l.quantity !== '' ? Math.round((Number(l.quantity) - recorded) * 1000) / 1000 : null;
                return (
                  <tr key={l.key} className={short ? 'bg-brick-soft/60' : ''}>
                    <td>
                      {editable
                        ? <ProductPicker products={products} value={l.product_id} exclude={used} error={errors[`lines.${i}.product_id`]}
                            onChange={(prod) => setLine(l.key, { product_id: prod.id })} />
                        : <><span className="block font-medium">{p?.name ?? op.lines[i]?.product_name}</span><span className="num text-[12.5px] text-ink-3">{p?.sku ?? op.lines[i]?.sku}</span></>}
                      {short && <p className="mt-1 text-[12.5px] text-brick">Only {fmtQty(short.available)} available here</p>}
                    </td>
                    {showAvailable && (
                      <td className={`num text-right ${needsMore ? 'font-medium text-amber' : 'text-ink-2'}`}>{p ? fmtQty(recorded) : '—'}</td>
                    )}
                    <td className="text-right">
                      {editable ? (
                        <input type="number" min="0" step="any" inputMode="decimal" value={l.quantity} aria-label="Quantity"
                          onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                          className={`input num h-9 text-right ${errors[`lines.${i}.quantity`] ? 'input-error' : ''}`} />
                      ) : <span className="num font-medium">{fmtQty(l.quantity)}</span>}
                      {errors[`lines.${i}.quantity`] && <p className="mt-1 text-[12.5px] text-brick">{errors[`lines.${i}.quantity`]}</p>}
                    </td>
                    {isAdj && (
                      <td className={`num text-right font-medium ${diff > 0 ? 'text-teal' : diff < 0 ? 'text-brick' : 'text-ink-3'}`}>
                        {diff === null ? '—' : diff > 0 ? `+${fmtQty(diff)}` : fmtQty(diff)}
                      </td>
                    )}
                    <td className="text-ink-2">{p?.uom ?? ''}</td>
                    {editable && (
                      <td className="print:hidden">
                        <button onClick={() => removeLine(l.key)} className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-brick" aria-label="Remove line"><X size={16} /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="border-t border-line px-5 py-2.5 print:hidden">
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => { setLines((ls) => [...ls, blankLine()]); setDirty(true); }}>Add a product</Button>
          </div>
        )}
      </section>

      {op?.moves?.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">Stock moves recorded</h2>
            <span className="flex items-center gap-1.5 text-[13px] text-ink-3"><Check size={14} /> Permanent ledger entries</span>
          </div>
          <table className="table">
            <thead><tr><th>Product</th><th>From</th><th>To</th><th className="text-right">Quantity</th></tr></thead>
            <tbody>
              {op.moves.map((m) => (
                <tr key={m.id}>
                  <td><span className="font-medium">{m.product_name}</span> <span className="num text-ink-3">{m.sku}</span></td>
                  <td className="text-ink-2">{locations.find((x) => x.id === m.from_location_id)?.full_name}</td>
                  <td className="text-ink-2">{locations.find((x) => x.id === m.to_location_id)?.full_name}</td>
                  <td className="num text-right font-medium">{fmtQty(m.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title={`Cancel ${op?.reference}?`} width="max-w-md"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep it</Button>
          <Button variant="danger" icon={Ban} loading={busy === 'cancel'}
            onClick={() => { setConfirmCancel(false); doAction('cancel', 'cancel', (r) => `${r.reference} canceled`); }}>Cancel operation</Button>
        </>}>
        <p className="text-[14.5px] text-ink-2">No stock has moved yet, so nothing changes in your inventory. You can delete it afterwards.</p>
      </Modal>
    </div>
  );
}
