from rest_framework import serializers

from .models import (
    DaycareRate,
    EnrollmentFee,
    ExtracurricularActivity,
    FixedConcept,
    PricingPolicy,
    SiteSettings,
    TuitionCost,
)


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


class AdminSiteSettingsSerializer(serializers.ModelSerializer):
    """Writable settings for the admin CMS editor (public data on the marketing site)."""
    class Meta:
        model = SiteSettings
        fields = [
            'phone_display', 'phone_e164', 'whatsapp_number', 'contact_email',
            'address', 'maps_url', 'office_hours',
            'facebook_url', 'instagram_url', 'youtube_url', 'updated_at',
        ]
        read_only_fields = ['updated_at']


class TuitionCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = TuitionCost
        fields = ['section', 'inscripcion', 'colegiatura', 'order']
        read_only_fields = fields


class EnrollmentFeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = EnrollmentFee
        fields = ['section', 'modality', 'gastos_administrativos', 'cuota', 'order']
        read_only_fields = fields


class FixedConceptSerializer(serializers.ModelSerializer):
    class Meta:
        model = FixedConcept
        fields = ['name', 'cost', 'mandatory', 'order']
        read_only_fields = fields


class ExtracurricularSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtracurricularActivity
        fields = ['name', 'levels', 'annual_cost', 'order']
        read_only_fields = fields


class DaycareRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DaycareRate
        fields = ['schedule', 'service', 'daily_cost', 'monthly_cost', 'monthly_note', 'order']
        read_only_fields = fields


class PricingPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = PricingPolicy
        fields = ['text', 'order']
        read_only_fields = fields
