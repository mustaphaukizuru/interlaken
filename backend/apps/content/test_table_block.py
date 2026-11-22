"""Generic «Tabla» block: accepted on any page, limits from block_manifest.json enforced."""

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.content.pages import Page, manifest, validate_blocks
from apps.content.table_block import table_problem

pytestmark = pytest.mark.django_db

LIMITS = {"columns": 8, "rows": 60, "cell": 300}


def table(cols=2, rows=2, **extra):
    return {
        "columns": [{"label": f"C{i}", "align": "right", "format": "money"} for i in range(cols)],
        "rows": [[str(r * 100 + c) for c in range(cols)] for r in range(rows)],
        "highlight": None,
        **extra,
    }


def test_manifest_carries_the_limits():
    assert manifest()["table"]["tables"] == {"table": LIMITS}


@pytest.mark.parametrize(
    "value, problem",
    [
        (table(), None),
        (table(highlight=1), None),
        ({"columns": [{"label": "Concepto"}], "rows": [["Algo"], [12.5]]}, None),
        ("tabla", "la tabla no es válida."),
        ({"columns": [], "rows": []}, "la tabla necesita al menos una columna."),
        (table(cols=9), "la tabla admite hasta 8 columnas."),
        (table(rows=61), "la tabla admite hasta 60 filas."),
        (table(highlight=2), "la fila destacada no existe."),
        (table(highlight=True), "la fila destacada no existe."),
        (
            {"columns": [{"label": "A", "format": "html"}], "rows": []},
            "el formato de la columna 1 no es válido.",
        ),
        (
            {"columns": [{"label": "A", "align": "justify"}], "rows": []},
            "la alineación de la columna 1 no es válida.",
        ),
        (
            {"columns": [{"label": "x" * 301}], "rows": []},
            "el encabezado de la columna 1 no es válido (máximo 300 caracteres).",
        ),
        (
            {"columns": [{"label": "A"}], "rows": [["a", "b"]]},
            "la fila 1 no coincide con las columnas.",
        ),
        (
            {"columns": [{"label": "A"}], "rows": [["x" * 301]]},
            "la celda de la fila 1, columna 1 no es válida (máximo 300 caracteres).",
        ),
        (
            {"columns": [{"label": "A"}], "rows": [[{"html": "<b>"}]]},
            "la celda de la fila 1, columna 1 no es válida (máximo 300 caracteres).",
        ),
    ],
)
def test_table_problem(value, problem):
    assert table_problem(value, LIMITS) == problem


def test_validate_blocks_uses_the_manifest_limits():
    assert (
        validate_blocks([{"type": "table", "props": {"title": "Cuotas", "table": table()}}])[0][
            "type"
        ]
        == "table"
    )
    with pytest.raises(Exception) as exc:
        validate_blocks([{"type": "table", "props": {"table": table(cols=9)}}])
    assert "hasta 8 columnas" in str(exc.value)
    with pytest.raises(Exception) as exc:
        validate_blocks([{"type": "table", "props": {"title": "Sin tabla"}}])
    # Named with the editor's labels (C3), never with the prop key.
    assert 'Sección 1 (Tabla), campo «Tabla»: falta este dato.' in str(exc.value)


def test_a_table_on_the_pagos_page_publishes(api_client):
    api_client.force_authenticate(user=AdminFactory())
    blocks = [
        {"id": "pagos-1", "type": "pagos.hero", "props": {"title": "Colegiaturas y cafetería"}},
        {
            "id": "t1",
            "type": "table",
            "props": {
                "title": "Fechas de pago",
                "table": table(cols=3, rows=4, highlight=0),
                "card": True,
            },
        },
    ]
    res = api_client.post(
        reverse("admin-pages"),
        {"slug": "pagos", "title": "Pagos", "draft_blocks": blocks},
        format="json",
    )
    assert res.status_code == 201, res.data
    page = Page.objects.get(slug="pagos")
    assert (
        api_client.post(
            # The draft leaves out the design's «Plataformas» section: a «large change», acknowledged.
            reverse("admin-page-publish", args=[page.pk]),
            {"action": "publish", "acknowledge_warnings": True},
            format="json",
        ).status_code
        == 200
    )
    api_client.force_authenticate(user=None)
    public = api_client.get(reverse("cms-page", args=["pagos"])).data
    assert public["blocks"][1]["props"]["table"]["rows"][0] == ["0", "1", "2"]
