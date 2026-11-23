# Email design standard

How every email the platform sends looks and behaves. Decision record:
`docs/decisions/0004-email-design.md`. Notification routing (who gets what):
`docs/NOTIFICATION-MATRIX.md`.

## Building an email
Describe **what** to say with `EmailContent`; never hand-write HTML.

```python
from apps.portal.emailing import EmailContent, money, long_date, person_initial
content = EmailContent(
    title='Recarga aplicada',               # the h1; short, no name
    intro='La recarga ya está en el saldo.', # first sentence (also the preheader, ≤90 chars)
    category='Cafetería', tone='success',    # chip + tint (brand|success|warning|danger|neutral)
    highlight=('Saldo actual', money(balance)),
    details=[('Alumno', person_initial(student.user)), ('Monto', money(amount)), ('Folio', folio)],
    cta_label='Ver movimientos', cta_url=portal_url('/portal/cafeteria'),
    reason='Recibe este aviso porque …', manage_prefs=True,
)
send_email(subject='Recarga aplicada', content=content, to=[...])
```

## Rules
| Topic | Rule |
|---|---|
| Subject | ≤ 50 characters, specific, no all-caps, **no names, codes or amounts** |
| Preheader | ≤ 90 characters (cut on a word boundary); defaults to the intro |
| Names | Family bodies: first name + initial (`person_initial`); staff bodies may use full names |
| Amounts | Receipts and balance notices keep amount, folio and balance (D13) |
| Action | One primary button, verb first («Ver movimientos»); other links are text |
| Sensitive data | Never medical data, ficha answers, CURP, document contents |
| Families | `transactional` (default) never shows hero/cards/stats; `notice` (comunicados) may |
| Footer | School, address, phone, hours, why this email arrived, avisos link (families) |
| Links | Absolute `https://interlaken.edu.mx`; UTM only on public pages, never personal data; no tracking pixels |
| Language | Spanish, usted |

## Layout tokens
Cream page `#F5F4FA` · white panel, 12 px radius, no border · tinted blocks
`#F5F4FA`/status tints, 12 px · button `#401A8E`, 8 px, white label, ≥ 44 px
(Outlook: `mso-padding-alt` on the cell) · body 16 px, line height 1.5 ·
headings 22–28 px · footer ≥ 12 px · width 600 px, one column on phones.
`backend/apps/portal/test_email_tokens.py` fails if a colour drifts from
`frontend/src/index.css`.

## Reviewing emails
`python manage.py render_emails [--out DIR]` (DEBUG only, never sends) writes
27 samples as `.html` + `.txt` and an `index.html`. Check them in the client
matrix before release: Gmail (web, Android, iOS), Outlook (Windows, web),
Apple Mail (macOS, iOS), Samsung Mail; images on and off; forced dark (the
logo PNG has a white background).

## Tests
`portal/test_email_phase9.py` (layout, families, D13 subjects and names,
preheader, size < 100 KB, text part) · `portal/test_email_tokens.py` (colour
parity, AA) · `core/test_django_admin_smoke.py` (admin).
