Fonts embedded in generated PDFs (apps/core/pdf_document.py)
=============================================================

The «Ficha de inscripción» PDF draws the school's Excel form, made with
Century Gothic and Calibri (proprietary: they are never added to this
repository). It uses free fonts with the same metrics instead, embedded in
each PDF. The files below are unmodified copies; only the PDF carries a
subset (Carlito) or the font's CFF table (TeX Gyre Adventor).

texgyreadventor-regular.otf, texgyreadventor-bold.otf
    TeX Gyre Adventor 2.609 (31 III 2026), by B. Jackowski, J. M. Nowacki,
    P. Pianowski and P. Strzelczyk (GUST e-foundry), based on URW Gothic L
    by URW++. Stands in for Century Gothic (and for the form's Neutra Text
    titles).
    Licence: GUST Font License (GUST-FONT-LICENSE.txt), an instance of the
    LaTeX Project Public License 1.3c (https://www.latex-project.org/lppl.txt).
    Only these two files of the Work are included, unchanged; see
    README-TeX-Gyre-Adventor.txt and MANIFEST-TeX-Gyre-Adventor.txt. The
    complete Work: https://www.gust.org.pl/projects/e-foundry/tex-gyre/adventor
    (also on CTAN: fonts/tex-gyre). Nobody named there gives support for
    this copy.

Carlito-Regular.ttf
    Carlito (Google Fonts, ofl/carlito), copyright 2013 The Carlito Project
    Authors, with Reserved Font Name "Carlito". Stands in for Calibri.
    Licence: SIL Open Font License 1.1 (OFL-Carlito.txt).
