"""factory-boy factories for the payments app."""

from decimal import Decimal

import factory

from apps.accounts.factories import ParentFactory

from .models import Payment


class PaymentFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Payment

    user = factory.SubFactory(ParentFactory)
    payment_type = Payment.Type.TUITION
    amount = Decimal("1000.00")
    currency = "MXN"
    status = Payment.Status.PENDING
