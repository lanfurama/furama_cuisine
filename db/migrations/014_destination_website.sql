-- A destination's own website (2026-10). Expand only, safe to re-run.
--
-- The home page's destination card opens it (in a new tab) when it is set;
-- without one a venue's card still picks its restaurants, and a teaser stays
-- static. Nothing is seeded here: the content is the CMS's, so the addresses
-- come with db/content-packs/2026-10-destination-websites.json.

ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS website_url text CHECK (website_url ~ '^https://' AND length(website_url) <= 2000);
