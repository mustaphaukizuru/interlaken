from rest_framework import serializers

from .models import SiteSettings


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = [
            'phone_display', 'phone_e164', 'whatsapp_number', 'contact_email',
            'address', 'maps_url', 'office_hours',
            'facebook_url', 'instagram_url', 'youtube_url',
            'updated_at',
        ]
        read_only_fields = fields
