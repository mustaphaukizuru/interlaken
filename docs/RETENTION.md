# Política de retención de datos

Base legal: LFPDPPP y su Reglamento (México); obligaciones fiscales (CFF art. 30: 5 años) y escolares (SEP: expedientes mientras el alumno esté inscrito y el plazo de conservación aplicable). Responsable: Dirección. Contacto ARCO: `privacidad@interlaken.com.mx` (ver docs/PRIVACY.md y el Aviso de Privacidad).

## Qué se conserva y por cuánto tiempo

| Dato | Conservación | Acción al vencer | Automático |
|---|---|---|---|
| Expediente del alumno (perfil, tutores, datos médicos cifrados) | Mientras esté inscrito + 5 años | Revisión humana (`report_retention`) | No |
| Monedero de cafetería: saldos, consumos, recargas, pagos | 5 años (fiscal) | Nunca se borra automáticamente | No |
| Auditoría (AuditLog) | 5 años | Revisión humana | No |
| Pre-registros y solicitudes de inscripción **rechazadas** | 12 meses desde el rechazo | Anonimizar contacto y nombre; borrar documentos adjuntos | Sí |
| Documentos de inscripción de solicitudes rechazadas | 12 meses | Borrar archivo | Sí |
| Envíos de formularios del sitio atendidos | 6 meses | Borrar | Sí |
| Mensajes de contacto atendidos | 6 meses | Borrar | Sí |
| Notificaciones del portal ya leídas | 90 días | Borrar | Sí |
| Historial de inicios de sesión | 12 meses | Borrar | Sí |
| Reservas de visitas | 24 meses | Anonimizar contacto | Sí |
| Tokens de sesión caducados | Inmediato | Borrar | Sí |
| Respaldos de base de datos | 30 días rotativos (deploy/backup-db.sh) | Rotación | Sí |
| Logs del servidor (Caddy, Docker) | 14 días (logrotate) | Rotación | Sí |

Ventanas configurables en `settings.RETENTION` (días) sin tocar código.

## Cómo se ejecuta

- `python manage.py purge_retention` muestra qué se purgaría (simulación).
- `python manage.py purge_retention --apply` ejecuta en una transacción y deja un registro en Auditoría (`retention.purge`) con los conteos.
- Cron semanal (deploy/crontab.example, domingos 05:00).
- `python manage.py report_retention` sigue siendo el reporte para los registros que requieren decisión humana (alumnos dados de baja, expedientes).

## Principios

1. Lo que tenga obligación fiscal o ARCO pendiente no se borra solo.
2. Anonimizar antes que borrar cuando la estadística agregada tiene valor (embudo de admisión).
3. Cada purga queda auditada con conteos y ventanas aplicadas.
4. Los respaldos se ciñen a la misma política: al vencer la rotación el dato desaparece también de los respaldos.
