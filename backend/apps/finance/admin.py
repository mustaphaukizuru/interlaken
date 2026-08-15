# Intentionally empty: the school does NOT bill tuition through the app.
#
# The finance models (FeeSchedule, Discount, Invoice, InvoiceLineItem,
# InvoicePayment, InvoiceAdjustment) remain installed so the migration graph,
# FK constraints and any historical rows in the live database stay stable, but
# they are dormant — no admin registration, no API URLs, no crons. If tuition
# billing is ever reconsidered, restore the registrations from git history.
