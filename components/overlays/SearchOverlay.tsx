'use client';

import { useEffect, useRef } from 'react';
import { fold } from '@/lib/booking';
import { useSite } from '@/components/site/SiteProvider';
import { useOpenAnimation } from '@/lib/motion';

export function SearchOverlay() {
  const { site, destName, restaurants, overlay, close, query, setQuery, openRestaurant, strings } = useSite();
  const inputRef = useRef<HTMLInputElement>(null);
  const open = overlay === 'search';

  useOpenAnimation(open, (animate) => {
    animate('[data-anim="search"]', [{ opacity: 0 }, { opacity: 1 }], 400, 0, 'ease');
    animate(
      '[data-anim="search-item"]',
      [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
      800,
      150,
    );
  });

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  // r.search is folded on the server: name, type, cuisines and destination in this language and the default one (spec §6.3 item 9).
  const q = fold(query.trim());
  const results = !q ? [] : restaurants.filter((r) => r.search.includes(q));

  return (
    <div data-anim="search" className="search-root" role="dialog" aria-modal="true" aria-label="Search">
      <div className="search-inner">
        <div className="search-head">
          <div className="search-wordmark">FURAMA CUISINE</div>
          <button type="button" className="overlay-close" aria-label="Close search" onClick={close}>
            ×
          </button>
        </div>

        <input
          ref={inputRef}
          data-anim="search-item"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search restaurants, cuisines, places"
          aria-label="Search restaurants, cuisines, places"
        />

        {!q && (
          <>
            <div className="search-label">POPULAR CUISINES</div>
            <div className="search-chips">
              {site.cuisines.map((c) => (
                <button key={c.id} type="button" className="search-chip" onClick={() => setQuery(c.label)}>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}

        {results.length > 0 && (
          <>
            <div className="search-label search-label-results">
              {results.length} {results.length === 1 ? 'RESULT' : 'RESULTS'}
            </div>
            <div className="search-results">
              {results.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className="search-result"
                  onClick={() => openRestaurant(r)}
                >
                  <span
                    className="search-thumb"
                    style={r.image ? { backgroundImage: `url('${r.image.url}')` } : undefined}
                    aria-hidden="true"
                  />
                  <span className="search-result-copy">
                    <span className="search-result-name">{r.name}</span>
                    <span className="search-result-meta">{`${r.type} · ${destName(r.dest)}`}</span>
                  </span>
                  {/* With online booking off, a restaurant with a number is called (R20); one without has no action. */}
                  {(r.hasDetailPage || r.bookingEnabled || r.phone) && (
                    <span className="search-result-action">
                      {r.hasDetailPage ? 'View' : r.bookingEnabled ? 'Reserve' : strings['booking.call_action']} →
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {q && results.length === 0 && (
          <div className="search-none">
            No matches for “{query}”. Try a cuisine such as Vietnamese or Italian.
          </div>
        )}
      </div>
    </div>
  );
}
