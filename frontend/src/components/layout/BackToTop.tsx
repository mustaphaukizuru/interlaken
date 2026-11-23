import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { isRootScroll, scrollTop, scrollToY, viewHeight } from '@/lib/scrollRoot';

/**
 * «Volver arriba»: appears once the page has been scrolled about a screen and
 * a half, scrolls back to the top and gives the focus to the page title (so a
 * keyboard user is not left on a button that just disappeared). `className`
 * places it above whatever else floats at the bottom of each layout.
 */
export function BackToTop({ className = '' }: { className?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let timer = 0;
    const check = () => { timer = 0; setShow(scrollTop() > viewHeight() * 1.5); };
    const onScroll = (e: Event) => {
      if (!isRootScroll(e.target) || timer) return;
      timer = window.setTimeout(check, 100);
    };
    check();
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  const toTop = () => {
    scrollToY(0, true);
    const h1 = document.querySelector<HTMLElement>('#contenido h1');
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      h1.setAttribute('data-route-focus', '');
      h1.focus({ preventScroll: true });
    }
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Volver arriba"
      title="Volver arriba"
      tabIndex={show ? 0 : -1}
      aria-hidden={show ? undefined : true}
      data-back-to-top=""
      className={`fixed z-sticky flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white text-ink shadow-raised transition-[opacity,transform] duration-300 hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 motion-reduce:transition-none print:hidden ${
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
      } ${className}`}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

export default BackToTop;
