'use client';

import { useEffect, useRef } from 'react';
import { CUISINES, DESTS, cuisineLabel, restaurantImage } from '@/lib/data';
import { fold } from '@/lib/booking';
import { useSite } from '@/components/site/SiteProvider';
import { useOpenAnimation } from '@/lib/motion';

export function SearchOverlay() {
  const { restaurants, overlay, close, query, setQuery, openRestaurant } = useSite();
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

  const q = fold(query.trim());
  const results = !q
    ? []
    : restaurants.filter((r) =>
        fold([r.name, r.type, r.cuisines.map(cuisineLabel).join(' '), DESTS[r.dest]].join(' ')).includes(q),
      );

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
              {CUISINES.map(([label]) => (
                <button key={label} type="button" className="search-chip" onClick={() => setQuery(label)}>
                  {label}
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
                    style={{ backgroundImage: `url('${restaurantImage(r.id)}')` }}
                    aria-hidden="true"
                  />
                  <span className="search-result-copy">
                    <span className="search-result-name">{r.name}</span>
                    <span className="search-result-meta">{`${r.type} · ${DESTS[r.dest]}`}</span>
                  </span>
                  {(r.hasDetailPage || r.bookingEnabled) && (
                    <span className="search-result-action">
                      {r.hasDetailPage ? 'View' : 'Reserve'} →
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
