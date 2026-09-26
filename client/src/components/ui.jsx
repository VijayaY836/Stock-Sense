import { forwardRef, useEffect, useId, useRef } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { STATUS_META, TYPE_META } from '../lib/format.js';

// ------------------------------------------------------------------ buttons
const VARIANTS = {
  primary: 'bg-plum text-white hover:bg-plum-dark border border-plum-dark/40 shadow-[inset_0_1px_0_rgba(255,255,255,.15)]',
  secondary: 'bg-white text-ink border border-line hover:border-ink-3/60 hover:bg-canvas',
  ghost: 'text-ink-2 hover:bg-canvas hover:text-ink border border-transparent',
  danger: 'bg-white text-brick border border-brick/30 hover:bg-brick-soft',
  teal: 'bg-teal text-white hover:brightness-95 border border-teal',
};

export function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className = '', ...props }) {
  const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-9.5 px-4 text-[14px] gap-2' };
  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ form fields
export function Field({ label, error, hint, children, className = '', htmlFor }) {
  return (
    <div className={className}>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <p className="mt-1 text-[13px] text-brick" role="alert">{error}</p>
        : hint ? <p className="mt-1 text-[12.5px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ label, error, hint, className = '', ...props }, ref) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={id}>
      <input id={id} ref={ref} className={`input ${error ? 'input-error' : ''}`} aria-invalid={!!error} {...props} />
    </Field>
  );
});

export function Select({ label, error, hint, className = '', children, ...props }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={id}>
      <select id={id} className={`input pr-8 ${error ? 'input-error' : ''}`} aria-invalid={!!error} {...props}>{children}</select>
    </Field>
  );
}

export function Textarea({ label, error, className = '', ...props }) {
  const id = useId();
  return (
    <Field label={label} error={error} className={className} htmlFor={id}>
      <textarea id={id} className={`input min-h-20 ${error ? 'input-error' : ''}`} {...props} />
    </Field>
  );
}

// ------------------------------------------------------------------ badges
export function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ring-1 ring-inset ${m.cls}`}>{m.label}</span>;
}

const TONES = {
  teal: 'text-teal bg-teal-soft', brick: 'text-brick bg-brick-soft', sky: 'text-sky bg-sky-soft',
  amber: 'text-amber bg-amber-soft', plum: 'text-plum bg-plum-soft', ink: 'text-ink-2 bg-canvas',
};
export function Tag({ tone = 'ink', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium ${TONES[tone]} ${className}`}>{children}</span>;
}
export const TypeTag = ({ type }) => <Tag tone={TYPE_META[type].tone}>{TYPE_META[type].label}</Tag>;

/** "Vendors → WH/Stock": every operation is a move between two places */
export function Route({ from, to, className = '' }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-ink-2 ${className}`}>
      <span className="truncate">{from}</span>
      <ArrowRight size={13} className="shrink-0 text-ink-3" />
      <span className="truncate">{to}</span>
    </span>
  );
}

// ------------------------------------------------------------------ layout bits
export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[14.5px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-3" role="status">
      <Loader2 size={18} className="animate-spin" /> {label}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-brick/25 bg-brick-soft px-4 py-3 text-[14px] text-brick" role="alert">
      <span>{error.message || String(error)}</span>
      {onRetry && <Button size="sm" variant="danger" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && <div className="mb-3 grid size-11 place-items-center rounded-full bg-plum-soft text-plum"><Icon size={20} /></div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[14px] text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-ink-2">
      <span className="num">{from}–{to} of {total}</span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ modal
export function Modal({ open, title, onClose, children, footer, width = 'max-w-lg' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,select,textarea,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`w-full ${width} max-h-[92vh] overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:rounded-xl`}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-canvas hover:text-ink" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas/50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Segmented control used for filters */
export function Segmented({ value, onChange, options, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-white p-0.5">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${value === o.value ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
