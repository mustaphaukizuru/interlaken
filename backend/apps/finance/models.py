"""
finance — retired.

Tuition (colegiatura) and enrollment (inscripción) billing are NOT part of the
app: the cafetería wallet (apps.cafeteria + apps.payments) is the only money
path. This package is kept solely so the migration graph stays linear;
migration 0006 drops the old tuition tables from the live database. Add no
models here.
"""
