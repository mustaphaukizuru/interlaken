/**
 * The old seed_cms drafts came with SEO of their own («Costos · Colegio
 * Interlaken»...). It replaced the design's title and description, so loading
 * the design («Cargar el diseño actual», «Diseño original») drops the fields
 * that still hold those values and the page shows the design's SEO again.
 * The API says which fields still hold them (`seed_seo`, docs/cms/safe-publish.md).
 */
type SeoText = { title?: string; description?: string };

export function withoutSeedSeo<T extends SeoText>(seo: T, seed: SeoText | null | undefined): T {
  if (!seed) return seo;
  const next = { ...seo };
  let changed = false;
  for (const key of ['title', 'description'] as const) {
    const value = next[key];
    if (seed[key] && typeof value === 'string' && value.trim() === seed[key]) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : seo;
}
