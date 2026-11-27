import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Receipt } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { contentApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import type { SiteSettings } from '@/types/content';

/** One address per line (commas also work): what the school types, as a list. */
export const parseEmails = (text: string) =>
  text.split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Ajustes → «Solicitudes de factura» (owner 2026-11-26): who receives the
 * website's «Solicitud de facturación» (facturas@ and vvega@). Admin only and
 * never public; saved on its own and written to Auditoría. An empty list
 * falls back to the school's billing address on the server.
 */
export function BillingEmailsCard({ value, loaded }: { value: string[] | undefined; loaded: boolean }) {
  const qc = useQueryClient();
  const saved = (value ?? []).join('\n');
  const [text, setText] = useState(saved);
  const [error, setError] = useState('');
  // The saved list arrives after the first render (and after each save): take
  // it when it changes, adjusting state during render (no effect round trip).
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setText(saved);
  }

  const save = useMutation({
    mutationFn: (emails: string[]) => contentApi.adminUpdateSettings({ billing_emails: emails }),
    onSuccess: (res) => {
      const next = (res?.data as Partial<SiteSettings> | undefined)?.billing_emails ?? parseEmails(text);
      qc.setQueryData<Partial<SiteSettings>>(['admin-site-settings'], (prev) => ({ ...prev, billing_emails: next }));
      void qc.invalidateQueries({ queryKey: ['admin-site-settings'] });
      setError('');
      toast.success(next.length === 1
        ? 'Listo: las solicitudes de factura llegan a 1 correo.'
        : `Listo: las solicitudes de factura llegan a ${next.length} correos.`);
    },
    onError: (err) => {
      const fields = apiFieldErrors(err);
      setError(fields.billing_emails || fields.detail || 'No se pudo guardar.');
    },
  });

  const dirty = parseEmails(text).join('\n') !== parseEmails(saved).join('\n');

  return (
    <Card title="Solicitudes de factura">
      <div className="space-y-3 text-sm">
        <p className="text-subtle">
          Cada solicitud de facturación que llega del sitio se envía a todos estos correos. La familia recibe su
          confirmación cuando alguien marca la solicitud como «Atendido» en Mensajes.
        </p>
        <label htmlFor="billing-emails" className="flex items-center gap-1.5 font-semibold text-ink">
          <Receipt className="h-4 w-4 text-purple" aria-hidden="true" /> Correos que reciben las solicitudes de factura
        </label>
        <textarea
          id="billing-emails"
          rows={3}
          value={text}
          disabled={!loaded}
          onChange={(e) => { setText(e.target.value); setError(''); }}
          aria-describedby="billing-emails-hint"
          aria-invalid={error ? true : undefined}
          className="w-full rounded-md border border-line bg-white p-3 font-mono text-sm text-ink focus:border-purple focus:outline-none focus:ring-2 focus:ring-purple/30"
          placeholder={'facturas@interlaken.com.mx\nvvega@interlaken.com.mx'}
        />
        <p id="billing-emails-hint" className="text-xs text-subtle">Un correo por línea, hasta 5. Si la deja vacía, llegan al correo de facturación del colegio.</p>
        {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button size="sm" disabled={!loaded || !dirty} loading={save.isPending} onClick={() => save.mutate(parseEmails(text))}>
            Guardar correos
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default BillingEmailsCard;
