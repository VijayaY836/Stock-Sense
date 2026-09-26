import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, RefreshCcw, PackagePlus, Truck, ArrowLeftRight, ClipboardCheck,
  History, Warehouse, Tags, UserRound, LogOut, Search, Menu, X, ChevronUp,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { useDebounced } from '../lib/hooks.js';
import { StatusBadge, TypeTag } from './ui.jsx';
import { fmtQty } from '../lib/format.js';

const NAV = [
  { items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { title: 'Products', items: [
    { to: '/products', label: 'Products', icon: Package },
    { to: '/reordering', label: 'Reordering rules', icon: RefreshCcw },
  ] },
  { title: 'Operations', items: [
    { to: '/operations/receipts', label: 'Receipts', icon: PackagePlus },
    { to: '/operations/deliveries', label: 'Delivery orders', icon: Truck },
    { to: '/operations/transfers', label: 'Internal transfers', icon: ArrowLeftRight },
    { to: '/operations/adjustments', label: 'Inventory adjustments', icon: ClipboardCheck },
    { to: '/moves', label: 'Move history', icon: History },
  ] },
  { title: 'Settings', items: [
    { to: '/settings/warehouses', label: 'Warehouses', icon: Warehouse },
    { to: '/settings/categories', label: 'Categories', icon: Tags },
  ] },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#714B67" />
        <path d="M8 11.5 16 7l8 4.5v9L16 25l-8-4.5z M8 11.5 16 16l8-4.5M16 16v9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <span className="text-[18px] font-semibold tracking-[-0.01em] text-white">StockSense</span>
    </div>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const initials = user?.name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-white/10 bg-[#2a3244] py-1 shadow-xl">
          <button className="flex w-full items-center gap-2.5 px-3 py-2 text-[14px] text-white/85 hover:bg-white/8"
            onClick={() => { setOpen(false); navigate('/profile'); }}>
            <UserRound size={16} /> My profile
          </button>
          <button className="flex w-full items-center gap-2.5 px-3 py-2 text-[14px] text-white/85 hover:bg-white/8"
            onClick={() => { logout(); navigate('/login'); }}>
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/6">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-plum text-[13px] font-semibold text-white">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-white">{user?.name}</span>
          <span className="block text-[12.5px] text-white/55">{user?.role === 'manager' ? 'Inventory Manager' : 'Warehouse Staff'}</span>
        </span>
        <ChevronUp size={16} className={`text-white/50 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
    </div>
  );
}

function Sidebar({ onNavigate }) {
  return (
    <div className="flex h-full flex-col bg-ink px-3 pb-3 pt-5">
      <Logo />
      <nav className="mt-7 flex-1 space-y-5 overflow-y-auto" aria-label="Main">
        {NAV.map((group, i) => (
          <div key={i}>
            {group.title && <p className="mb-1.5 px-2.5 text-[12px] font-medium text-white/40">{group.title}</p>}
            <ul className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink to={to} onClick={onNavigate}
                    className={({ isActive }) =>
                      `relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] transition-colors ${
                        isActive ? 'bg-white/10 font-medium text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'}`}>
                    {({ isActive }) => (<>
                      {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#c69bbc]" />}
                      <Icon size={17} strokeWidth={isActive ? 2.3 : 1.9} /> {label}
                    </>)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 pt-3"><ProfileMenu /></div>
    </div>
  );
}

/** Press "/" anywhere to search products by SKU/name and operations by reference */
function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState({ products: [], operations: [] });
  const [active, setActive] = useState(0);
  const debounced = useDebounced(term.trim(), 200);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (debounced.length < 2) { setResults({ products: [], operations: [] }); return; }
    let cancel = false;
    Promise.all([
      api.get('/products', { search: debounced, pageSize: 5 }),
      api.get('/operations', { search: debounced, pageSize: 5 }),
    ]).then(([p, o]) => { if (!cancel) { setResults({ products: p.items, operations: o.items }); setActive(0); } }).catch(() => {});
    return () => { cancel = true; };
  }, [debounced]);

  const flat = [
    ...results.products.map((p) => ({ key: `p${p.id}`, to: `/products/${p.id}`, p })),
    ...results.operations.map((o) => ({ key: `o${o.id}`, to: `/operations/${o.id}`, o })),
  ];
  const go = (item) => { navigate(item.to); setTerm(''); setOpen(false); inputRef.current?.blur(); };

  return (
    <div className="relative w-full max-w-md">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
      <input ref={inputRef} value={term} placeholder="Search SKU, product or reference"
        className="input h-9.5 pl-9 pr-9" aria-label="Search"
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && flat[active]) go(flat[active]);
          if (e.key === 'Escape') inputRef.current?.blur();
        }} />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-canvas px-1.5 text-[11px] text-ink-3">/</kbd>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-line bg-white shadow-xl">
          {flat.length === 0 && <p className="px-4 py-3 text-[14px] text-ink-3">No matches for “{debounced}”</p>}
          {flat.map((item, i) => (
            <button key={item.key} onMouseDown={() => go(item)} onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[14px] ${i === active ? 'bg-plum-soft' : ''}`}>
              {item.p ? (<>
                <span className="min-w-0"><span className="font-medium">{item.p.name}</span> <span className="text-ink-3">{item.p.sku}</span></span>
                <span className="num shrink-0 text-ink-2">{fmtQty(item.p.on_hand)} {item.p.uom}</span>
              </>) : (<>
                <span className="flex min-w-0 items-center gap-2"><span className="num font-medium">{item.o.reference}</span><TypeTag type={item.o.type} /></span>
                <StatusBadge status={item.o.status} />
              </>)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_1fr] print:block">
      <aside className="sticky top-0 hidden h-screen lg:block print:hidden"><Sidebar /></aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[264px]"><Sidebar onNavigate={() => setDrawer(false)} /></div>
          <button className="absolute left-[272px] top-4 rounded-full bg-white p-2" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
      )}

      <div className="min-w-0">
        <header className="print:hidden sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:px-8">
          <button className="rounded-md p-2 text-ink-2 hover:bg-white lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
          <GlobalSearch />
        </header>
        <main className="mx-auto max-w-[1280px] px-4 py-7 sm:px-8"><Outlet /></main>
      </div>
    </div>
  );
}
