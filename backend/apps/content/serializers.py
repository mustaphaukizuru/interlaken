from rest_framework import serializers

from .models import (
    DaycareRate,
    EnrollmentFee,
    ExtracurricularActivity,
    FixedConcept,
    PricingPolicy,
    SchoolEvent,
    SiteSettings,
    Testimonial,
    TuitionCost,
)


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = [
            'phone_display', 'phone_e164', 'whatsapp_number', 'contact_email',
            'address', 'maps_url', 'office_hours', 'video_url', 'hero_video_url',
            'facebook_url', 'instagram_url', 'youtube_url', 'menu', 'chrome', 'sep_incorporations', 'school_year',
            'admissions_next_from_month', 'pricing_years',
            # Public on purpose: the texts that say who sees a child's
            # allergies (family privacy page, student form) follow it.
            'cafeteria_shows_allergies', 'updated_at',
        ]
        read_only_fields = fields


class AdminSiteSettingsSerializer(serializers.ModelSerializer):
    """Writable settings for the admin CMS editor (public data on the marketing site)."""
    class Meta:
        model = SiteSettings
        fields = [
            'phone_display', 'phone_e164', 'whatsapp_number', 'contact_email',
            'address', 'maps_url', 'office_hours', 'video_url', 'hero_video_url',
            'facebook_url', 'instagram_url', 'youtube_url', 'menu', 'chrome', 'sep_incorporations', 'school_year',
            'admissions_public_start', 'admissions_next_from_month', 'pricing_years', 'families_upload_photos',
            # Admin only (never in SiteSettingsSerializer): internal mailboxes.
            'cafeteria_shows_allergies', 'billing_emails', 'updated_at',
        ]
        # The price years change only through «Costos y precios» (audited, per group).
        read_only_fields = ['pricing_years', 'updated_at']

    def validate_sep_incorporations(self, value):
        if not isinstance(value, list) or len(value) > 6:
            raise serializers.ValidationError('Debe ser una lista (máx. 6).')
        out = []
        for r in value:
            level, label = (r or {}).get('level', ''), (r or {}).get('label', '')
            if level not in ('Preescolar', 'Primaria', 'Secundaria') or not str(label).strip():
                raise serializers.ValidationError('Cada registro necesita nivel (Preescolar/Primaria/Secundaria) y texto.')
            out.append({'level': level, 'label': str(label).strip()[:200]})
        return out

    def validate_billing_emails(self, value):
        from apps.core.facturacion import clean_recipients

        try:
            return clean_recipients(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from None

    def validate_phone_e164(self, value):
        return self._phone(value, 'phone_e164')

    def validate_whatsapp_number(self, value):
        return self._phone(value, 'whatsapp_number')

    def _phone(self, value, field):
        # The dialled number and the wa.me number follow core.phones; the
        # saved value is accepted as it is (the form sends every field).
        from apps.core.phones import check_phone

        return check_phone(value, current=getattr(self.instance, field, None))

    def validate_menu(self, value):
        from .navigation import validate_menu
        return validate_menu(value)

    def validate_chrome(self, value):
        from .navigation import validate_chrome
        return validate_chrome(value)


class TuitionCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = TuitionCost
        # `inscripcion` is no longer published: the fee lives in EnrollmentFee
        # («Inscripción y reinscripción», edited in /admin/costos). The old
        # column was shown nowhere and kept stale 2026 amounts.
        fields = ['section', 'colegiatura', 'order']
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


class SchoolEventSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = SchoolEvent
        fields = ['id', 'title', 'kind', 'kind_label', 'start_date', 'end_date', 'level',
                  'description', 'is_published', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if start and end and end < start:
            raise serializers.ValidationError({'end_date': 'La fecha final no puede ser anterior al inicio.'})
        return attrs


class TestimonialSerializer(serializers.ModelSerializer):
    class Meta:
        model = Testimonial
        fields = ['id', 'quote', 'author', 'role', 'level', 'is_published', 'order', 'created_at']
        read_only_fields = ['id', 'created_at']
