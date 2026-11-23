/**
 * «¿Ya empezó su ficha? Reciba un enlace nuevo»: POST register/resume/ with
 * the email. The answer is the same whether or not a draft exists (the
 * server never says), so the screen always shows the same neutral message.
 */
import { useId, useState, type FormEvent } from 'react';
import { clsx } from 'clsx';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { apiFieldErrors } from '@/lib/apiErrors';
import { fichaApi } from './api';
import type { FichaCopy } from './copy';

export function ResumeForm({ copy, startOpen = false, className }: { copy: FichaCopy; startOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(startOpen);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const emailId = `${id}-email`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fichaApi.resume(email.trim());
      setDone(true);
    } catch (err) {
      // A malformed email is the only answer that differs (400 {email}).
      const field = apiFieldErrors(err).email;
      setError(field || copy.t('resumeError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={clsx('text-left', className)}>
      {!startOpen ? (
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center text-base font-semibold text-purple underline underline-offset-4 hover:text-purple-mid focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded-sm"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((v) => !v)}
        >
          {copy.t('resumeToggle')}
        </button>
      ) : null}
      {open ? <div id={`${id}-panel`} className={clsx(!startOpen && 'mt-3')}>
        {done ? (
          <p role="status" className="flex items-start gap-2 rounded-sm bg-success-bg px-3 py-2.5 text-base text-ink">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <span>{copy.t('resumeDone')}</span>
          </p>
        ) : (
          <form noValidate onSubmit={submit} className="space-y-3">
            <p className="text-base text-muted">{copy.t('resumeText')}</p>
            <div>
              <label htmlFor={emailId} className="mb-1.5 block text-sm font-semibold text-ink">{copy.t('resumeEmail')}</label>
              <input
                id={emailId}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                className={clsx('input-field text-base', error && 'border-coral-400')}
                value={email}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${emailId}-error` : undefined}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
              />
              {error ? <p id={`${emailId}-error`} className="mt-1.5 text-sm font-medium text-danger">{error}</p> : null}
            </div>
            <Button type="submit" variant="secondary" loading={busy} disabled={!email.trim()} className="w-full sm:w-auto">
              {copy.t('resumeSubmit')}
            </Button>
          </form>
        )}
      </div> : null}
    </div>
  );
}
