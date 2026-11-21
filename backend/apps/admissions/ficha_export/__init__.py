"""
admissions/ficha_export — Fase 3: the «Ficha de inscripción» as files.

* ``ficha_inscripcion.xlsx``: the school's 2021 Excel form, anonymised (the
  template; ``test_ficha_template.py`` proves it holds labels only);
* ``cellmap``: where each datum goes; ``data``: a Registration → those values;
* ``excel`` / ``pdf``: the filled Excel (exactly the school's layout) and a
  3-page Letter PDF drawn from the same grid;
* ``files``: one ficha, the blank form, a ZIP of several;
* ``concentrado``: one row per student with every ficha field (Excel);
* ``views``: the download endpoints (audited, rate limited).
"""
