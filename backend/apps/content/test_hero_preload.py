"""The home hero's preload: srcset candidates are separated by spaces, so a
poster whose file name has one is encoded (QA 2026-11-23)."""

from apps.content.pages import hero_preload


def _hero(poster):
    return [{"id": "h", "type": "home.hero", "props": {"title": "x", "poster": poster}}]


def test_plain_name():
    assert hero_preload(_hero("/assets/court-wide.webp")) == {
        "href": "/assets/court-wide.webp",
        "srcset": "/assets/court-wide-480.webp 480w, /assets/court-wide-960.webp 960w, /assets/court-wide.webp 1600w",
        "sizes": hero_preload(_hero("/assets/court-wide.webp"))["sizes"],
    }


def test_name_with_spaces_is_encoded():
    out = hero_preload(_hero("/assets/interlaken-image (1).webp"))
    assert out["href"] == "/assets/interlaken-image%20(1).webp"
    assert out["srcset"].split(", ") == [
        "/assets/interlaken-image%20(1)-480.webp 480w",
        "/assets/interlaken-image%20(1)-960.webp 960w",
        "/assets/interlaken-image%20(1).webp 1600w",
    ]


def test_library_images_are_left_alone():
    assert hero_preload(_hero(42)) is None
