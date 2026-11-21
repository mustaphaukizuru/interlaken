"""
admissions/ficha_export — Fase 3: the «Ficha de inscripción» as files.

* ``ficha_inscripcion.xlsx``: the school's 2021 Excel form with only the
  personal values removed (the template; ``test_ficha_template.py`` holds it
  to ``ficha_fingerprint.json``, the original's structure);
* ``cellmap``: where each datum goes (only the form's own cells); ``data``: a
  Registration → those values;
* ``excel`` / ``pdf``: the original workbook with the values written in, and
  the same form as Excel prints it (3 Letter pages);
* ``files``: one ficha, the blank form, a ZIP of several;
* ``concentrado``: one row per student with every ficha field (Excel);
* ``views``: the download endpoints (audited, rate limited).
"""
