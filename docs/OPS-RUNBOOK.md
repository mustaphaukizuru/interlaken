# Runbook de operación

Qué vigilar, qué hacer cuando algo falla y cómo probar que los respaldos sirven. Complementa docs/DEPLOY_HOSTINGER_VPS.md (instalación) y docs/RETENTION.md (datos).

## 1. Sentry (errores en producción)

Apagado mientras `SENTRY_DSN` y `VITE_SENTRY_DSN` estén vacíos en `/opt/interlaken/deploy/.env`. La guía de activación paso a paso (cuenta y región US, los dos proyectos, variables, prueba, regla de correo para errores nuevos y qué datos se envían) está en [docs/SENTRY.md](SENTRY.md). En corto: dos proyectos (Django y React), los dos DSN en `.env`, `./deploy.sh`, y una alerta *A new issue is created* que mande correo. La versión de cada error es el commit desplegado (`deploy.sh` la pasa sola) y el frontend solo carga el SDK cuando hay DSN (no afecta el presupuesto de rendimiento).

## 2. Disponibilidad (uptime)

`https://interlaken.edu.mx/healthz` responde 200 cuando base de datos y caché contestan, 503 si no.

- Monitor externo (activo desde 29-10-2026): `.github/workflows/uptime.yml` corre en GitHub cada 10 min, fuera del VPS, y revisa que `interlaken.edu.mx` y `www` apunten al VPS (DNS), que `/healthz` diga `ok`, que `/login` cargue y que el certificado TLS dure más de 14 días. Tres fallas seguidas abren un issue con la etiqueta `site-down` (GitHub avisa por correo al dueño del repositorio); al recuperarse, el issue se cierra solo con un comentario. Nació de la caída del 23-10-2026: alguien cambió los registros A en Akky y nadie lo supo hasta que las familias no pudieron entrar. Si se quiere además WhatsApp/SMS, UptimeRobot sobre la misma URL sigue siendo opción.
- GitHub pausa los workflows programados de un repositorio público tras 60 días sin commits: si el repo queda quieto tanto tiempo, reactive *Uptime* y *Database backup* en la pestaña Actions.
- Monitor interno: el cron de cafetería avisa por correo si la sincronización con Loyverse lleva 30 min sin correr (deploy/crontab.example).
- Webhook de Loyverse: `check_loyverse_webhook` (cada hora, solo lectura) confirma que el webhook de recibos con la URL secreta siga **ENABLED** y nombra cualquier otro webhook que apunte a este dominio (la raíz responde 403 y la ruta sin la clave 401: solo pueden fallar). Avisa por correo una vez por problema, semanal mientras siga. La clave nunca aparece en el correo ni en el log.
- Métricas de negocio: `/admin` muestra colas (admisiones, recargas, contraseñas, mensajes, formularios, ARCO); `/staff` la analítica.
- El admin técnico de Django (Unfold) vive en `/django-admin/` desde el 23-09-2026. Antes compartía `/admin/` con la consola React: recargar `/admin/cafeteria` mandaba al login de Django y esas páginas recibían la política de seguridad estricta que bloquea la foto de Google del usuario.

## 3. Respaldos y simulacro de restauración

- Respaldo diario 02:30 (`backup-db.sh`, retención 30 días en `/var/backups/interlaken`, legible solo por el usuario del respaldo).
- Copia fuera del servidor, **siempre cifrada con GPG** a `deploy/backup-public-key.asc`: justo después del respaldo, `backup-db.sh` cifra el volcado y sube **solo el archivo cifrado** (`db-AAAA-MM-DD-HHMM.sql.gz.gpg`) a un bucket privado dedicado (`BACKUP_S3_*` en `deploy/.env`; nunca el bucket de archivos del sitio). Se conservan los 30 más recientes. Hasta configurarlo, la consola muestra «Sin copia externa». Cómo crear el bucket y la llave de acceso, y cómo restaurar desde la copia externa: docs/DEPLOY_HOSTINGER_VPS.md, sección *Off-site copy*.
- Segunda copia independiente: `.github/workflows/db-backup.yml` (artifact de GitHub de 30 días, cifrado igual). Está **desactivado**; encenderlo es decisión del dueño.
- La llave privada **no está en GitHub**: la guarda el administrador (gestor de contraseñas) y hay una copia en el VPS en `/root/.interlaken-backup-PRIVATE-key.asc` (solo root). Sin ella las copias externas no sirven; no la pegue en chats ni correos. Para usar una copia externa:
  ```bash
  gpg --import interlaken-backup-PRIVATE-key.asc      # una sola vez por máquina
  gpg --decrypt db-AAAA-MM-DD-HHMM.sql.gz.gpg > db-AAAA-MM-DD-HHMM.sql.gz
  ./restore-db.sh db-AAAA-MM-DD-HHMM.sql.gz          # simulacro; --into-live para la real
  ```
- **Simulacro mensual** (cron, primer domingo 04:00): `restore-db.sh <último dump>` restaura en una base temporal, imprime conteos (usuarios, alumnos, movimientos, páginas) y la borra. Cada corrida se registra en la app (`record_restore_drill`): si falla, correo inmediato a los administradores; si deja de correr más de 40 días, `check_backup_fresh` avisa una vez. Un respaldo que no restaura no es respaldo: del 04-10 al 29-10-2026 fallaba en silencio porque el dump (solo esquema `public`) no trae las extensiones `unaccent` y `pg_trgm`; `restore-db.sh` ahora las recrea alrededor del esquema, y borra la base temporal con `WITH (FORCE)` porque el pooler de Supabase deja una conexión abierta.
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
| `deploy.sh` termina con "DEPLOY FAILED: a money query FAILS" | una consulta con bloqueo de fila (`select_for_update`) que PostgreSQL rechaza; las pruebas en SQLite no lo ven (así falló «Verificar en MultiCobros» el 18-11-2026) | el sitio está arriba con la versión nueva, pero esa pantalla de pagos, recargas o acción masiva responde 500: ejecute el comando de rollback que imprime `deploy.sh`, revierta el commit en master y vea el detalle con `docker compose exec -T app python manage.py check_money_queries -v 2` (solo lectura, se puede correr en cualquier momento) |
| Familias no reciben correos | buzón/credenciales SMTP | `python manage.py send_test_email <correo>`; revise `EMAIL_*` en .env y el reporte de entrega del comunicado |
| Saldos de cafetería desactualizados | token Loyverse vencido | `/admin/cafeteria` → Sincronizar todo; si falla, renueve `LOYVERSE_TOKEN` |
| Cambios hechos en Loyverse (grado, nombre, código) no aparecen en la app; luz *Roster* en rojo | el `sync_roster` de las 06:07 no corrió (crontab viejo o sin reinstalar) | `/admin/cafeteria` → Sincronizar roster ahora; en el servidor `crontab -l` debe mostrar `7 6 * * *` con `flock -w 900`; si no, reinstale el crontab (§7c) |
| Push no llega en iPhone | app no instalada en pantalla de inicio | pedir instalar (InstallHint) y activar avisos en Mi perfil |
| Certificado TLS | Caddy sin email o puerto 80 cerrado | `docker compose logs caddy`, `ACME_EMAIL` en .env, firewalld 80/443 |
| Issue `site-down` con "DNS: … resolves to …" | registros A cambiados en Akky (23-10-2026 apuntaron al hosting compartido de Hostinger) | en akky.mx los registros `@` y `www` deben ser A 93.188.162.163. El panel DNS de Hostinger no cuenta (los nameservers son de Akky). Nunca aceptar el "cambie su DNS a 212.1.209.25" que muestra el plan de hosting web de Hostinger |
| Los avisos programados llegan a otra hora (el reporte de las 07:05 a la 01:05, el resumen de las 18:00 al mediodía) | el reloj del servidor no está en hora de México: el cron de Ubuntu ignora `CRON_TZ` y usa el del sistema (así estuvo hasta el 29-10-2026) | `sudo timedatectl set-timezone America/Mexico_City && sudo systemctl restart cron`; `deploy.sh` avisa si vuelve a pasar |
| Correo "revisar el webhook de Loyverse" | Loyverse desactivó el webhook tras entregas fallidas, o alguien creó uno a mano | en Loyverse active el webhook de `receipts` que termina en `/loyverse/webhook/…/` y borre los demás de este dominio. No cree webhooks a mano: la URL correcta lleva la clave secreta del servidor |

## 5. Calendario de operación

Horas de la Ciudad de México (el reloj del servidor debe estar en esa zona, ver §4).

| Cuándo | Qué |
|---|---|
| Cada 5 min | sync Loyverse, `cms_schedule` (páginas y comunicados programados) |
| Cada 10 min (GitHub) | `uptime.yml`: DNS, `/healthz`, `/login`, certificado |
| Cada hora :50 | `check_loyverse_webhook` |
| Diario 02:30 / 06:15 | respaldo DB en el VPS y su copia externa cifrada (`BACKUP_S3_*`) / recordatorios, alertas de saldo, pagos vencidos, despacho de notificaciones |
| Diario 05:42 / 06:07 | `sync_purchases --since-days 7` (repaso de recibos) / `sync_roster` (roster desde Loyverse: altas, grado, nombre, código; ver §7b) |
| Semanal dom 05:00 | `purge_retention --apply` |
| Mensual 1er dom 04:00 | `restore-db.sh` (simulacro) |
| Anual (julio) | `/admin/nuevo-ciclo`; revisar docs/RETENTION.md con Dirección |

## 6. Cambio de ciclo escolar: altas, bajas y grados

Loyverse (el POS de la cafetería) es la fuente de verdad del alumnado: ahí la
escuela da de alta a cada alumno nuevo, actualiza su grado y **borra el cliente
cuando el alumno se va**. La app se alinea con Loyverse en tres pasos, todos
desde **Admin → Alumnos**, todos con vista previa antes de aplicar.

1. **Altas y grados: `Importar desde Loyverse`.** Crea a los alumnos nuevos
   (con su saldo inicial tomado de Loyverse) y actualiza nombre y grado de los
   existentes. Ejecútelo al inicio del ciclo y cada vez que haya inscripciones.
   Es idempotente: repetirlo no duplica a nadie.
2. **Bajas: Alumnos → aviso "Revisarlos" (filtro `Sin cliente en Loyverse`).**
   Son los alumnos activos cuyo cliente ya no existe en Loyverse: en la
   práctica, egresados y bajas. Muestra grado y **saldo restante**. Seleccione
   a todos y use *Eliminar definitivamente*: el sistema borra solo a quien
   nunca entró al portal y no tiene saldo ni historial, y dice por qué omite a
   los demás. A esos use *Dar de baja*: quedan en la pestaña "Baja definitiva" y
   se pueden reactivar. La baja no toca el saldo: si queda dinero, decida la
   devolución aparte (Cafetería → Ajustes / Devoluciones).
3. **Etiqueta del ciclo: `Nuevo ciclo`.** Cambia el ciclo que muestra el sitio,
   marca como egresados a 3° de Secundaria y, opcionalmente, reinicia el umbral
   de saldo bajo. Cuando el alumnado está vinculado a Loyverse el asistente
   **no promueve grados** (ya vienen de la importación); la casilla *Promover
   grados aquí también* existe solo para una escuela sin Loyverse.

Los saldos no requieren acción en el cambio de ciclo: cada 5 minutos el cron
registra compras y recargas hechas en el POS, y **Cafetería → Reconciliación**
muestra cualquier diferencia con el botón *Corregir* para cerrarla.

### 3b. Respaldo nocturno: cómo saber que ocurrió

`deploy/backup-db.sh` corre a las 02:30 y **avisa a la app** de su resultado
(`manage.py record_backup`): la luz *Respaldo nocturno* en Administración →
Cafetería → Estado de la sincronización lo muestra. A las 07:45,
`manage.py check_backup_fresh` revisa que el último respaldo correcto tenga
menos de 26 h; si no, **envía un correo a cada administrador activo** por el
mismo canal de los comunicados (el servidor no tiene `mail`) y pone la luz en
rojo.

**Copia fuera del servidor.** Un respaldo que solo existe en la máquina que
protege no es un respaldo. El script cifra cada volcado con la llave pública
del colegio y sube **solo el archivo cifrado** a un bucket privado que no se usa
para nada más, configurado con `BACKUP_S3_*` en `deploy/.env` (Cloudflare R2 o
Backblaze B2; pasos en docs/DEPLOY_HOSTINGER_VPS.md, *Off-site copy*). Ya no usa
el almacenamiento de archivos del sitio (`AWS_*`): hasta el 18-11-2026 lo
hacía, y con ese bucket configurado el volcado habría quedado sin cifrar junto
a las imágenes del sitio. La app rechaza cualquier archivo que no esté cifrado
para la llave del colegio.

En la consola hay tres luces:

| Luz | Verde | Ámbar | Rojo |
|---|---|---|---|
| *Respaldo nocturno* | el respaldo local tiene menos de 30 h | | falló o tiene más de 30 h |
| *Copia externa* | la copia cifrada tiene menos de 30 h | «Sin copia externa»: no hay `BACKUP_S3_*` | configurada, pero falló, no existe o tiene más de 30 h |
| *Prueba de restauración* | el simulacro mensual pasó hace menos de 40 días | aún no se ha registrado ninguno | falló o dejó de correr |

Con la copia externa configurada, `check_backup_fresh` (07:45) también envía
correo a los administradores si la copia tiene más de 26 h, si nunca se ha
hecho o si el último intento falló: una vez por problema y luego semanal
mientras siga.


## 7. Cafetería: cómo saber que los saldos coinciden con Loyverse

La luz **Saldos conciliados con Loyverse** del panel de Cafetería resume la
última pasada completa del espejo del POS (cada 5 minutos y al presionar
Sincronizar todos): cuántos alumnos se compararon, cuántos tienen el saldo
local por encima de Loyverse y por cuánto. La luz **Plantel alineado** dice si
hay alumnos cuyo cliente ya no existe en Loyverse, alumnos nuevos en Loyverse
sin vincular, o recibos del monedero sin alumno.

**Qué corre solo, y cuándo (hora local):**

| Hora | Comando | Qué hace |
| --- | --- | --- |
| cada 5 min | `sync_purchases` + `mirror_pos_topups` | compras y recargas en caja; el espejo espera 3 minutos tras cualquier movimiento antes de acreditar una diferencia |
| 05:42 | `sync_purchases --since-days 7` | vuelve a leer una semana de recibos por si alguno llegó tarde |
| 06:07 | `sync_roster` | vincula e importa alumnos nuevos, actualiza grado y nombre desde Loyverse, aplica recibos pendientes, marca enlaces obsoletos y clientes sin código de grado (posible baja); enciende la luz *Roster* |
| 07:35 | `check_wallet_drift` | correo a los administradores si algo quedó fuera de lugar |

**Si la luz de saldos está en ámbar por la mañana** (antes de que abra la
cafetería): abra la pestaña Reconciliación. Un alumno con saldo local por
encima de Loyverse casi siempre tiene una compra en el POS que aquí no
aparece; el repaso de las 05:40 la trae si existe. Si a mediodía sigue igual,
use Corregir en esa fila: deja el saldo en el número de Loyverse con un ajuste
auditado.

**Enlaces obsoletos.** Son bajas: la cafetería borró el cliente y nada más se
lo dijo a la app. El aviso "Revisarlos" en Alumnos y en el Dashboard lista a
esos alumnos con su saldo restante. Nada se borra solo: eliminar pide escribir
ELIMINAR, es solo para administradores y queda en Auditoría con el nombre y la
matrícula de quien se borró.

**Recargas duplicadas históricas (auditoría del 23-09-2026).** Antes de la
regla de espera, el espejo acreditó 31 recargas fantasma. Para revisarlas y
revertirlas con rastro:

    docker compose exec -T app python manage.py repair_phantom_topups            # solo reporte
    docker compose exec -T app python manage.py repair_phantom_topups --commit   # escribe los reversos

Cada reverso queda como Ajuste en el historial del alumno, con motivo, y solo
se aplica si el alumno todavía carga esa diferencia contra el saldo vivo de
Loyverse.

**Historial completo sin cobrar dos veces.** Una compra anterior al alta del alumno (su saldo inicial ya la incluía) se muestra en el historial marcada "incluida en el saldo inicial" y no descuenta nada. Para completar historiales antiguos:

    docker compose exec -T app python manage.py backfill_receipt_history --days 60            # reporte
    docker compose exec -T app python manage.py backfill_receipt_history --days 60 --commit   # escribe

Nunca toca saldos; omite a cualquier alumno cuyo saldo no coincida con Loyverse.

**Todas las tarjetas de Loyverse, no solo alumnos.** Cafetería → pestaña
Clientes Loyverse lista cada tarjeta que existe en la tienda: alumnos (con
enlace a su consola), personal (nombres `ZP-…`, correos de la escuela como
`direccion@` o `colegio@`), registros de prueba y cualquier otra. Cada fila
muestra el saldo vivo en Loyverse, visitas, última visita y si Loyverse ya la
eliminó. Las compras al monedero de una tarjeta sin alumno se guardan y se ven
con el botón de compras de esa fila. Se refresca en cada pasada del espejo
(5 minutos) y con cada aviso de Loyverse; nada de lo que existe en Loyverse
queda invisible en la app.

### 7b. Qué pasa cuando la oficina edita en Loyverse

Loyverse manda en la identidad del alumno (decisión del 24-09-2026). La
oficina edita ahí, y la app la sigue así:

| Lo que edita la oficina en Loyverse | Cómo lo guarda la app | Dónde se ve |
| --- | --- | --- |
| **Código de cliente** `ci09932` (el prefijo `ci` que hace que el código de barras vuelva a leerse en caja) | `Matrícula` sigue siendo `09932` (clave interna, clave del CSV); el código exacto de Loyverse se guarda aparte | Columna y campo **Código Loyverse** en Alumnos, en el expediente, en Cafetería (Saldos, Saldo bajo) y en la credencial de la familia. Buscar `ci09932` o `09932` encuentra al mismo alumno en Alumnos, Cafetería y Clientes Loyverse; el CSV acepta las dos formas |
| **Nombre** con sufijo de grado: `Chavez Lopez Juan Antonio-4PRI` | El sufijo se quita; la app muestra "Nombre Apellidos" (`Juan Antonio Chavez Lopez`) | El nombre **solo se reescribe cuando cambió en Loyverse** desde la última sincronización. Una corrección hecha en la consola sobrevive hasta que la oficina vuelva a cambiar ese nombre en Loyverse. Cada cambio de nombre queda en Auditoría (`import:loyverse`) |
| **Código de grado** en la dirección (`4PRI`, `4APRI`) o como sufijo del nombre | `4PRI` → grado 4° Primaria, el grupo se conserva; `4APRI` → grado y grupo A | Grado y grupo del alumno |
| Cliente **sin código de grado** (ni dirección ni sufijo) | No cambia nada solo | Alumnos → Vincular Loyverse → "Sin grado en Loyverse (posible baja)"; la oficina confirma con *Dar de baja* |

**Cuándo llega cada cosa:**

- Saldos, recargas en caja y la copia de las tarjetas (Clientes Loyverse):
  cada 5 minutos y con cada aviso de Loyverse.
- Roster (altas, grado, nombre, Código Loyverse, posibles bajas): **cada
  madrugada a las 06:07** (`sync_roster`), o al momento con **Administración
  → Cafetería → Sincronizar roster ahora** (mismo código que el cron). La luz
  **Roster** del panel dice cuándo corrió por última vez; se pone en rojo a
  las 30 h sin correr y `check_sync_fresh` avisa por correo a los
  administradores.
- **Importar desde Loyverse** (Alumnos) muestra, antes de aplicar, una tabla
  con cada cambio por alumno (nombre, grado, grupo, código, vínculo: antes y
  después) y los clientes omitidos con su motivo.

### 7c. Instalar o reinstalar el crontab

`deploy/crontab.example` **es** el crontab: se instala completo, como el
usuario dueño de `/opt/interlaken`, y se reinstala en cada deploy que lo
cambie (no se edita a mano):

    crontab /opt/interlaken/deploy/crontab.example && crontab -l | grep -c manage.py

**Nota de la versión 24-09-2026:** el crontab en vivo **debe reinstalarse con
este deploy**. Los trabajos nocturnos de Loyverse pasan de 05:40 y 06:05 a
**05:42 y 06:07** y de `flock -n` a `flock -w 900`: compartían el candado con
el sondeo de cada 5 minutos, perdían la carrera cada mañana y salían en
silencio, así que `sync_roster` nunca había corrido en producción.
`backend/apps/cafeteria/test_crontab.py` impide que esa forma vuelva.

### 7d. Ajuste masivo y acciones en lote (Cafetería)

**Ajuste masivo** (Cafetería → botón *Ajuste masivo*) aplica muchos ajustes de
saldo desde un archivo CSV o Excel con tres columnas: `matricula` (acepta
`09932` o `ci09932`), `monto` (positivo abona, negativo descuenta) y `motivo`.
Descargue la plantilla desde el mismo diálogo. Antes de escribir nada, la
vista previa muestra por fila el alumno, el saldo actual y el **saldo
resultante**; una fila que dejaría el saldo en negativo, una matrícula que no
existe, un monto en cero o mayor a $10,000, o un alumno repetido en el archivo
se marcan como error, y "Descargar reporte de errores" devuelve el mismo
archivo con las columnas `fila, resultado, errores, avisos`. Si el mismo
ajuste ya se aplicó en las últimas 24 horas, la fila trae un aviso (archivo
repetido). Límite: 500 filas por archivo. Las casillas *Notificar a las
familias* y *Reflejar el saldo en Loyverse* vienen marcadas; para una
corrección interna, desmarque la primera. Cada fila queda como Ajuste en el
historial del alumno y en Auditoría (`import:ajustes_cafeteria`), más un
resumen de la importación.

**Acciones en lote** (casillas de selección en cada pestaña):

- Saldos: *Sincronizar* (siembra el saldo inicial de los alumnos nunca
  sembrados y hace una sola lectura de recibos) y *Cambiar umbral* del saldo bajo.
- Depósitos: *Aplicar* recargas en caja pendientes (el diálogo muestra el total
  en pesos antes de confirmar; una recarga ya aplicada se omite, nunca se
  acredita dos veces), *Cargadas en POS*, *Quitadas del POS*.
- Reconciliación: *Corregir* las filas seleccionadas (máximo 50 por vez, cada
  una consulta Loyverse; no notifica a la familia).
- Movimientos: solo exportar; la devolución sigue siendo de una fila, con la
  palabra DEVOLVER.

Toda acción en lote primero muestra el plan (cuántas filas se procesarán y
por qué se omiten las demás), escribe una entrada de Auditoría por fila y un
resumen `bulk:<entidad>`. Límite: 500 filas por llamada. Las exportaciones
respetan la búsqueda, los filtros y el orden de la pestaña; *Toda la escuela*
exporta todos los saldos sin filtros. Referencia técnica: `docs/API-LISTING.md`.

## 8. Calendario escolar suscrito (.ics)

`GET /api/v1/content/calendar.ics` publica los eventos **publicados** del calendario escolar (del último año en adelante) como un feed iCalendar (RFC 5545: eventos de día completo, `DTEND` exclusivo, líneas plegadas a 75 octetos). Es público y sin sesión, igual que `/calendario`. La respuesta se guarda 10 minutos en la caché del proceso (`content:calendar.ics`) y cualquier alta, edición, borrado, acción masiva o importación del calendario desde la consola la invalida; como gunicorn corre 3 procesos con caché local, un cambio puede tardar hasta 10 minutos en verse en todos. Google Calendar además refresca las suscripciones por su cuenta (de horas a un día): eso no se controla desde el servidor. Para comprobarlo: `curl -sI https://interlaken.edu.mx/api/v1/content/calendar.ics` debe responder `200`, `Content-Type: text/calendar; charset=utf-8` y `Cache-Control: public, max-age=600`. La liga se copia desde Calendario → **Copiar liga .ics**.

## 9. Importaciones y exportaciones

Todas las tablas de la consola comparten el mismo motor (Data Ops, ver
`docs/API-LISTING.md` para el detalle por página). No hay trabajos en segundo
plano: cada importación, exportación o acción en lote termina dentro de la
misma petición, por eso tienen límites fijos.

**Límites.** Si se rebasan, el servidor responde 413 y la consola muestra el
mensaje tal cual ("Acote los filtros: el límite es N filas."):

| Operación | Límite |
| --- | --- |
| Importar (CSV o Excel) | 2,000 filas o 5 MB por archivo (Ajuste masivo de cafetería: 500 filas) |
| Exportar CSV o Excel | 10,000 filas |
| Exportar PDF | 1,000 filas |
| "Solo seleccionados (N)" | 500 filas |
| Acción en lote | 500 filas por llamada; "Seleccionar las N que coinciden" hasta 2,000 |
| Reconciliación de cafetería, *Corregir* | 50 filas por vez (cada una consulta Loyverse) |

**Frecuencia.** Por persona: exportaciones 30 por minuto (`admin-export`; en el
portal de familias `portal-export`, también 30), importaciones 10 por minuto
(`admin-import`), acciones en lote 30 por minuto (`admin-bulk`). Al rebasarlo
la consola avisa "Demasiadas solicitudes seguidas"; basta esperar un minuto.

**Cómo leer el reporte de errores.** Toda importación empieza con una vista
previa (nada se escribe). "Descargar reporte de errores" devuelve el mismo
archivo que se subió (CSV si era CSV, Excel si era Excel) con cuatro columnas
al final: `fila` (la línea del archivo original, contando el encabezado como
1), `resultado` (`crear`, `actualizar`, `omitir` o `error`), `errores` y
`avisos`. Las filas con error van primero. Se corrigen en el archivo original y
se vuelve a subir; o bien se marca "Importar solo las filas válidas" y el resto
se importa ahora. Un duplicado dentro del mismo archivo aparece como
"Duplicado de la fila N" en la fila posterior. La vista previa y la
importación hacen exactamente las mismas validaciones.

**Qué queda en Auditoría.** Cada fila creada o modificada por una importación
(contexto `import:<entidad>`) más un resumen de la importación; cada fila de
una acción en lote (`bulk:<entidad>:<acción>`) más un resumen `bulk:<entidad>`;
cada descarga de una exportación (`export:<entidad>`, con el formato, los
filtros y el número de filas). Las exportaciones nunca incluyen datos médicos
(se enmascaran) ni CURP en los listados generales.

**Errores de la API.** Desde la fase 10 todas las respuestas de error traen
`{"detail": "..."}` (más `code` cuando la consola necesita distinguir un caso,
por ejemplo `not_invited` en el acceso con Google). La clave antigua `error`
ya no existe; si una integración externa la leía, debe leer `detail`.

**Integridad de datos.** `check_data_integrity` es de solo lectura y reporta
lo que las restricciones de la base rechazarían: `loyverse_id` repetido entre
alumnos, correos repetidos sin distinguir mayúsculas, saldos negativos y
recargas con monto no positivo. Termina con código 1 si encuentra algo:

```bash
docker compose exec -T app python manage.py check_data_integrity
docker compose exec -T app python manage.py check_data_integrity --json
```

Desde la migración `accounts.0014_data_ops_unique_constraints` la base ya no
acepta esos duplicados (una vinculación Loyverse repetida o un correo que solo
cambia en mayúsculas se rechazan). Córralo antes de restaurar un respaldo
antiguo o de una corrección masiva de datos; si reporta algo, la limpieza se
hace con *Fusionar cuentas de familia* (`/admin/fusionar-cuentas`) para correos, y con
Vincular Loyverse para los `loyverse_id`.
