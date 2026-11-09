"""JSON request bodies are objects (pre-launch fix, 2026-11-09).

Every endpoint reads ``request.data`` as a dict (``.get``). A top-level JSON
array, string or number made that raise ``AttributeError``: a 500, and a Sentry
alert, for a junk request (scanners probe public forms this way). No client
of this API sends anything but an object, so anything else is a 400 here.
"""
from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser


class ObjectJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        data = super().parse(stream, media_type, parser_context)
        if not isinstance(data, dict):
            raise ParseError('El cuerpo JSON debe ser un objeto.')
        return data
