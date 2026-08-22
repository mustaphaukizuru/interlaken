import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Camera, Trash2, ZoomIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { authApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';

const OUT = 512;

/** Compute the square crop of `img` shown in a `box`-px viewport with `zoom` and `offset` (px). */
export function cropToSquare(img: HTMLImageElement, zoom: number, offset: { x: number; y: number }, box: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const base = Math.max(box / img.width, box / img.height); // cover
  const scale = base * zoom;
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (box - drawW) / 2 + offset.x;
  const y = (box - drawH) / 2 + offset.y;
  const k = OUT / box;
  ctx.drawImage(img, x * k, y * k, drawW * k, drawH * k);
  return canvas;
}

/** Avatar with initials fallback. */
export function Avatar({ user, size = 64, className = '' }: { user: Pick<User, 'first_name' | 'last_name' | 'avatar'> | null; size?: number; className?: string }) {
  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';
  if (user?.avatar) return <img src={user.avatar} alt="" width={size} height={size} className={`rounded-full object-cover ${className}`} style={{ width: size, height: size }} />;
  return <div className={`flex items-center justify-center rounded-full bg-gradient-to-br from-pink to-purple font-head font-bold text-white ${className}`} style={{ width: size, height: size, fontSize: size / 2.6 }} aria-hidden="true">{initials}</div>;
}

/** Profile photo picker with square crop (drag + zoom), BACKLOG P1-F2. */
export function AvatarUpload() {
  const { user, setUser } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const BOX = 260;

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Elija una imagen.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('La imagen supera 5 MB.'); return; }
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { setImg(el); setSrc(url); setZoom(1); setOffset({ x: 0, y: 0 }); };
    el.onerror = () => toast.error('No se pudo leer la imagen.');
    el.src = url;
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!img) throw new Error('no image');
      const canvas = cropToSquare(img, zoom, offset, BOX);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/webp', 0.9));
      return authApi.uploadAvatar(blob);
    },
    onSuccess: ({ data }) => { setUser(data as User); setSrc(null); setImg(null); toast.success('Foto actualizada.'); },
    onError: () => toast.error('No se pudo subir la foto.'),
  });
  const remove = useMutation({
    mutationFn: () => authApi.deleteAvatar(),
    onSuccess: ({ data }) => { setUser(data as User); toast.success('Foto eliminada.'); },
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const onPointerDown = (e: ReactPointerEvent) => { drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); };
  const onPointerMove = (e: ReactPointerEvent) => { if (drag.current) setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const onPointerUp = () => { drag.current = null; };

  const base = img ? Math.max(BOX / img.width, BOX / img.height) : 1;
  const hasCustom = (user as (User & { has_custom_avatar?: boolean }) | null)?.has_custom_avatar;

  return (
    <div className="flex items-center gap-4">
      <Avatar user={user} size={72} />
      <div className="flex flex-wrap gap-2">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" aria-label="Elegir foto" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}><Camera size={14} aria-hidden="true" /> {user?.avatar ? 'Cambiar foto' : 'Subir foto'}</Button>
        {hasCustom && <Button type="button" size="sm" variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}><Trash2 size={14} aria-hidden="true" /> Quitar</Button>}
      </div>
      <Modal open={!!src} onClose={() => { setSrc(null); setImg(null); }} title="Ajustar foto" maxWidth={360}>
        <p className="mb-2 text-xs text-muted">Arrastre para encuadrar y use el control para acercar.</p>
        <div
          className="relative mx-auto touch-none select-none overflow-hidden rounded-full bg-cream-2 ring-4 ring-purple/20"
          style={{ width: BOX, height: BOX, cursor: 'grab' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          role="img" aria-label="Vista previa de la foto"
        >
          {src && img && (
            <img src={src} alt="" draggable={false} className="absolute max-w-none"
              style={{ width: img.width * base * zoom, height: img.height * base * zoom, left: (BOX - img.width * base * zoom) / 2 + offset.x, top: (BOX - img.height * base * zoom) / 2 + offset.y }} />
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted"><ZoomIn size={16} aria-hidden="true" /><input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" aria-label="Acercar" /></label>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => { setSrc(null); setImg(null); }}>Cancelar</Button>
          <Button type="button" onClick={() => upload.mutate()} loading={upload.isPending}>Guardar foto</Button>
        </div>
      </Modal>
    </div>
  );
}

export default AvatarUpload;
