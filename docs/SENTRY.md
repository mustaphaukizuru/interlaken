# Alertas de errores (Sentry): activación

El código ya está listo y **apagado**. Mientras `SENTRY_DSN` y `VITE_SENTRY_DSN` estén vacíos en el servidor, la app no carga Sentry ni envía nada. Activarlo toma unos 20 minutos y no requiere cambiar código.

Para qué sirve: cuando una pantalla falla en producción (un error 500 en pagos, una excepción en el navegador de una familia), Sentry lo registra con la versión desplegada y le manda un correo la primera vez que aparece. El 18-11-2026 «Verificar en MultiCobros» falló en cada intento y nadie lo supo hasta que el personal lo reportó.

## 1. Crear la cuenta y los dos proyectos

1. Entre a [sentry.io](https://sentry.io) y cree una cuenta. El plan gratuito (Developer) alcanza para el volumen de este sitio.
2. Al crear la organización, elija la **región de datos de Estados Unidos (US)**. La política de seguridad del sitio (CSP) solo permite enviar a `*.ingest.sentry.io` y `*.ingest.us.sentry.io`; con la región de la Unión Europea (`ingest.de.sentry.io`) el navegador bloquearía los envíos del frontend.
3. Cree dos proyectos:
   - `interlaken-backend`, plataforma **Django**.
   - `interlaken-frontend`, plataforma **React**.
4. De cada proyecto copie el **DSN**: *Settings → Projects → (proyecto) → Client Keys (DSN)*. Tiene la forma `https://<clave>@o<número>.ingest.us.sentry.io/<número>`. El DSN no es una contraseña (el del frontend viaja dentro del JavaScript público), pero no lo suba al repositorio: el repositorio es público.
5. En cada proyecto, *Settings → Security & Privacy*: deje activos **Data Scrubber** y **Use Default Scrubbers**, y active **Prevent Storing of IP Addresses**. Es una segunda capa; la app ya limpia los datos antes de enviarlos (sección 5).

## 2. Variables en el servidor

En el VPS, edite `/opt/interlaken/deploy/.env` y llene estas líneas (ya existen, vacías):

```
SENTRY_DSN=https://<clave>@o<número>.ingest.us.sentry.io/<número>        # proyecto interlaken-backend
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.0
VITE_SENTRY_DSN=https://<clave>@o<número>.ingest.us.sentry.io/<número>   # proyecto interlaken-frontend
```

Después despliegue:

```bash
cd /opt/interlaken/deploy && ./deploy.sh
```

- `VITE_SENTRY_DSN` se integra al JavaScript al construir la imagen, por eso hace falta el deploy; no basta con reiniciar.
- La versión (*release*) de cada error es el commit desplegado: `deploy.sh` la pasa sola (`GIT_SHA` en la imagen del backend, `VITE_GIT_SHA` en el frontend). No hay que configurar nada.
- Con el DSN del frontend puesto, cada deploy reconstruye el frontend aunque no haya cambiado (uno o dos minutos más), porque la versión cambia en cada commit.
- `SENTRY_TRACES_SAMPLE_RATE` en `0.0` envía solo errores. Súbalo (por ejemplo `0.1`) solo si quiere medir tiempos de respuesta; consume cuota.

## 3. Probar que llega

Backend, desde `/opt/interlaken/deploy`:

```bash
docker compose exec -T app python manage.py shell -c "import sentry_sdk; sentry_sdk.capture_message('Prueba de alertas Interlaken (backend)'); sentry_sdk.flush()"
```

Frontend: abra https://interlaken.edu.mx, abra la consola del navegador (F12) y ejecute:

```js
setTimeout(() => { throw new Error('Prueba de alertas Interlaken (frontend)'); });
```

En un minuto cada mensaje debe aparecer en *Issues* de su proyecto, con `environment: production` y la versión (commit). Después márquelos como resueltos (*Resolve*).

## 4. Correo cuando aparece un error nuevo

En cada proyecto (backend y frontend):

1. *Alerts → Create Alert → Issues*.
2. Condición (*When*): **A new issue is created**.
3. Filtro (*If*, opcional): `environment` igual a `production`.
4. Acción (*Then*): **Send a notification to** → *Member* → su usuario. Si quiere que llegue también a `sistemas@interlaken.com.mx` (el `OPS_EMAIL` del servidor), invite ese buzón como miembro de la organización y agréguelo a la acción.
5. Nombre: `Error nuevo en producción`. Guarde.

Recomendado: una segunda regla igual con la condición **The issue changes state from resolved to unresolved**, para enterarse cuando vuelve un error que se había corregido.

Revise también *User Settings → Notifications → Issue Alerts*: debe estar activado, o las reglas no le mandan correo.

## 5. Qué se envía y qué no

Nunca salen del servidor ni del navegador:

- el cuerpo de las peticiones (formularios, montos, referencias, datos de alumnos y familias), las cookies ni los parámetros de la URL (tokens de restablecer contraseña, códigos de invitación o de Google);
- la dirección IP, el correo, el nombre o el usuario de quien tuvo el error: solo su número interno de usuario;
- los valores de las variables del código en el momento del error (en una vista de pagos contienen los datos de la familia);
- la clave secreta del webhook de Loyverse, que va en la ruta: se reemplaza por `[token]`.

Además, cualquier correo electrónico o CURP que aparezca en un mensaje de error, una línea de log o un rastro (*breadcrumb*) se reemplaza por `[email]` o `[CURP]`.

Sí se envía: el tipo y el mensaje del error (ya limpio), archivo, línea y función donde ocurrió, la ruta de la página o del endpoint, navegador y sistema operativo, el ambiente y la versión.

Las reglas están en `backend/apps/core/sentry.py` y `frontend/src/services/sentryScrub.ts`, con pruebas en `backend/apps/core/test_sentry.py` y `frontend/src/services/sentryScrub.test.ts`.

## 6. Apagarlo

Deje vacíos `SENTRY_DSN` y `VITE_SENTRY_DSN` en `/opt/interlaken/deploy/.env` y ejecute `./deploy.sh`.
