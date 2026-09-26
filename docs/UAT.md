# UAT: guion de pruebas de aceptación por release

Staging: `https://staging.interlaken.edu.mx` (ver `deploy/docker-compose.staging.yml`).
Datos demo: `python manage.py seed_demo --force --reset` antes de cada ronda.
Cuentas (contraseña `Demo-2026!`):

| Rol | Correo |
|---|---|
| Dirección (admin) | direccion@demo.interlaken.mx |
| Comunicación (staff) | comunicacion@demo.interlaken.mx |
| Familia con 2 hijos | mama.lopez@demo.interlaken.mx |
| Familia con saldo bajo | familia.perez@demo.interlaken.mx |

Marque cada paso ✅ / ❌ y anote el navegador y dispositivo (mínimo: Chrome escritorio, Safari iPhone, Chrome Android).

## 1. Sitio público (10 min)
1. Inicio carga en menos de 3 s en móvil; el video del hero reproduce o muestra imagen.
2. Menú: los 4 grupos abren; en móvil el cajón se cierra con Escape y al tocar un enlace.
3. `/admisiones` muestra clases abiertas y el FAQ; "Pre-registro" lleva al formulario.
4. Pre-registro: la fecha de nacimiento fuera de rango muestra la ayuda de elegibilidad; el borrador se conserva al recargar.
5. Calendario: los eventos demo aparecen; descargar `.ics` abre en el calendario del teléfono.
6. Franja de aviso: el comunicado "[demo] Suspensión de clases" aparece arriba; al cerrarlo no vuelve en la misma sesión.
7. `/sitemap.xml` lista las páginas publicadas; una redirección creada en Navegación funciona.

## 2. Portal familia (15 min)
1. Login con contraseña: error claro con contraseña incorrecta; éxito lleva al tablero.
2. Novedades: muestra comunicados, eventos y consumos de cafetería; el contador baja al volver a entrar.
3. Cafetería: saldo por hijo, historial con filtros, recarga en sandbox termina en "Pendiente de confirmación".
4. Credencial: el QR abre en pantalla completa y el brillo sube en móvil.
5. Comunicados: marcar leído, comentar; la notificación en campana desaparece.
6. Mi perfil: foto (subir, recortar, quitar), datos, preferencias de aviso, Seguridad (historial de accesos, "Cerrar otras sesiones").
7. "Olvidé mi contraseña": solo muestra instrucciones para pedirla por WhatsApp o correo (no hay restablecimiento en línea).

## 3. Portal Dirección (20 min)
1. Tablero: KPIs de cafetería y colas (admisiones, visitas, recargas, contraseñas, mensajes, formularios).
2. Alumnos: alta, edición (campos médicos visibles solo en detalle), estado (baja temporal desactiva el acceso del alumno), exportar CSV.
3. Contraseñas: resolver una solicitud genera la contraseña y los textos para WhatsApp/correo.
4. Admisiones: revisar documentos (aprobar/rechazar con nota llega por correo al prospecto).
5. Visitas: confirmar y marcar asistencia; el embudo en Analítica cambia.
6. Comunicados: crear con "Publicar en el sitio" y fecha límite; aparece en la franja pública y se retira en la fecha.
7. Páginas (CMS): editar un bloque, Revisar (lista de problemas), vista previa en móvil, publicar; la página pública cambia sin recargar el servidor. Restaurar una versión anterior.
8. Formularios: crear uno con campo condicional, enviarlo desde el sitio, verlo en Envíos y exportar CSV.
9. Navegación: cambiar el nombre de un grupo del menú; se refleja en encabezado, pie y móvil.
10. Nuevo ciclo: la vista previa cuenta bien; NO ejecutar en staging compartido sin avisar.
11. Fusionar cuentas: vista previa con dos familias demo; confirmar; la cuenta fusionada ya no puede entrar.
12. Seguridad: activar segundo factor con la app, cerrar sesión y volver a entrar con código.
13. Auditoría: cada acción anterior aparece con actor y contexto.
14. Roster desde Loyverse (Phase 0, 24-09-2026):
    - Cafetería → Estado de la sincronización: la luz **Roster** está verde ("Roster sincronizado hace …"). Si está en rojo ("El roster no se ha sincronizado desde …" o "nunca"), presione **Sincronizar roster ahora**: aparece un aviso con altas, actualizados, nombres, vinculados y posibles bajas, y la luz pasa a verde sin recargar.
    - Alumnos: la columna **Código Loyverse** (activable en Columnas) muestra `ci09932` mientras **Matrícula** muestra `09932`; lo mismo en la tarjeta móvil y en el expediente del alumno. Buscar `ci09932` y `09932` encuentra al mismo alumno.
    - Cafetería → Saldos y Saldo bajo: columna Código Loyverse; la búsqueda cubre todo el plantel (no solo la página) y acepta las dos formas. Clientes Loyverse: buscar `09932` encuentra la tarjeta `ci09932`.
    - Portal familia → Cafetería: la credencial dice **Código Loyverse** sobre el código de barras.
    - Alumnos → Importar desde Loyverse: la vista previa es una tabla por alumno (Campo, Antes, Después) con buscador y chips por campo; "N clientes omitidos: ver motivos" explica cada omisión. Corrija un nombre en el expediente y vuelva a abrir la importación: no aparece ningún cambio de nombre para ese alumno.
    - Alumnos → Vincular Loyverse: si un cliente de Loyverse no trae código de grado, aparece bajo "Sin grado en Loyverse (posible baja)" con su Código Loyverse; nada cambia hasta presionar Dar de baja.
15. Operaciones de datos: Alumnos, Usuarios y Contraseñas (Data Ops fase 3):
    - Alumnos, filtros: buscar, pestañas de estado, nivel, grado, grupo, acceso y Loyverse; cada filtro aparece como chip y queda en la URL (copiar la URL en otra pestaña muestra la misma vista). Ordenar por Nombre, Matrícula, Grado, Grupo, Estado, Saldo, Ingreso y Último acceso (flecha y `aria-sort` en el encabezado).
    - Alumnos, columnas: Columnas → mostrar Correo e Ingreso, vista compacta, ancho de columna arrastrando el borde; recargar conserva la elección; Restablecer vuelve a la vista original. La columna Nombre queda fija al desplazarse de lado.
    - Alumnos, lote: seleccionar 2 alumnos (uno con saldo en cafetería) → Cambiar estado → Baja definitiva → Continuar: el plan dice "Se darán de baja 2 alumnos" y en **Atención** lista al alumno con su saldo. Confirmar; ambos quedan en Baja definitiva (no se borra nada) y Auditoría muestra una fila por alumno más el resumen. Repetir con Cambiar grupo (sugiere los grupos existentes y acepta uno nuevo) y Cambiar grado. "Seleccionar las N que coinciden" aplica a todo el filtro.
    - Alumnos, exportar: Exportar → CSV, Excel y PDF de la vista filtrada (abren en Excel con acentos; Excel trae saldo como número); con filas seleccionadas, "Exportar seleccionados" descarga solo esas. Ninguna exportación trae datos médicos. Auditoría registra cada exportación con sus filtros.
    - Alumnos, importar: Más acciones → Importar archivo → Descargar plantilla (CSV y Excel) → subir un archivo con una fila nueva, una existente escrita `ci09932`, una fila sin matrícula y una con tutor sin correo. La revisión muestra Crear / Actualizar / Error con el motivo; "Descargar reporte de errores" baja el mismo archivo con las columnas fila, resultado, errores y avisos. Importar solo las filas válidas; el resumen enlaza a Auditoría. Volver a subir el mismo archivo: todas las filas salen "Omitir: Sin cambios".
    - Expediente del alumno: con 3 o más tutores aparecen "Buscar tutores" y "Ordenar tutores".
    - Usuarios: buscar, filtrar por rol y Activas/Inactivas, ordenar, exportar. Seleccionar su propia cuenta y otra → Desactivar: el plan omite su cuenta ("No puede desactivar su propia cuenta") y desactiva la otra; Reactivar la devuelve. Importar → plantilla con correo, nombre, apellidos, rol: las cuentas nuevas se crean sin contraseña; una cuenta existente sale "Omitir"; un correo de familia sale en error.
    - Contraseñas: la vista abre en Pendientes (con el número en la pestaña); Resueltas, Rechazadas y Todas quedan en la URL; filtrar por canal y fechas; exportar. Seleccionar dos pendientes → Rechazar: el motivo es obligatorio y se guarda en la nota y en Auditoría. Rechazar una sola desde su fila también queda en Auditoría. "Generar contraseña" sigue siendo de una en una.

## 4. Comunicación (staff) (5 min)
1. Ve solo Analítica, Páginas y Medios.
2. Edita una página y "Solicitar aprobación"; Dirección recibe aviso con enlace de vista previa; "Pedir cambios" llega al editor.

## 5. Correo y notificaciones (5 min)
1. Todo correo de staging llega con el prefijo `[STAGING]`.
2. Un comunicado con push llega al dispositivo suscrito; el reporte de entrega muestra enviados/fallidos.

## Cierre
- Defectos en GitHub Issues con etiqueta `uat` y el release probado.
- Release aprobado cuando todos los pasos de las secciones 1 a 3 están ✅ en los 3 navegadores.
