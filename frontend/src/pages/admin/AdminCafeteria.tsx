import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Coffee, RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaBalance } from '@/types';

export default function AdminCafeteria() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: balances, isLoading } = useQuery<CafeteriaBalance[]>({
    queryKey: ['admin-cafeteria-balances'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getAllBalances();
      return data.results ?? data;
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: () => cafeteriaApi.syncBalance(0),
    onSuccess: () => {
      toast.success('Sincronización completada.');
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const syncOneMutation = useMutation({
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cafetería — Admin</h1>
          <p className="text-slate-500 text-sm mt-0.5">Gestión de saldos y recargas.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={syncAllMutation.isPending}
          onClick={() => syncAllMutation.mutate()}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Sincronizar todos
        </Button>
      </div>

      <Card>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input-field pl-9"
            placeholder="Buscar alumno o matrícula…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : !filtered?.length ? (
          <EmptyState icon={Coffee} title="Sin saldos registrados" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Alumno</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Matrícula</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Saldo</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Estado</th>
                  <th className="text-left py-2 text-xs font-semibold text-slate-500">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((b) => {
                  const isLow = parseFloat(b.balance) < parseFloat(b.low_balance_threshold ?? '50');
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/50">
                      <td className="py-3 pr-4 font-medium text-slate-900">{b.student.user.full_name}</td>
                      <td className="py-3 pr-4 text-slate-500">{b.student.student_id}</td>
                      <td className="py-3 pr-4 font-semibold text-slate-900">${parseFloat(b.balance).toFixed(2)}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={isLow ? 'warning' : 'success'}>
                          {isLow ? 'Saldo bajo' : 'Normal'}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => syncOneMutation.mutate(b.student.id)}
                          loading={syncOneMutation.isPending}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
