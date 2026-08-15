import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Consequence statement in es-MX, e.g. "Esto eliminará la reserva de Ana López." */
  message: ReactNode;
  /** Confirm button label (verb + object). */
  confirmLabel: string;
  /**
   * When set, the user must type this exact word to enable the confirm button.
   * Use for irreversible operations (devoluciones, anular recarga).
   */
  requireText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Optional extra field (e.g. a reason input) rendered above the actions. */
  children?: ReactNode;
}

/**
 * Destructive-action confirmation. Always states the consequence; for
 * irreversible operations, gates confirmation behind a type-to-confirm field.
 * The confirm button uses the error (coral) token, never the accent.
 */
export function ConfirmDialog({ open, title, onClose, ...body }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {/* Modal mounts children only while open, so the type-to-confirm field
          resets by unmount on close — no reset effect. */}
      <ConfirmDialogBody onClose={onClose} {...body} />
    </Modal>
  );
}

function ConfirmDialogBody({
  message,
  confirmLabel,
  requireText,
  loading,
  onConfirm,
  onClose,
  children,
}: Omit<ConfirmDialogProps, 'open' | 'title'>) {
  const [typed, setTyped] = useState('');
  const matched = !requireText || typed.trim() === requireText;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-coral-50 text-coral-600">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="text-sm text-muted">{message}</div>
      </div>

      {children}

      {requireText && (
        <Input
          label={`Escriba «${requireText}» para confirmar`}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          placeholder={requireText}
        />
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={loading}
          disabled={!matched}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export default ConfirmDialog;
