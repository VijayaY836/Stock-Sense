import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCcw, Warehouse, Tags, Pencil, Trash2, MapPin, Archive } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, useLookups } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { fmtQty } from '../lib/format.js';
import { Button, EmptyState, ErrorBanner, Input, Modal, PageHeader, Select, Spinner, Tag, Textarea } from '../components/ui.jsx';

/** Generic "edit a few fields in a modal" helper */
function useModalForm(initial, submit, onDone) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const show = (v = initial) => { setValues(v); setErrors({}); setOpen(true); };
  const bind = (k) => ({ value: values[k] ?? '', error: errors[k], onChange: (e) => setValues((x) => ({ ...x, [k]: e.target.value })) });
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try { await submit(values); setOpen(false); onDone?.(); } catch (err) { setErrors({ ...err.fields, _form: err.message }); } finally { setBusy(false); }
  };
  return { open, setOpen, show, values, setValues, bind, save, busy, errors };
}

// ------------------------------------------------------------------ reordering rules
export function Reordering() {
  const { isManager } = useAuth();
  const toast = useToast();
  const { warehouses } = useLookups();
  const [warehouse, setWarehouse] = useState('');
  const { data, loading, error, reload } = useApi('/reorder-rules', { warehouse_id: warehouse });
  const [busy, setBusy] = useState(false);
  const due = (data ?? []).filter((r) => r.needs_reorder);

  const replenishAll = async () => {
    setBusy(true);
    try {
      const { created } = await api.post('/replenish', { items: due.map((r) => ({ product_id: r.product_id, warehouse_id: r.warehouse_id })) });
      toast(created.length ? `Created ${created.map((c) => c.reference).join(', ')}` : 'Everything is already on order');
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Reordering rules" subtitle="When stock drops to the minimum, replenish up to the maximum. Stock already on order counts."
        actions={<>
          <Select aria-label="Warehouse" className="w-44" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Button variant="primary" icon={RefreshCcw} disabled={!due.length} loading={busy} onClick={replenishAll}>
            Replenish {due.length || ''} {due.length === 1 ? 'product' : 'products'}
          </Button>
        </>} />
      <div className="card">
        {error ? <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div>
          : loading && !data ? <Spinner />
          : data.length === 0 ? <EmptyState icon={RefreshCcw} title="No reordering rules yet">
              {isManager ? 'Open a product and add a rule to get alerts and one-click replenishment.' : 'An Inventory Manager can add rules on each product.'}
            </EmptyState>
          : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Product</th><th>Warehouse</th><th className="text-right">On hand</th><th className="text-right">Incoming</th><th className="text-right">Min</th><th className="text-right">Max</th><th className="text-right">To order</th></tr></thead>
                <tbody>
                  {data.map((r) => {
                    const toOrder = r.needs_reorder ? r.max_qty - r.on_hand - r.incoming : 0;
                    return (
                      <tr key={r.id} className={r.needs_reorder ? 'bg-amber-soft/40' : ''}>
                        <td><Link to={`/products/${r.product_id}`} className="font-medium hover:text-plum">{r.product_name}</Link> <span className="num text-[12.5px] text-ink-3">{r.sku}</span></td>
                        <td className="text-ink-2">{r.warehouse_name}</td>
                        <td className={`num text-right font-medium ${r.on_hand <= r.min_qty ? 'text-amber' : ''}`}>{fmtQty(r.on_hand)}</td>
                        <td className="num text-right text-teal">{r.incoming ? `+${fmtQty(r.incoming)}` : '—'}</td>
                        <td className="num text-right text-ink-2">{fmtQty(r.min_qty)}</td>
                        <td className="num text-right text-ink-2">{fmtQty(r.max_qty)}</td>
                        <td className="num text-right font-semibold">{toOrder > 0 ? `${fmtQty(toOrder)} ${r.uom}` : <span className="font-normal text-ink-3">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ warehouses + locations
export function Warehouses() {
  const { isManager } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/warehouses');
  const [whId, setWhId] = useState(null);
  const wh = useModalForm({ name: '', code: '', address: '' },
    async (v) => { v.id ? await api.put(`/warehouses/${v.id}`, v) : await api.post('/warehouses', v); toast(v.id ? 'Warehouse updated' : 'Warehouse created'); }, reload);
  const loc = useModalForm({ name: '' },
    async (v) => { v.id ? await api.put(`/locations/${v.id}`, { name: v.name }) : await api.post(`/warehouses/${whId}/locations`, { name: v.name }); toast('Location saved'); }, reload);

  const archive = async (l) => {
    try { await api.put(`/locations/${l.id}`, { name: l.name, active: false }); toast(`${l.name} archived`); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Warehouses" subtitle="Warehouses and the racks, rooms and floors inside them."
        actions={isManager && <Button variant="primary" icon={Plus} onClick={() => wh.show()}>New warehouse</Button>} />
      {error ? <ErrorBanner error={error} onRetry={reload} /> : loading && !data ? <Spinner /> : data.length === 0 ? (
        <div className="card"><EmptyState icon={Warehouse} title="No warehouses yet">Create one to start receiving stock.</EmptyState></div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {data.map((w) => (
            <section key={w.id} className="card">
              <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-[17px] font-semibold">{w.name} <Tag tone="plum" className="num">{w.code}</Tag></h2>
                  {w.address && <p className="mt-0.5 truncate text-[13.5px] text-ink-2">{w.address}</p>}
                </div>
                {isManager && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => wh.show({ id: w.id, name: w.name, code: w.code, address: w.address ?? '' })}>Edit</Button>}
              </div>
              <ul className="divide-y divide-line">
                {w.locations.filter((l) => l.active).map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
                    <MapPin size={15} className="text-ink-3" />
                    <span className="flex-1 text-[14.5px]">{w.code}/{l.name} {l.is_default && <Tag className="ml-1.5">Default</Tag>}</span>
                    <span className="num text-[13.5px] text-ink-2">{fmtQty(l.on_hand)} units</span>
                    {isManager && <>
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Rename ${l.name}`} onClick={() => { setWhId(w.id); loc.show({ id: l.id, name: l.name }); }} />
                      {!l.is_default && <Button size="sm" variant="ghost" icon={Archive} aria-label={`Archive ${l.name}`} onClick={() => archive(l)} />}
                    </>}
                  </li>
                ))}
              </ul>
              {isManager && (
                <div className="border-t border-line px-5 py-2.5">
                  <Button size="sm" variant="ghost" icon={Plus} onClick={() => { setWhId(w.id); loc.show(); }}>Add location</Button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <Modal open={wh.open} onClose={() => wh.setOpen(false)} title={wh.values.id ? 'Edit warehouse' : 'New warehouse'}
        footer={<><Button variant="ghost" onClick={() => wh.setOpen(false)}>Cancel</Button><Button variant="primary" loading={wh.busy} onClick={wh.save}>Save</Button></>}>
        <form onSubmit={wh.save} className="grid gap-4 sm:grid-cols-3" noValidate>
          <Input label="Name" className="sm:col-span-2" {...wh.bind('name')} placeholder="Main Warehouse" />
          <Input label="Short code" {...wh.bind('code')} onChange={(e) => wh.setValues((x) => ({ ...x, code: e.target.value.toUpperCase() }))}
            placeholder="WH" hint="Used in references, e.g. WH/IN/0001" />
          <Textarea label="Address" className="sm:col-span-3" rows={2} {...wh.bind('address')} />
          {!wh.values.id && <p className="text-[13px] text-ink-3 sm:col-span-3">A default “Stock” location is created automatically.</p>}
        </form>
      </Modal>
      <Modal open={loc.open} onClose={() => loc.setOpen(false)} title={loc.values.id ? 'Rename location' : 'Add location'} width="max-w-md"
        footer={<><Button variant="ghost" onClick={() => loc.setOpen(false)}>Cancel</Button><Button variant="primary" loading={loc.busy} onClick={loc.save}>Save</Button></>}>
        <form onSubmit={loc.save} noValidate><Input label="Location name" {...loc.bind('name')} placeholder="Rack C, Cold Room, Production Floor" /></form>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ categories
export function Categories() {
  const { isManager } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/categories');
  const form = useModalForm({ name: '' },
    async (v) => { v.id ? await api.put(`/categories/${v.id}`, v) : await api.post('/categories', v); toast('Category saved'); }, reload);
  const remove = async (c) => {
    try { await api.del(`/categories/${c.id}`); toast(`${c.name} deleted`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <PageHeader title="Product categories" subtitle="Group products for filtering and reporting."
        actions={isManager && <Button variant="primary" icon={Plus} onClick={() => form.show()}>New category</Button>} />
      <div className="card max-w-2xl">
        {error ? <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div> : loading && !data ? <Spinner /> : data.length === 0 ? (
          <EmptyState icon={Tags} title="No categories yet" />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <Link to={`/products?category_id=${c.id}`} className="flex-1 font-medium hover:text-plum">{c.name}</Link>
                <span className="num text-[13.5px] text-ink-2">{c.product_count} products</span>
                {isManager && <>
                  <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Rename ${c.name}`} onClick={() => form.show({ id: c.id, name: c.name })} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${c.name}`} onClick={() => remove(c)} />
                </>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={form.open} onClose={() => form.setOpen(false)} title={form.values.id ? 'Rename category' : 'New category'} width="max-w-md"
        footer={<><Button variant="ghost" onClick={() => form.setOpen(false)}>Cancel</Button><Button variant="primary" loading={form.busy} onClick={form.save}>Save</Button></>}>
        <form onSubmit={form.save} noValidate><Input label="Name" {...form.bind('name')} /></form>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ profile
export function Profile() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [nameErr, setNameErr] = useState('');
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwErr, setPwErr] = useState({});
  const [busy, setBusy] = useState('');
  useEffect(() => setName(user.name), [user.name]);

  const saveName = async (e) => {
    e.preventDefault(); setBusy('name'); setNameErr('');
    try { const res = await api.patch('/auth/me', { name }); updateUser(res.user, res.token); toast('Profile updated'); }
    catch (err) { setNameErr(err.fields?.name || err.message); } finally { setBusy(''); }
  };
  const savePw = async (e) => {
    e.preventDefault(); setBusy('pw'); setPwErr({});
    try { await api.post('/auth/me/password', pw); setPw({ current_password: '', new_password: '' }); toast('Password changed'); }
    catch (err) { setPwErr({ ...err.fields, _form: err.message }); } finally { setBusy(''); }
  };

  return (
    <>
      <PageHeader title="My profile" />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-5">
          <div className="mb-5 flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-full bg-plum text-[20px] font-semibold text-white">
              {user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <div>
              <p className="text-[17px] font-semibold">{user.name}</p>
              <p className="text-[14px] text-ink-2">{user.email} · {user.role === 'manager' ? 'Inventory Manager' : 'Warehouse Staff'}</p>
            </div>
          </div>
          <form onSubmit={saveName} className="flex flex-wrap items-end gap-3" noValidate>
            <Input label="Display name" className="min-w-[240px] flex-1" value={name} onChange={(e) => setName(e.target.value)} error={nameErr} />
            <Button type="submit" loading={busy === 'name'} disabled={name === user.name}>Save name</Button>
          </form>
        </section>
        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Change password</h2>
          <form onSubmit={savePw} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Input label="Current password" type="password" autoComplete="current-password" value={pw.current_password}
              onChange={(e) => setPw({ ...pw, current_password: e.target.value })} error={pwErr.current_password} />
            <Input label="New password" type="password" autoComplete="new-password" value={pw.new_password}
              onChange={(e) => setPw({ ...pw, new_password: e.target.value })} error={pwErr.new_password}
              hint="8+ characters with upper and lowercase, a number and a symbol" />
            <div><Button type="submit" variant="primary" loading={busy === 'pw'}>Change password</Button></div>
          </form>
        </section>
      </div>
    </>
  );
}
