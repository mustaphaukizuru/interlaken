import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Coffee, RefreshCw, Search, Download, ChevronRight, ScrollText,
  Scale, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cafeteriaApi, downloadBlob } from '@/services/api';
import type { CafeteriaBalance, TopUpLogEntry, ReconcileRow } from '@/types';

type Tab = 'roster' | 'deposits' | 'reconcile' | 'low';

const TABS: { key: Tab; label: string; icon: typeof Coffee }[] = [
  { key: 'roster',    label: 'Saldos',         icon: Coffee },
  { key: 'deposits',  label: 'Depósitos',      icon: ScrollText },
  { key: 'reconcile', label: 'Reconciliación', icon: Scale },
  { key: 'low',       label: 'Saldo bajo',     icon: AlertTriangle },
];

const fmtDate = (d: string | null) =>
  d ? format(new Date(d), 'd MMM yyyy, HH:mm', { locale: es }) : '—';

export default function AdminCafeteria() {
  const [tab, setTab] = useState<Tab>('roster');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cafetería — Admin</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Saldos, depósitos, ajustes, devoluciones y reconciliación.
          </p>
        </div>
        <SchoolExportButtons />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'roster' && <RosterTab />}
      {tab === 'deposits' && <DepositsTab />}
      {tab === 'reconcile' && <ReconcileTab />}
      {tab === 'low' && <LowBalanceTab />}
    </div>
  );
}

function SchoolExportButtons() {
  const doExport = async (fmt: 'csv' | 'pdf') => {
    try {
      const { data } = await cafeteriaApi.exportSchool(fmt);
      downloadBlob(data, `saldos_cafeteria_escuela.${fmt}`);
    } catch {
      toast.error('No se pudo generar el archivo.');
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => doExport('csv')}>
        <Download className="w-3.5 h-3.5" /> CSV
      </Button>
      <Button size="sm" variant="secondary" onClick={() => doExport('pdf')}>
        <Download className="w-3.5 h-3.5" /> PDF
      </Button>
    </div>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────
function RosterTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: balances, isLoading } = useQuery<CafeteriaBalance[]>({
    queryKey: ['admin-cafeteria-balances'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getAllBalances();
      return data.results ?? data;
    },
  });

  const syncAll = useMutation({
    mutationFn: () => cafeteriaApi.syncAll(),
    onSuccess: () => {
      toast.success('Sincronización completada.');
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const syncOne = useMutation({
    mutationFn: (studentId: number) => cafeteriaApi.syncBalance(studentId),
    onSuccess: () => {
      toast.success('Saldo sincronizado.');
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const filtered = balances?.filter((b) =>
    !search ||
    b.student.user.full_name.toLowerCase().includes(search.toLowerCase()) ||
    b.student.student_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input-field pl-9"
            placeholder="Buscar alumno o matrícula…"
            aria-label="Buscar alumno o matrícula"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="secondary" size="sm" loading={syncAll.isPending} onClick={() => syncAll.mutate()}>
          <RefreshCw className="w-3.5 h-3.5" /> Sincronizar todos
        </Button>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !filtered?.length ? (
        <EmptyState icon={Coffee} title="Sin saldos registrados" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-4">Alumno</th>
                <th className="py-2 pr-4">Matrícula</th>
                <th className="py-2 pr-4 text-right">Saldo</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2 pr-4">Últ. sinc.</th>
                <th className="py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((b) => {
                const isLow = parseFloat(b.balance) <= parseFloat(b.low_balance_threshold ?? '50');
                return (
                  <tr key={b.id} className="hover:bg-slate-50/50">
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      <Link to={`/admin/cafeteria/${b.student.id}`} className="hover:text-brand-700">
                        {b.student.user.full_name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-500">{b.student.student_id}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-slate-900">${parseFloat(b.balance).toFixed(2)}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={isLow ? 'warning' : 'success'}>{isLow ? 'Saldo bajo' : 'Normal'}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-slate-500 whitespace-nowrap">{fmtDate(b.last_synced)}</td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Sincronizar saldo de ${b.student.user.full_name}`}
                          title="Sincronizar saldo"
                          onClick={() => syncOne.mutate(b.student.id)}
                          loading={syncOne.isPending}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                        <Link
                          to={`/admin/cafeteria/${b.student.id}`}
                          className="inline-flex items-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                          title="Ver detalle"
                          aria-label={`Ver detalle de ${b.student.user.full_name}`}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Deposits log ─────────────────────────────────────────────────────────────
function DepositsTab() {
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery<TopUpLogEntry[]>({
    queryKey: ['admin-cafeteria-topups', status],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getTopUpLog({ status: status || undefined });
      return data.results ?? data;
    },
  });

  const statusVariant = (s: string) =>
    s === 'completed' ? 'success' : s === 'failed' ? 'error' : 'warning';

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <label htmlFor="deposit-status" className="text-sm text-slate-500">Estado:</label>
        <select
          id="deposit-status"
          className="input-field w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="pending">Pendiente</option>
          <option value="completed">Completado</option>
          <option value="failed">Fallido</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !data?.length ? (
        <EmptyState icon={ScrollText} title="Sin depósitos registrados" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Alumno</th>
                <th className="py-2 pr-4 text-right">Monto</th>
                <th className="py-2 pr-4">Método</th>
                <th className="py-2 pr-4">Pasarela</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2">Referencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/50">
                  <td className="py-3 pr-4 whitespace-nowrap text-slate-500">{fmtDate(d.created_at)}</td>
                  <td className="py-3 pr-4 font-medium text-slate-900">
                    <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">
                      {d.student_name}
                    </Link>
                    <span className="block text-xs text-slate-400">{d.student_code}</span>
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold text-slate-900">${parseFloat(d.amount).toFixed(2)}</td>
                  <td className="py-3 pr-4 text-slate-600">{d.method_display}</td>
                  <td className="py-3 pr-4 text-slate-500">{d.gateway || '—'}</td>
                  <td className="py-3 pr-4"><Badge variant={statusVariant(d.status)}>{d.status_display}</Badge></td>
                  <td className="py-3 text-slate-400 text-xs font-mono">{d.gateway_tx_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Reconciliation ───────────────────────────────────────────────────────────
function ReconcileTab() {
  const [onlyDrift, setOnlyDrift] = useState(true);

  const { data, isLoading, isFetching, refetch } = useQuery<{
    count: number; drift_count: number; results: ReconcileRow[];
  }>({
    queryKey: ['admin-cafeteria-reconcile', onlyDrift],
    queryFn: async () => (await cafeteriaApi.reconcile(onlyDrift)).data,
    enabled: false,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-slate-500">
          Compara el saldo local contra los puntos de Loyverse y detecta diferencias.
        </p>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={onlyDrift} onChange={(e) => setOnlyDrift(e.target.checked)} />
            Solo diferencias
          </label>
          <Button size="sm" loading={isFetching} onClick={() => refetch()}>
            <Scale className="w-3.5 h-3.5" /> Reconciliar
          </Button>
        </div>
      </div>

      {isLoading || isFetching ? (
        <LoadingSpinner />
      ) : !data ? (
        <EmptyState icon={Scale} title="Ejecuta la reconciliación" description="Presiona «Reconciliar» para comparar con Loyverse." />
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-600">
            {data.drift_count > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <AlertTriangle className="w-4 h-4" /> {data.drift_count} diferencia(s) de {data.count} revisadas.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Todo en orden ({data.count} revisadas).
              </span>
            )}
          </div>
          {!data.results.length ? (
            <EmptyState icon={CheckCircle2} title="Sin diferencias" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                    <th className="py-2 pr-4">Alumno</th>
                    <th className="py-2 pr-4 text-right">Saldo local</th>
                    <th className="py-2 pr-4 text-right">Loyverse</th>
                    <th className="py-2 pr-4 text-right">Diferencia</th>
                    <th className="py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.results.map((r) => (
                    <tr key={r.student_id} className="hover:bg-slate-50/50">
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        <Link to={`/admin/cafeteria/${r.student_id}`} className="hover:text-brand-700">{r.student_name}</Link>
                        <span className="block text-xs text-slate-400">{r.student_code}</span>
                      </td>
                      <td className="py-3 pr-4 text-right text-slate-900">${parseFloat(r.local_balance).toFixed(2)}</td>
                      <td className="py-3 pr-4 text-right text-slate-600">
                        {r.loyverse_balance !== null ? `$${parseFloat(r.loyverse_balance).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium text-slate-900">
                        {r.drift !== null ? `$${parseFloat(r.drift).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3">
                        {r.error ? (
                          <Badge variant="error">Error</Badge>
                        ) : r.in_sync ? (
                          <Badge variant="success">En orden</Badge>
                        ) : (
                          <Badge variant="warning">Diferencia</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Low balance ──────────────────────────────────────────────────────────────
function LowBalanceTab() {
  const { data, isLoading } = useQuery<CafeteriaBalance[]>({
    queryKey: ['admin-cafeteria-low-balance'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getLowBalance();
      return data.results ?? data;
    },
  });

  return (
    <Card>
      {isLoading ? (
        <LoadingSpinner />
      ) : !data?.length ? (
        <EmptyState icon={CheckCircle2} title="Ningún alumno con saldo bajo" />
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-3">{data.length} alumno(s) por debajo del umbral.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                  <th className="py-2 pr-4">Alumno</th>
                  <th className="py-2 pr-4">Matrícula</th>
                  <th className="py-2 pr-4 text-right">Saldo</th>
                  <th className="py-2 pr-4 text-right">Umbral</th>
                  <th className="py-2">Últ. sinc.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/50">
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      <Link to={`/admin/cafeteria/${b.student.id}`} className="hover:text-brand-700">
                        {b.student.user.full_name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-500">{b.student.student_id}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-amber-700">${parseFloat(b.balance).toFixed(2)}</td>
                    <td className="py-3 pr-4 text-right text-slate-500">${parseFloat(b.low_balance_threshold ?? '50').toFixed(2)}</td>
                    <td className="py-3 text-slate-500 whitespace-nowrap">{fmtDate(b.last_synced)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
