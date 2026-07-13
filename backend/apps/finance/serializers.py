"""finance/serializers.py — DRF serializers for tuition invoices & admin finance."""
from decimal import Decimal

from rest_framework import serializers

from .models import (Discount, FeeSchedule, Invoice, InvoiceAdjustment,
                     InvoiceLineItem)


class FeeScheduleSerializer(serializers.ModelSerializer):
    """Admin CRUD for tuition plans (Planes de Colegiatura)."""
    class Meta:
        model = FeeSchedule
        fields = ['id', 'name', 'level', 'grade', 'monthly_amount', 'currency',
                  'due_day', 'late_fee_type', 'late_fee_amount', 'late_fee_grace_days',
                  'active', 'updated_at']
        read_only_fields = ['id', 'updated_at']


class DiscountSerializer(serializers.ModelSerializer):
    """Admin CRUD for per-student becas / descuentos."""
    class Meta:
        model = Discount
        fields = ['id', 'student', 'name', 'kind', 'method', 'value', 'active',
                  'start_period', 'end_period', 'note', 'created_at']
        read_only_fields = ['id', 'created_at']


class InvoiceLineItemSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = InvoiceLineItem
        fields = ['id', 'kind', 'kind_display', 'description', 'amount']


class InvoiceSerializer(serializers.ModelSerializer):
    line_items = InvoiceLineItemSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    period_label = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()
    student_name = serializers.CharField(source='student.user.full_name', read_only=True)
    student_id = serializers.IntegerField(source='student.id', read_only=True)
    student_code = serializers.CharField(source='student.student_id', read_only=True)
    grade = serializers.CharField(source='student.grade', read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'student_id', 'student_name', 'student_code', 'grade',
            'period', 'period_label', 'issue_date', 'due_date', 'currency',
            'subtotal', 'discount_total', 'late_fee_total', 'amount', 'amount_paid',
            'balance_due', 'status', 'status_display', 'paid_at', 'notes',
            'created_at', 'line_items',
        ]

    def get_period_label(self, obj):
        from .services import _period_label
        return _period_label(obj.period)

    def get_balance_due(self, obj):
        return f'{obj.balance_due:.2f}'


class InvoiceListSerializer(serializers.ModelSerializer):
    """Lighter serializer for list views (no line items)."""
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    period_label = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()
    student_name = serializers.CharField(source='student.user.full_name', read_only=True)
    student_id = serializers.IntegerField(source='student.id', read_only=True)
    student_code = serializers.CharField(source='student.student_id', read_only=True)
    grade = serializers.CharField(source='student.grade', read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'student_id', 'student_name', 'student_code', 'grade',
            'period', 'period_label', 'due_date', 'amount', 'amount_paid',
            'balance_due', 'status', 'status_display', 'currency',
        ]

    def get_period_label(self, obj):
        from .services import _period_label
        return _period_label(obj.period)

    def get_balance_due(self, obj):
        return f'{obj.balance_due:.2f}'


class InvoicePayInputSerializer(serializers.Serializer):
    gateway = serializers.CharField(required=False, allow_blank=True)


class AdjustInvoiceInputSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    reason = serializers.CharField(max_length=255)

    def validate_amount(self, value):
        if value == Decimal('0'):
            raise serializers.ValidationError('El monto no puede ser cero.')
        return value


class MarkPaidInputSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True)
    method = serializers.CharField(max_length=40, required=False, allow_blank=True)


class CancelInvoiceInputSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class GenerateInvoicesInputSerializer(serializers.Serializer):
    period = serializers.RegexField(r'^\d{4}-\d{2}$', required=False, allow_blank=True)


class InvoiceAdjustmentSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)
    admin_name = serializers.CharField(source='admin.full_name', read_only=True, default='')

    class Meta:
        model = InvoiceAdjustment
        fields = ['id', 'kind', 'kind_display', 'amount', 'reason', 'admin_name',
                  'status_after', 'amount_after', 'amount_paid_after', 'created_at']


class FeeScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeSchedule
        fields = ['id', 'name', 'level', 'grade', 'monthly_amount', 'currency',
                  'due_day', 'late_fee_type', 'late_fee_amount', 'late_fee_grace_days',
                  'active']


class DiscountSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = Discount
        fields = ['id', 'student', 'name', 'kind', 'kind_display', 'method', 'value',
                  'active', 'start_period', 'end_period', 'note']
