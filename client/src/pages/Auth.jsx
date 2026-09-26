import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Check, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { Button, Input } from '../components/ui.jsx';

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="size-9" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#714B67" />
            <path d="M8 11.5 16 7l8 4.5v9L16 25l-8-4.5z M8 11.5 16 16l8-4.5M16 16v9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
          </svg>
          <span className="text-[20px] font-semibold">StockSense</span>
        </div>
        <div>
          {/* The whole product in one picture: stock moves between places */}
          <svg viewBox="0 0 460 150" className="mb-10 w-full max-w-[460px]" aria-hidden="true">
            <defs>
              <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="#c69bbc" /></marker>
            </defs>
            {[['Vendors', 10], ['Warehouse', 170], ['Customers', 330]].map(([t, x]) => (
              <g key={t}>
                <rect x={x} y="40" width="120" height="56" rx="10" fill={t === 'Warehouse' ? '#714B67' : 'none'} stroke={t === 'Warehouse' ? '#714B67' : 'rgba(255,255,255,.3)'} />
                <text x={x + 60} y="73" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="500">{t}</text>
              </g>
            ))}
            <path d="M132 68h34M292 68h34" stroke="#c69bbc" strokeWidth="2" strokeDasharray="6 6" markerEnd="url(#ah)" style={{ animation: 'flow 1.2s linear infinite' }} />
            <path d="M205 98c0 30 50 30 50 0" stroke="rgba(255,255,255,.45)" strokeWidth="1.6" fill="none" markerEnd="url(#ah)" />
            <text x="149" y="30" textAnchor="middle" fill="rgba(255,255,255,.6)" fontSize="12">Receipts</text>
            <text x="309" y="30" textAnchor="middle" fill="rgba(255,255,255,.6)" fontSize="12">Deliveries</text>
            <text x="230" y="146" textAnchor="middle" fill="rgba(255,255,255,.6)" fontSize="12">Transfers and counts</text>
          </svg>
          <h2 className="max-w-md text-[32px] font-semibold leading-[1.15] tracking-[-0.015em]">
            Every unit, every location, every move on record.
          </h2>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-white/65">
            Replace registers and spreadsheets with one ledger your whole warehouse team works from.
          </p>
        </div>
        <p className="text-[13px] text-white/40">Built for inventory managers and warehouse staff.</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">
          <h1 className="text-[28px] font-semibold tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-ink-2">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} {...props} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 top-[34px] rounded p-1 text-ink-3 hover:text-ink">
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

const RULES = [
  ['8+ characters', (p) => p.length >= 8],
  ['Upper and lowercase', (p) => /[a-z]/.test(p) && /[A-Z]/.test(p)],
  ['A number', (p) => /\d/.test(p)],
  ['A special character', (p) => /[^A-Za-z0-9]/.test(p)],
];
function PasswordRules({ value }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
      {RULES.map(([label, ok]) => (
        <li key={label} className={`flex items-center gap-1.5 ${ok(value) ? 'text-teal' : 'text-ink-3'}`}>
          <Check size={13} strokeWidth={ok(value) ? 3 : 2} /> {label}
        </li>
      ))}
    </ul>
  );
}

/** Small helper so every auth form handles loading + field errors the same way */
function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({
    name, value: values[name],
    onChange: (e) => { setValues((v) => ({ ...v, [name]: e.target.value })); setErrors((er) => ({ ...er, [name]: undefined })); },
    error: errors[name],
  });
  const run = async (fn) => {
    setBusy(true); setFormError(''); setErrors({});
    try { await fn(); } catch (err) { setErrors(err.fields || {}); setFormError(err.message); } finally { setBusy(false); }
  };
  return { values, setValues, bind, run, busy, formError, setErrors };
}

function FormError({ message }) {
  return message ? <p className="rounded-md bg-brick-soft px-3 py-2.5 text-[14px] text-brick" role="alert">{message}</p> : null;
}

export function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const f = useForm({ email: '', password: '' });
  if (user) return <Navigate to="/dashboard" replace />;

  const submit = (e) => {
    e.preventDefault();
    f.run(async () => {
      const res = await api.post('/auth/login', f.values);
      signIn(res);
      navigate(location.state?.from || res.redirect_to || '/dashboard', { replace: true });
    });
  };
  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Pick up where your team left off.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={f.formError} />
        <Input label="Email" type="email" autoComplete="email" autoFocus {...f.bind('email')} />
        <PasswordInput label="Password" autoComplete="current-password" {...f.bind('password')} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[14px] font-medium text-plum hover:underline">Forgot password?</Link>
        </div>
        <Button variant="primary" type="submit" loading={f.busy} className="w-full">Sign in</Button>
      </form>
      <p className="mt-6 text-center text-[14px] text-ink-2">
        New to StockSense? <Link to="/signup" className="font-medium text-plum hover:underline">Create an account</Link>
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-line p-3.5 text-[13px] text-ink-2">
        <p className="font-medium text-ink">Demo accounts (password Demo@1234)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[['manager@stocksense.dev', 'Manager'], ['staff@stocksense.dev', 'Staff']].map(([email, label]) => (
            <button key={email} type="button" className="rounded border border-line bg-white px-2.5 py-1 hover:border-plum hover:text-plum"
              onClick={() => f.setValues({ email, password: 'Demo@1234' })}>{label}</button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}

export function Signup() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const f = useForm({ name: '', email: '', password: '', confirm: '', role: 'manager' });
  if (user) return <Navigate to="/dashboard" replace />;

  const submit = (e) => {
    e.preventDefault();
    if (f.values.password !== f.values.confirm) { f.setErrors({ confirm: 'Passwords do not match' }); return; }
    f.run(async () => {
      const { confirm, ...body } = f.values;
      const res = await api.post('/auth/signup', body);
      signIn(res);
      toast(`Welcome, ${res.user.name.split(' ')[0]}`);
      navigate('/dashboard', { replace: true });
    });
  };
  return (
    <AuthShell title="Create your account" subtitle="Takes under a minute.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={f.formError} />
        <Input label="Full name" autoComplete="name" autoFocus {...f.bind('name')} />
        <Input label="Work email" type="email" autoComplete="email" {...f.bind('email')} />
        <fieldset>
          <legend className="label">Your role</legend>
          <div className="grid grid-cols-2 gap-2">
            {[['manager', 'Inventory Manager', 'Products, rules, approvals'], ['staff', 'Warehouse Staff', 'Receive, pick, move, count']].map(([v, t, d]) => (
              <label key={v} className={`cursor-pointer rounded-lg border p-3 transition-colors ${f.values.role === v ? 'border-plum bg-plum-soft' : 'border-line bg-white hover:border-ink-3/50'}`}>
                <input type="radio" name="role" value={v} checked={f.values.role === v} className="sr-only"
                  onChange={() => f.setValues((x) => ({ ...x, role: v }))} />
                <span className="block text-[14px] font-medium">{t}</span>
                <span className="block text-[12.5px] text-ink-2">{d}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <PasswordInput label="Password" autoComplete="new-password" {...f.bind('password')} />
          <PasswordRules value={f.values.password} />
        </div>
        <PasswordInput label="Confirm password" autoComplete="new-password" {...f.bind('confirm')} />
        <Button variant="primary" type="submit" loading={f.busy} className="w-full">Create account</Button>
      </form>
      <p className="mt-6 text-center text-[14px] text-ink-2">
        Already have an account? <Link to="/login" className="font-medium text-plum hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('email'); // email -> code -> password
  const [resetToken, setResetToken] = useState('');
  const f = useForm({ email: '', otp: '', password: '', confirm: '' });

  const sendCode = (e) => {
    e?.preventDefault();
    f.run(async () => {
      const res = await api.post('/auth/forgot-password', { email: f.values.email });
      toast(res.message);
      setStep('code');
    });
  };
  const verify = (e) => {
    e.preventDefault();
    f.run(async () => {
      const res = await api.post('/auth/verify-otp', { email: f.values.email, otp: f.values.otp });
      setResetToken(res.reset_token);
      setStep('password');
    });
  };
  const reset = (e) => {
    e.preventDefault();
    if (f.values.password !== f.values.confirm) { f.setErrors({ confirm: 'Passwords do not match' }); return; }
    f.run(async () => {
      const res = await api.post('/auth/reset-password', { reset_token: resetToken, password: f.values.password });
      toast(res.message);
      navigate('/login');
    });
  };

  const copy = {
    email: ['Reset your password', 'We’ll send a 6-digit code to your email.'],
    code: ['Enter the code', `Sent to ${f.values.email}. It expires in 10 minutes.`],
    password: ['Choose a new password', 'You’ll use it the next time you sign in.'],
  }[step];

  return (
    <AuthShell title={copy[0]} subtitle={copy[1]}>
      <ol className="mb-6 flex gap-1.5" aria-label="Progress">
        {['email', 'code', 'password'].map((s, i) => (
          <li key={s} className={`h-1 flex-1 rounded-full ${['email', 'code', 'password'].indexOf(step) >= i ? 'bg-plum' : 'bg-line'}`} />
        ))}
      </ol>
      <FormError message={f.formError} />
      {step === 'email' && (
        <form onSubmit={sendCode} className="mt-4 space-y-4" noValidate>
          <Input label="Email" type="email" autoFocus autoComplete="email" {...f.bind('email')} />
          <Button variant="primary" type="submit" loading={f.busy} className="w-full">Send code</Button>
        </form>
      )}
      {step === 'code' && (
        <form onSubmit={verify} className="mt-4 space-y-4" noValidate>
          <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
            className="[&_input]:text-center [&_input]:text-[22px] [&_input]:tracking-[0.5em]" {...f.bind('otp')}
            hint="No email set up? The code is printed in the API terminal." />
          <Button variant="primary" type="submit" loading={f.busy} className="w-full">Verify code</Button>
          <button type="button" onClick={sendCode} className="w-full text-[14px] font-medium text-plum hover:underline">Send a new code</button>
        </form>
      )}
      {step === 'password' && (
        <form onSubmit={reset} className="mt-4 space-y-4" noValidate>
          <div>
            <PasswordInput label="New password" autoFocus autoComplete="new-password" {...f.bind('password')} />
            <PasswordRules value={f.values.password} />
          </div>
          <PasswordInput label="Confirm password" autoComplete="new-password" {...f.bind('confirm')} />
          <Button variant="primary" type="submit" loading={f.busy} className="w-full">Update password</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> Back to sign in
      </Link>
    </AuthShell>
  );
}
