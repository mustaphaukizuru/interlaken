# UIUX-DECISIONS — deferred/gated design decisions

Log of choices where the IK-UIUX effort caps applied: things that would need
custom template overrides, new business features, or product input. Each entry
says what was wanted, why it was deferred or how it was bounded, and what to do
later.

## IK-ADMIN (2026-07-08)

1. **`templates/admin/index.html` override (allowed, bounded).** Unfold renders
   the app list on the index by default; a KPI landing requires the documented
   unfold dashboard pattern: `UNFOLD["DASHBOARD_CALLBACK"]` for context +
   an `admin/index.html` that composes unfold's own component templates
   (`unfold/components/card|flex|container|table|title|text.html`). The
   override contains composition only — no custom markup/CSS. This is treated
   as "what unfold's documented settings support", not a freeform override.

2. **Unfold login welcome string is English ("Welcome back to").** unfold
   0.89 ships no es-MX translation for that string; overriding the login
   template just to translate one string violates the config-only cap.
   Revisit if unfold adds the locale or if we later adopt a template override
   budget. All form labels/buttons are already es-MX via Django's own locale.

3. **jazzmin retired.** The previous skin's two template overrides
   (`admin/base_site.html` fonts, `admin/login.html`) and its AdminLTE
   css/js assets were deleted with it. Brand fonts now load via
   `UNFOLD["STYLES"]` → `backend/static/admin/unfold-interlaken.css`
   (static asset, not an override).

4. **django-unfold pinned at 0.89.0** — the newest release that resolves
   against Django 4.2.13 (0.90+ requires Django ≥ 5.1). Revisit alongside a
   Django upgrade.

5. **No sidebar badges (pending counts) yet.** Unfold supports badge
   callbacks per nav item; deferred to keep the nav config dependency-free.
   The KPI dashboard covers the same counts with deep links.
