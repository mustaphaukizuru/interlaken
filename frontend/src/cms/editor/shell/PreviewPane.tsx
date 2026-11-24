import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Eye, Monitor, Smartphone, Tablet } from 'lucide-react';
import type { Block } from '../../blocks/registry';
import { EditableBlocks } from '../EditableBlocks';

export type Device = 'mobile' | 'tablet' | 'desktop';
const DEVICES = [['mobile', Smartphone, 'Móvil'], ['tablet', Tablet, 'Tableta'], ['desktop', Monitor, 'Escritorio']] as const;
/** Phone and tablet frames: the screen of an iPhone 14 and an iPad Air (CSS px). */
const FRAME: Record<'mobile' | 'tablet', { width: number; height: number; label: string }> = {
  mobile: { width: 390, height: 844, label: 'Móvil' },
  tablet: { width: 820, height: 1180, label: 'Tableta' },
};

interface Props {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  device: Device;
  onDevice: (d: Device) => void;
  previewRef: RefObject<HTMLDivElement>;
}

/** Live preview of the draft with the phone / tablet / desktop switch. */
export function PreviewPane({ blocks, selectedId, onSelect, device, onDevice, previewRef }: Props) {
  const content = blocks.length === 0
    ? <p className="p-10 text-center text-sm text-muted">Sin contenido todavía.</p>
    : <EditableBlocks blocks={blocks} selectedId={selectedId} onSelect={onSelect} />;
  return (
    <section className="min-w-0" aria-label="Vista previa">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-subtle"><Eye size={14} aria-hidden="true" /> Vista previa en vivo: haga clic en una sección para editarla</span>
        <div role="group" aria-label="Tamaño de pantalla" className="inline-flex rounded-md bg-white p-0.5 ring-1 ring-line">
          {DEVICES.map(([d, Icon, label]) => (
            <button key={d} type="button" aria-pressed={device === d} aria-label={label} title={label} onClick={() => onDevice(d)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${device === d ? 'bg-purple text-white' : 'text-subtle hover:text-ink'}`}>
              <Icon size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-md bg-cream-2 p-2 sm:p-3">
        {device === 'desktop'
          ? <div ref={previewRef} className="mx-auto overflow-hidden rounded-md bg-white shadow-card">{content}</div>
          : <DeviceFrame key={device} frame={FRAME[device]} previewRef={previewRef}>{content}</DeviceFrame>}
      </div>
    </section>
  );
}

/**
 * The console's stylesheets (Vite injects and updates <style> tags in dev),
 * kept in step in the frame: only what changed is added, updated or removed,
 * so a <title> or <meta> change never re-adds every sheet (no unstyled flash).
 */
function syncStyles(doc: Document, copies: Map<Element, HTMLElement>) {
  const sources = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'));
  for (const [src, copy] of copies) {
    if (!sources.includes(src)) { copy.remove(); copies.delete(src); }
  }
  for (const src of sources) {
    const copy = copies.get(src);
    if (!copy) {
      const made = doc.importNode(src, true) as HTMLElement;
      if (src instanceof HTMLLinkElement) made.setAttribute('href', src.href);
      doc.head.appendChild(made);
      copies.set(src, made);
    } else if (src instanceof HTMLLinkElement) {
      if (copy.getAttribute('href') !== src.href) copy.setAttribute('href', src.href);
    } else if (copy.textContent !== src.textContent) {
      copy.textContent = src.textContent;
    }
  }
}

/** lang, class and data-* of the console's <html> (theme, flags the CSS reads). */
function mirrorRootAttributes(doc: Document) {
  const from = document.documentElement;
  const to = doc.documentElement;
  for (const { name } of Array.from(to.attributes)) {
    if (name === 'lang' || name === 'class' || name.startsWith('data-')) to.removeAttribute(name);
  }
  for (const { name, value } of Array.from(from.attributes)) {
    if (name === 'lang' || name === 'class' || name.startsWith('data-')) to.setAttribute(name, value);
  }
}

/**
 * The phone or tablet preview: a same-origin frame of the device's width and
 * height, so media queries, `svh` and fixed bars behave as on that screen
 * (a narrow box in the console's own window kept the laptop layout). Wider
 * than the space, it is scaled down, never reflowed. Where the frame has no
 * document (some test environments), the preview renders inline as before.
 * Known limit: JS that reads `window` (matchMedia hooks, innerWidth) still
 * sees the console's window.
 */
function DeviceFrame({ frame, previewRef, children }: { frame: { width: number; height: number; label: string }; previewRef: RefObject<HTMLDivElement>; children: ReactNode }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const [inline, setInline] = useState(false);
  const [scale, setScale] = useState(1);
  const ref = previewRef as MutableRefObject<HTMLDivElement | null>;

  // Build the frame's document once it exists (and again if the browser swaps
  // the initial about:blank document on load).
  useLayoutEffect(() => {
    const iframe = iframeRef.current!;
    let current: Document | null = null;
    let observers: MutationObserver[] = [];
    const setup = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body || !doc.head || doc === current) return;
      if (current) observers.forEach((o) => o.disconnect());
      current = doc;
      const meta = doc.createElement('meta');
      meta.name = 'viewport';
      meta.content = `width=${frame.width}, initial-scale=1`;
      const base = doc.createElement('base');
      base.href = `${window.location.origin}/`;
      // Phones and tablets draw overlay scrollbars: none here either, so the layout keeps the full width.
      const own = doc.createElement('style');
      own.textContent = 'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}';
      doc.head.append(meta, base, own);
      const copies = new Map<Element, HTMLElement>();
      syncStyles(doc, copies);
      mirrorRootAttributes(doc);
      const styles = new MutationObserver(() => syncStyles(doc, copies));
      styles.observe(document.head, { childList: true, subtree: true, characterData: true });
      const root = new MutationObserver(() => mirrorRootAttributes(doc));
      root.observe(document.documentElement, { attributes: true });
      observers = [styles, root];
      const el = doc.createElement('div');
      doc.body.appendChild(el);
      setMount(el);
    };
    setup();
    if (!current) {
      // No document yet: wait for the frame's load; none at all (jsdom without frames) = inline.
      if (!iframe.contentDocument) setInline(true);
    }
    iframe.addEventListener('load', setup);
    return () => {
      iframe.removeEventListener('load', setup);
      observers.forEach((o) => o.disconnect());
    };
  }, [frame.width]);

  // AdminPageEditor scrolls the selected section into view through previewRef.
  useLayoutEffect(() => {
    if (!mount) return;
    ref.current = mount;
    return () => { if (ref.current === mount) ref.current = null; };
  }, [mount, ref]);

  // Scale a frame wider than the pane (a tablet next to the form) instead of reflowing it.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const fit = () => setScale(Math.min(1, box.clientWidth / frame.width) || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [frame.width]);

  if (inline) {
    return <div ref={previewRef} className="mx-auto overflow-hidden rounded-md bg-white shadow-card" style={{ width: frame.width, maxWidth: '100%' }}>{children}</div>;
  }
  // Up to 80% of the console's height, so the whole screen stays in view.
  const height = `min(${frame.height}px, 80vh)`;
  return (
    <div ref={boxRef} className="w-full">
      <div className="mx-auto overflow-hidden rounded-md bg-white shadow-card" style={{ width: frame.width * scale, height: `calc(${height} * ${scale})` }}>
        <iframe
          ref={iframeRef}
          title={`Vista previa: ${frame.label}`}
          data-preview-device={frame.label}
          className="block origin-top-left border-0"
          style={{ width: frame.width, height, transform: scale < 1 ? `scale(${scale})` : undefined }}
        />
      </div>
      {mount && createPortal(children, mount)}
    </div>
  );
}
