"""
Request-id middleware (apps/core/request_id.py): every response carries an
X-Request-ID, inbound ids are propagated (sanitised), and log records get the
id injected by RequestIDFilter.
"""
import logging

import pytest

from apps.core.request_id import RequestIDFilter

pytestmark = pytest.mark.django_db

URL = '/healthz'


class TestRequestIDMiddleware:
    def test_response_carries_generated_request_id(self, api_client):
        resp = api_client.get(URL)
        rid = resp['X-Request-ID']
        assert rid and rid != '-'
        assert len(rid) >= 8

    def test_inbound_request_id_is_echoed(self, api_client):
        resp = api_client.get(URL, HTTP_X_REQUEST_ID='proxy-abc-123')
        assert resp['X-Request-ID'] == 'proxy-abc-123'

    def test_unsafe_characters_are_stripped(self, api_client):
        resp = api_client.get(URL, HTTP_X_REQUEST_ID='weird id!!$$')
        assert resp['X-Request-ID'] == 'weirdid'

    def test_overlong_inbound_id_is_truncated(self, api_client):
        resp = api_client.get(URL, HTTP_X_REQUEST_ID='a' * 200)
        assert resp['X-Request-ID'] == 'a' * 64


class TestRequestIDFilter:
    def test_filter_stamps_request_id_attribute(self):
        record = logging.LogRecord('t', logging.INFO, __file__, 1, 'msg', (), None)
        assert RequestIDFilter().filter(record) is True
        # Outside a request cycle the placeholder id is used.
        assert record.request_id == '-'
