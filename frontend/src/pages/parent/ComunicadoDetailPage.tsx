import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Megaphone, Send, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard, SectionEmpty } from '@/components/ui/SectionCard';
import { ErrorState } from '@/components/ui/ErrorState';
import { portalApi } from '@/services/api';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Announcement {
  id: number; title: string; body: string; audience: string;
  created_at: string; comment_count: number;
}
interface Comment { id: number; body: string; author_name: string; created_at: string; }

const audienceLabel: Record<string, string> = {
  all: 'Todos', parents: 'Padres', students: 'Alumnos', staff: 'Personal',
};

export default function ComunicadoDetailPage() {
  const { id } = useParams();
  const annId = Number(id);
  const enabled = Number.isFinite(annId);
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const ann = useQuery<Announcement>({
    queryKey: ['announcement', annId],
    queryFn: async () => (await portalApi.getAnnouncement(annId)).data,
    enabled,
  });

  const comments = useQuery<Comment[]>({
    queryKey: ['announcement-comments', annId],
    queryFn: async () => (await portalApi.getAnnouncementComments(annId)).data.results,
    enabled,
  });

  const postComment = useMutation({
    mutationFn: (text: string) => portalApi.postAnnouncementComment(annId, text),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['announcement-comments', annId] });
      qc.invalidateQueries({ queryKey: ['announcement', annId] });
      toast.success('Comentario publicado');
    },
    onError: () => toast.error('No se pudo publicar el comentario. Intenta de nuevo.'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (text) postComment.mutate(text);
  };

  return (
    <>
      <PageHeader title="Comunicado" subtitle="Detalle y comentarios" />

      <Link
        to="/portal/comunicados"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-purple hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a comunicados
      </Link>

      {ann.isError ? (
        <div className="card">
          <ErrorState
            title="Comunicado no disponible"
            description="No se encontró el comunicado o no tienes acceso a él."
            onRetry={() => ann.refetch()}
          />
        </div>
      ) : ann.isLoading ? (
        <div className="skeleton h-40 rounded-xl2" aria-hidden="true" />
      ) : ann.data ? (
        <div className="space-y-5">
          <article className="rounded-xl2 border border-line bg-white p-5 shadow-card sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-pink to-purple text-white">
                <Megaphone className="h-5 w-5" />
              </span>
              <span className="badge-purple">{audienceLabel[ann.data.audience] ?? ann.data.audience}</span>
            </div>
            <h1 className="font-head text-fluid-xl font-bold text-ink">{ann.data.title}</h1>
            <p className="mt-1 text-[12px] text-subtle">
              {format(new Date(ann.data.created_at), "d 'de' MMMM yyyy, HH:mm", { locale: es })}
            </p>
            <div className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-muted">
              {ann.data.body}
            </div>
          </article>

          <SectionCard title={`Comentarios${comments.data ? ` (${comments.data.length})` : ''}`}>
            <div className="p-5">
              <form onSubmit={submit} className="mb-5 flex flex-col gap-2">
                <label htmlFor="comment-body" className="sr-only">Escribe un comentario</label>
                <textarea
                  id="comment-body"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Escribe un comentario o una pregunta…"
                  className="input-field resize-y"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!body.trim() || postComment.isPending}
                    className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {postComment.isPending ? 'Publicando…' : 'Publicar'}
                  </button>
                </div>
              </form>

              {comments.isLoading ? (
                <div className="space-y-3">{[0, 1].map(i => <div key={i} className="skeleton h-14 rounded-xl2" />)}</div>
              ) : !comments.data?.length ? (
                <SectionEmpty icon={MessageCircle}>Sé el primero en comentar</SectionEmpty>
              ) : (
                <ul className="space-y-3">
                  {comments.data.map(c => (
                    <li key={c.id} className="rounded-xl2 border border-line bg-cream-2 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-ink">{c.author_name}</span>
                        <span className="text-[11px] text-subtle">
                          {format(new Date(c.created_at), 'd MMM HH:mm', { locale: es })}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-line text-[13px] text-muted">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
