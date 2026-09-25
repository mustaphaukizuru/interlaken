import { Search, X } from 'lucide-react';
import { useUrlSyncedSearch } from '@/hooks/useUrlFilters';

interface Props {
  /** URL param (and API param) the search writes to. */
  paramKey?: string;
  placeholder: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  className?: string;
  delay?: number;
  autoFocus?: boolean;
}

/**
 * Server search box for admin lists (Data Ops round, C6): debounced, synced
 * to `?q=` (or `paramKey`) through `useUrlSyncedSearch`, with a clear button.
 * 16 px text so iOS does not zoom, 44 px tall, `inputMode="search"`.
 */
export function SearchInput({ paramKey = 'q', placeholder, label, className = '', delay = 300, autoFocus }: Props) {
  const { input, setInput } = useUrlSyncedSearch(paramKey, delay);
  return (
    <div className={`relative ${className}`.trim()}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        className={`input-field pl-9 ${input ? 'pr-11' : ''}`}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && input) {
            e.preventDefault();
            setInput('');
          }
        }}
      />
      {input && (
        <button
          type="button"
          onClick={() => setInput('')}
          aria-label="Limpiar búsqueda"
          className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-subtle hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default SearchInput;
