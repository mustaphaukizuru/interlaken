# CMS plan: every page, every image, every form editable

Goal: staff edit **all** public-site content (copy, images, sections, forms, menus, SEO) from the portal at `/admin/contenido`, with a **visual editor** (see the real page while editing), without a developer deploy. Today only `SiteSettings` (contact data, social links) and the price list are editable; 15 public pages hard-code their text and ~26 images under `frontend/public/assets`.

## Decision: Django-native block CMS + the React site as its own visual editor

| Option | Verdict |
|---|---|
| **A. Extend `apps.content` into a block-based headless CMS; visual editor built into the portal** | **Chosen.** One admin (the portal), data stays in Supabase/Postgres, images in Supabase Storage (already wired via `STORAGES`), zero vendor cost, and the preview is the *actual* site rendered by the *same* React components, so what you see is exactly what publishes. |
| B. Wagtail headless | Mature, but adds a second admin UI next to Unfold and the portal: the duplication we just removed. |
| C. Storyblok / Sanity / Payload | Real visual editors, but monthly cost, content leaves our DB, and a third login for staff. |

## Data model (`apps.content`)

```
MediaAsset      file (Supabase Storage), alt, caption, focal_x/y, width/height, variants {thumb, md, lg, webp}, tags, uploaded_by
Page            slug, title, template (home|level|simple|landing), status (draft|published), seo {title, description, og_image}, published_at
PageVersion     page FK, number, blocks (JSON), author, created_at        -- every publish = a version; rollback = republish an old one
Block (JSON)    { id, type, props }  e.g. type:"hero", props:{ title, subtitle, image:<asset id>, cta:{label, href} }
Menu / MenuItem header, footer, mobile tab bar
FormDefinition  slug, title, fields (JSON schema: type/label/required/options), success_message, notify_emails, store_submissions
FormSubmission  form FK, data (JSON), page, ip/ua hash, created_at, handled (inbox in portal)
Redirect        from_path, to_path, status
```

Block types are a **shared registry**: one JSON schema file in `frontend/src/cms/blocks/*.schema.ts` generates the backend validator and the editor form, and each block has exactly one React component. Adding a block = one schema + one component. Initial set taken from the existing pages: `hero`, `rich_text`, `image`, `gallery`, `feature_grid`, `levels_cards`, `stats`, `testimonials`, `cta_band`, `faq`, `video`, `map_contact`, `pricing_table` (reads the price-list models), `form` (embeds a `FormDefinition`), `open_school_events`.

## API

- Public (cached, ETag): `GET /content/pages/<slug>/` (published), `GET /content/menus/`, `GET /content/forms/<slug>/`, `POST /content/forms/<slug>/submit/` (honeypot + rate limit + consent).
- Staff: CRUD pages/versions/media/menus/forms, `POST /content/pages/<id>/publish/`, `GET /content/pages/<id>/preview/?token=` (draft, signed, 1h), media upload with server-side WebP/size variants (Pillow), `GET /content/forms/<slug>/submissions/`.

## Visual editor (`/admin/contenido`)

Split screen: left = block list + property form (generated from the block schema, media picker, link picker); right = `<iframe src="/<slug>?preview=<token>">` of the real site. The site, when loaded with a preview token, renders the draft and enters **edit mode**: blocks get hover outlines, click selects the block in the left panel, text props are editable inline (contentEditable → postMessage → form). Autosave draft, Publish, Version history with diff, Rollback, device-width toggle. Because the preview is the real app, there is no drift between "editor rendering" and "site rendering".

## Migration of the current site (no big bang)

1. **Media library** first: upload the 26 existing assets as `MediaAsset` rows, build the picker. `Logo.tsx` and `SiteSettings` start using it.
2. **Page model + renderer**: a `<CmsPage slug>` route that renders blocks; existing React pages keep working until replaced.
3. Port pages one at a time, in traffic order: Home → Admisiones → Costos (pricing_table block) → Nivel (×3 via `level` template) → Modelo educativo → Nosotros → Galería → Contacto → Plataformas/Facturación/Documentación. Each port: seed the page's current copy/images as version 1, delete the hard-coded TSX.
4. **Forms**: port Contacto and Pre-registro to `FormDefinition` + submissions inbox (keep the admissions Registration wizard as code: it has documents, tokens and state; a CMS form is not the right tool for it). Book-visit stays code (calendar logic) but its copy becomes a page.
5. Menus, per-page SEO, redirects, then **EN locale** (blocks carry `{es, en}` strings; this is the natural place for the planned English version).

## Guardrails

- Publishing writes an `AuditLog` row and busts the page cache key; drafts never leak (preview needs the signed token).
- Block schema versioning: `props` changes ship with a migration function, same as DB migrations.
- Images: max 10 MB, server-generated variants, `alt` required to publish (a11y test already in CI).
- Forms: reCAPTCHA/honeypot, per-IP rate limit, consent checkbox linked to the active privacy-notice version (reuse `legal`).
- Django admin shows `MediaAsset`, `Page`, `FormDefinition` read-only under "Contenido"; editing happens only in the portal.

## Effort (rough)

| Phase | Scope | Size |
|---|---|---|
| 1 | Media library + picker + storage variants | M |
| 2 | Page/Version/blocks models, API, renderer, 6 core blocks, Home ported | L |
| 3 | Visual editor (split view, edit mode, inline text, publish/rollback) | L |
| 4 | Remaining pages + remaining blocks | M |
| 5 | Forms builder + submissions inbox, Contacto/Pre-registro ported | M |
| 6 | Menus, SEO, redirects, EN locale | M |

Phases 1–3 deliver the "visual editor for every page and image"; 5 delivers "every form".
