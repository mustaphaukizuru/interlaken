"""
core/backup_storage.py: the S3 storage that holds ONLY encrypted database dumps.

Separate from ``apps.core.backups`` so importing the helpers (the console, the
morning check) does not load boto3.

django-storages fills every option it is not given from the global ``AWS_*``
settings and environment variables, which belong to the MEDIA bucket. This
subclass replaces all of them with ``BACKUP_S3_*`` values or fixed safe ones,
so nothing about the media bucket (its name, keys, prefix, custom domain, ACL,
public URL settings) can leak into the backup copy.

Privacy: the bucket must be private and dedicated to backups (the runbook
creates it that way). No per-object ACL header is sent, because Cloudflare R2
does not implement ``x-amz-acl`` and AWS buckets with ACLs disabled reject it;
privacy is the bucket's, and the content is GPG ciphertext regardless. Backups
never get a URL: ``url()`` raises.
"""

from django.conf import settings
from storages.backends.s3 import S3Storage


class BackupS3Storage(S3Storage):
    def get_default_settings(self):
        defaults = super().get_default_settings()
        defaults.update(
            {
                "bucket_name": settings.BACKUP_S3_BUCKET,
                "access_key": settings.BACKUP_S3_ACCESS_KEY_ID,
                "secret_key": settings.BACKUP_S3_SECRET_ACCESS_KEY,
                "security_token": None,
                "session_profile": None,
                "endpoint_url": settings.BACKUP_S3_ENDPOINT_URL or None,
                "region_name": settings.BACKUP_S3_REGION or None,
                "location": (settings.BACKUP_S3_PREFIX or "").strip("/"),
                "default_acl": None,
                "object_parameters": {},
                "querystring_auth": True,
                "custom_domain": None,
                "cloudfront_key_id": None,
                "cloudfront_key": None,
                # Same name = same night's dump re-run: replace it, never invent
                # a suffixed name that rotation would not recognise.
                "file_overwrite": True,
                "gzip": False,
                # Path-style works on every S3-compatible provider (R2, B2, MinIO).
                "addressing_style": "path",
                "signature_version": "s3v4",
                "client_config": None,
                "proxies": None,
                "use_ssl": True,
                "verify": None,
                "transfer_config": None,
                "max_memory_size": 0,
            }
        )
        return defaults

    def url(self, name, parameters=None, expire=None, http_method=None):
        raise NotImplementedError("Database backups are never given a URL.")
