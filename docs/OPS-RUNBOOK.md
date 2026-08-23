# Runbook de operación

Qué vigilar, qué hacer cuando algo falla y cómo probar que los respaldos sirven. Complementa docs/DEPLOY_HOSTINGER_VPS.md (instalación) y docs/RETENTION.md (datos).

## 1. Sentry (errores en producción)

Activación, una sola vez:

1. Cree un proyecto **Django** y otro **React** en sentry.io (plan gratuito basta).
2. En el VPS, `/opt/interlaken/deploy/.env`:
   ```
   SENTRY_DSN=https://…@o…ingest.sentry.io/…          # proyecto Django
   SENTRY_ENVIRONMENT=production
   SENTRY_TRACES_SAMPLE_RATE=0.1
   VITE_SENTRY_DSN=https://…@o…ingest.sentry.io/…     # proyecto React (se inyecta en el build)
   ```
3. `./deploy.sh`. El backend reporta con la versión desplegada (`SENTRY_RELEASE` = commit) y el frontend solo carga el SDK cuando hay DSN (no afecta el presupuesto de rendimiento).
4. Compruebe: en Sentry → Issues debe aparecer el evento de prueba `python manage.py shell -c "1/0"` (ejecútelo dentro del contenedor y luego cierre el issue).
5. Alertas: Sentry → Alerts → "Issue alert" → *when a new issue is created* → correo a `sistemas@interlaken.com.mx` (OPS_EMAIL).

## 2. Disponibilidad (uptime)

`https://interlaken.edu.mx/healthz` responde 200 cuando base de datos y caché contestan, 503 si no.

- Monitor externo: UptimeRobot (gratis) → HTTP(s) → URL anterior, intervalo 5 min, alerta por correo a `sistemas@` y WhatsApp/SMS si lo contrata. Registre también `https://interlaken.edu.mx/` (tipo *keyword*, palabra "Interlaken") para detectar un frontend roto con backend sano.
- Monitor interno: el cron de cafetería avisa por correo si la sincronización con Loyverse lleva 30 min sin correr (deploy/crontab.example).
- Métricas de negocio: `/admin` muestra colas (admisiones, recargas, contraseñas, mensajes, formularios, ARCO); `/staff` la analítica.

## 3. Respaldos y simulacro de restauración

- Respaldo diario 03:00 (`backup-db.sh`, retención 30 días en `/var/backups/interlaken`) y copia fuera del servidor según DEPLOY_HOSTINGER_VPS.md.
- **Simulacro mensual** (cron, primer domingo 04:00): `restore-db.sh <último dump>` restaura en una base temporal, imprime conteos (usuarios, alumnos, movimientos, páginas) y la borra. Si falla, el correo del cron lo dice: un respaldo que no restaura no es respaldo.
- Restauración real (pérdida de datos, migración fallida):
  ```bash
  cd /opt/interlaken/deploy
  ./backup-db.sh                                   # respaldo del estado actual, por si acaso
  ls -t /var/backups/interlaken | head            # elija el dump
  ./restore-db.sh /var/backups/interlaken/db-AAAA-MM-DD-HHMM.sql.gz --into-live
  ```
  Detiene `app`, carga el dump, reinicia y muestra los conteos. Tiempo esperado: menos de 2 minutos con la base actual.
- Archivos subidos (media: avatares, documentos, biblioteca del CMS) viven en el volumen `media` o en Supabase Storage si está configurado; el dump de Postgres no los incluye. Con Supabase activo el bucket es la copia durable.

## 4. Incidentes frecuentes

| Síntoma | Causa probable | Acción |
|---|---|---|
| `/healthz` 503, sitio caído | DB o Redis sin responder | `docker compose ps`, `docker compose logs --tail=100 app db`; `docker compose restart` |
| Deploy nuevo no levanta | migración fallida | `deploy.sh` imprime el comando de rollback; ejecútelo y abra el log de `app` |
| Familias no reciben correos | buzón/credenciales SMTP | `python manage.py send_test_email <correo>`; revise `EMAIL_*` en .env y el reporte de entrega del comunicado |
| Saldos de cafetería desactualizados | token Loyverse vencido | `/admin/cafeteria` → Sincronizar todo; si falla, renueve `LOYVERSE_TOKEN` |
| Push no llega en iPhone | app no instalada en pantalla de inicio | pedir instalar (InstallHint) y activar avisos en Mi perfil |
| Certificado TLS | Caddy sin email o puerto 80 cerrado | `docker compose logs caddy`, `ACME_EMAIL` en .env, firewalld 80/443 |

## 5. Calendario de operación

| Cuándo | Qué |
|---|---|
| Cada 5 min | sync Loyverse, `cms_schedule` (páginas y comunicados programados) |
| Diario 03:00 / 06:15 | respaldo DB / recordatorios, alertas de saldo, pagos vencidos, despacho de notificaciones |
| Semanal dom 05:00 | `purge_retention --apply` |
| Mensual 1er dom 04:00 | `restore-db.sh` (simulacro) |
| Anual (julio) | `/admin/nuevo-ciclo`; revisar docs/RETENTION.md con Dirección |
