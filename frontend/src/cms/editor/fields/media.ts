/**
 * Media library access for the editor fields: one asset by id (alt text,
 * size), a lookup for validation, and uploads with progress through the same
 * endpoint and limits as «Medios» (AdminMedia, lib/status checkMediaFile).
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, contentApi, type MediaAsset } from '@/services/api';
import { apiErrorMessage, apiErrorStatus } from '@/lib/apiErrors';
import { checkMediaFile } from '@/lib/status/AdminContentStatus';
import type { MediaLookup } from '../validation';

export const mediaOneKey = (id: number) => ['admin-media', 'one', id] as const;

async function fetchAsset(id: number): Promise<MediaAsset | null> {
  try {
    return (await api.get<MediaAsset>(`/content/admin/media/${id}/`)).data;
  } catch (e) {
    if (apiErrorStatus(e) === 404) return null; // deleted from the library
    throw e;
  }
}

const one = (id: number) => ({ queryKey: mediaOneKey(id), queryFn: () => fetchAsset(id), staleTime: 60_000, retry: false });

/** A library image (null = it no longer exists; undefined = loading or not a library image). */
export function useMediaAsset(ref: unknown): MediaAsset | null | undefined {
  const id = typeof ref === 'number' ? ref : 0;
  const { data } = useQuery({ ...one(id), enabled: id > 0 });
  return id > 0 ? data : undefined;
}

/**
 * Alt text of many library images at once, for validation (one request per
 * image, shared with the image fields' cache). Built on useQuery and the
 * query cache instead of useQueries, which would add ~1 kB gz to the shared
 * react-query chunk every public page loads.
 */
export function useMediaLookup(ids: number[]): MediaLookup {
  const qc = useQueryClient();
  const unique = Array.from(new Set(ids.filter((i) => i > 0))).sort((a, b) => a - b);
  const key = unique.join(',');
  useQuery({
    queryKey: ['admin-media', 'lookup', key],
    queryFn: async () => { await Promise.all(unique.map((id) => qc.fetchQuery(one(id)).catch(() => undefined))); return key; },
    enabled: unique.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  // Re-render when any of these images changes in the cache (alt text typed in an image field).
  useSyncExternalStore(
    useCallback((onChange: () => void) => qc.getQueryCache().subscribe(onChange), [qc]),
    () => unique.map((id) => `${id}:${qc.getQueryState(mediaOneKey(id))?.dataUpdatedAt ?? 0}`).join(','),
  );
  return (id) => {
    const state = qc.getQueryState<MediaAsset | null>(mediaOneKey(id));
    if (!state || state.status !== 'success') return undefined;
    if (state.data === null) return null; // deleted from the library
    return state.data ? { alt: state.data.alt ?? '' } : undefined;
  };
}

export const rememberAsset = (qc: QueryClient, asset: MediaAsset) => qc.setQueryData(mediaOneKey(asset.id), asset);

export interface UploadRow { key: string; name: string; pct: number; status: 'uploading' | 'ok' | 'duplicate' | 'error'; message?: string; asset?: MediaAsset }

/** Uploads files one by one with progress; a duplicate (same content already in the library) reuses the existing image. */
export function useMediaUpload() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const upload = useCallback(async (files: File[]): Promise<MediaAsset[]> => {
    const stamp = Date.now();
    const initial: UploadRow[] = files.map((f, i) => {
      const err = checkMediaFile(f);
      return { key: `${stamp}-${i}`, name: f.name, pct: 0, status: err ? 'error' : 'uploading', message: err ?? undefined };
    });
    setRows(initial);
    const done: MediaAsset[] = [];
    for (let i = 0; i < files.length; i += 1) {
      if (initial[i].status === 'error') continue;
      const patch = (p: Partial<UploadRow>) => setRows((prev) => prev.map((r) => (r.key === initial[i].key ? { ...r, ...p } : r)));
      const form = new FormData();
      form.append('file', files[i]);
      try {
        const res = await api.post<MediaAsset>('/content/admin/media/', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => patch({ pct: e.total ? Math.round((e.loaded / e.total) * 100) : 50 }),
        });
        rememberAsset(qc, res.data);
        done.push(res.data);
        patch({ pct: 100, status: 'ok', asset: res.data });
      } catch (e) {
        const existing = (e as { response?: { data?: { existing?: MediaAsset } } }).response?.data?.existing;
        if (apiErrorStatus(e) === 409 && existing) {
          rememberAsset(qc, existing);
          done.push(existing);
          patch({ pct: 100, status: 'duplicate', asset: existing, message: 'Ya estaba en la biblioteca: se usa esa misma imagen.' });
        } else {
          patch({ status: 'error', message: apiErrorMessage(e, 'No se pudo subir.') });
        }
      }
    }
    void qc.invalidateQueries({ queryKey: ['admin-media', 'picker'] });
    return done;
  }, [qc]);
  return { rows, upload, clear: () => setRows([]) };
}

/** Saves an image's alt text in the library (shared by every page that uses it). */
export async function saveAlt(qc: QueryClient, id: number, alt: string): Promise<MediaAsset> {
  const res = await contentApi.adminUpdateMedia(id, { alt });
  rememberAsset(qc, res.data);
  return res.data;
}
