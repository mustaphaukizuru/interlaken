import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { portalApi } from '@/services/api';

interface RowResult {
  line: number;
  matricula: string;
  action: string;
  detail: string;
}

interface ImportResult {
  dry_run: boolean;
  total_rows: number;
  created_students: number;
  updated_students: number;
  created_parents: number;
  errors: number;
  rows: RowResult[];
}

const TEMPLATE_HEADERS =
  'matricula, nombre, apellidos, grado, grupo, email_alumno, loyverse_id, nombre_padre, email_padre, telefono_padre';

/**
 * CSV import with mandatory dry-run preview: choosing a file always runs a
 * server-side simulation first; the real import only happens after the admin
 * reviews the per-row results and confirms.
 */
export function ImportStudentsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const run = useMutation({
    mutationFn: async ({ f, dryRun }: { f: File; dryRun: boolean }) =>
      (await portalApi.importStudents(f, dryRun)).data as ImportResult,
    onSuccess: (data) => {
      if (data.dry_run) {
        setPreview(data);
      } else {
        toast.success(
          `Importación completa: ${data.created_students} creados, ` +
          `${data.updated_students} actualizados, ${data.errors} errores.`,
        );
        void queryClient.invalidateQueries({ queryKey: ['admin-students'] });
        reset();
        onClose();
      }
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      toast.error(detail ?? 'No se pudo procesar el archivo.');
    },
  });

  const onPick = (f: File | null) => {
    setPreview(null);
    setFile(f);
    if (f) run.mutate({ f, dryRun: true });
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Importar alumnos (CSV)" maxWidth={560}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Encabezados esperados: <code className="text-xs">{TEMPLATE_HEADERS}</code>.
          Requeridos: matricula, nombre, apellidos, grado. Se mostrará una
          vista previa antes de escribir nada.
        </p>

        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-ink/25 px-4 py-3 text-sm text-ink hover:border-green">
          <FileUp size={16} aria-hidden="true" className="text-green-dark" />
          {file ? file.name : 'Elegir archivo .csv'}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>

        {run.isPending && <p className="text-sm text-muted">Procesando…</p>}

        {preview && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-ink">
              Vista previa: {preview.created_students} por crear ·{' '}
              {preview.updated_students} por actualizar ·{' '}
              <span className={preview.errors ? 'text-coral-dark' : ''}>
                {preview.errors} errores
              </span>
            </p>
            <div className="max-h-56 overflow-auto rounded-lg border border-ink/10">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-cream-2">
                  <tr>
                    <th className="px-2 py-1.5 font-semibold">Línea</th>
                    <th className="px-2 py-1.5 font-semibold">Matrícula</th>
                    <th className="px-2 py-1.5 font-semibold">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-t border-ink/5">
                      <td className="px-2 py-1.5">{r.line}</td>
                      <td className="px-2 py-1.5">{r.matricula}</td>
                      <td className={`px-2 py-1.5 ${r.action === 'error' ? 'text-coral-dark' : ''}`}>
                        {r.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="btn-pink w-full"
              disabled={run.isPending || !file}
              onClick={() => file && run.mutate({ f: file, dryRun: false })}
            >
              <Upload size={16} aria-hidden="true" />
              Confirmar importación{preview.errors ? ' (las filas con error se omiten)' : ''}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
