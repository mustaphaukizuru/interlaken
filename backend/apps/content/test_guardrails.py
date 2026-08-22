import pytest
from django.contrib.admin.sites import site
from django.core.cache import cache
from django.urls import reverse

from apps.content.forms import FormDefinition
from apps.content.pages import PAGE_CACHE, Page
from apps.core.models import AuditLog


@pytest.mark.django_db
def test_publish_is_audited_and_busts_cache(admin_user, client):
    cache.clear()
    p = Page.objects.create(slug='g', title='G', draft_blocks=[{'id': 'a', 'type': 'rich_text', 'props': {'html': '<p>v1</p>'}}])
    p.publish(admin_user)
    assert client.get(reverse('cms-page', args=['g'])).data['blocks'][0]['props']['html'] == '<p>v1</p>'
    assert cache.get(PAGE_CACHE.format(slug='g')) is not None
    p.draft_blocks[0]['props']['html'] = '<p>v2</p>'
    p.save()
    p.publish(admin_user)
    assert cache.get(PAGE_CACHE.format(slug='g')) is None
    assert client.get(reverse('cms-page', args=['g'])).data['blocks'][0]['props']['html'] == '<p>v2</p>'
    assert AuditLog.objects.filter(context='cms.publish', actor=admin_user).count() == 2


@pytest.mark.django_db
def test_form_submit_rate_limited(client, settings):
    settings.RATELIMIT_ENABLE = True
    cache.clear()
    FormDefinition.objects.create(slug='f', title='F', fields=[{'key': 'n', 'label': 'N', 'type': 'text'}], consent_text='')
    url = reverse('cms-form-submit', args=['f'])
    codes = [client.post(url, {'n': 'x'}, content_type='application/json').status_code for _ in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


def test_content_models_read_only_in_django_admin():
    from apps.content.forms import FormDefinition, FormSubmission
    from apps.content.media import MediaAsset
    from apps.content.navigation import Redirect
    from apps.content.pages import Page, PageVersion

    for model in (Page, PageVersion, MediaAsset, FormDefinition, FormSubmission, Redirect):
        ma = site._registry[model]
        assert not ma.has_add_permission(None) and not ma.has_change_permission(None) and not ma.has_delete_permission(None)
