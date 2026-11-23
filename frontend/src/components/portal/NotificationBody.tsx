import { Fragment } from 'react';
import { linkify, listItemParts, parseMessage, type MessageBlock } from '@/lib/notificationText';

/** Text with its links clickable. External links open in a new tab. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((t, i) => (t.kind === 'link' ? (
        <a
          key={i}
          href={t.href}
          {...(t.href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          className="break-words font-medium text-purple underline decoration-purple/30 underline-offset-2 hover:decoration-purple"
        >
          {t.text}
        </a>
      ) : <Fragment key={i}>{t.text}</Fragment>))}
    </>
  );
}

function List({ items }: { items: string[] }) {
  const parts = items.map(listItemParts);
  // Items with details ("Nombre · dato · dato") read best as stacked rows;
  // plain bullets stay a simple list.
  if (parts.some((p) => p.details.length > 0)) {
    return (
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
        {parts.map((p, i) => (
          <li key={i} className="bg-white px-4 py-3">
            <p className="font-semibold text-ink"><Linked text={p.main} /></p>
            {p.details.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted">
                {p.details.map((d, j) => {
                  if (d.flag) {
                    return (
                      <span key={j} className="inline-flex flex-wrap items-center gap-1.5">
                        <span className="badge-amber">{d.flag}</span>
                        {d.text && <span className="text-ink"><Linked text={d.text} /></span>}
                      </span>
                    );
                  }
                  // The separator trails its detail, so a wrapped line never starts with «·».
                  const next = p.details[j + 1];
                  return (
                    <span key={j} className="inline-flex items-center gap-2">
                      <Linked text={d.text} />
                      {next && !next.flag && <span className="text-subtle" aria-hidden="true">·</span>}
                    </span>
                  );
                })}
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-purple" aria-hidden="true" />
          <span><Linked text={item} /></span>
        </li>
      ))}
    </ul>
  );
}

function Block({ block }: { block: MessageBlock }) {
  if (block.kind === 'list') return <List items={block.items} />;
  if (block.kind === 'fields') {
    return (
      <dl className="grid gap-x-6 gap-y-2 rounded-md bg-cream-2 px-4 py-3 sm:grid-cols-[minmax(8rem,max-content)_1fr]">
        {block.rows.map((r, i) => (
          <div key={i} className="contents">
            <dt className="text-sm font-semibold text-muted">{r.label}</dt>
            <dd className="mb-1 text-ink sm:mb-0"><Linked text={r.value} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <p>
      {block.lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Linked text={line} />
        </Fragment>
      ))}
    </p>
  );
}

/**
 * A notification body laid out for reading: paragraphs, lists, label/value
 * rows and clickable links, from the plain text the backend sends (see
 * lib/notificationText). Rendering only: the text itself is untouched.
 */
export function NotificationBody({ message, className = '' }: { message: string; className?: string }) {
  const blocks = parseMessage(message);
  return (
    <div className={`max-w-[68ch] space-y-4 text-[15px] leading-relaxed text-ink ${className}`.trim()} data-testid="notification-body">
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  );
}

export default NotificationBody;
