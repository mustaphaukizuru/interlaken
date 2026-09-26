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
15. Admisiones con operaciones de datos (Phase 4, 25-09-2026):
    - Admisiones abre en **Pre-registros**; la pestaña **Inscripciones** cambia de tabla y limpia los filtros. Recargar la página conserva búsqueda, estado, nivel, ciclo, visita, fechas, orden y página (todo vive en la URL).
    - Pre-registros: buscar por alumno, tutor, correo o teléfono; ordenar por Alumno, Grado, Tutor, Fecha y Estado; Columnas permite mostrar Nivel, Ciclo, Visita y Origen; en el teléfono la tabla se ve como tarjetas con casilla de selección.
    - El selector de estado de cada fila solo ofrece los cambios permitidos (un pre-registro Inscrito no se puede cambiar). Pasar de Contactado a Pendiente pide un motivo; el cambio aparece en Auditoría con el motivo.
    - Seleccionar dos filas, **Marcar contactados**: el diálogo muestra el plan (cuántos se cambian y cuántos se omiten y por qué) antes de confirmar. "Seleccionar las N que coinciden" aplica la acción a todo el filtro.
    - **Invitar a inscripción** en lote: solo pendientes y contactados; cada familia recibe su enlace por correo; los rechazados e inscritos se omiten.
    - **Importar**: descargar la plantilla CSV y Excel, cargar una hoja de feria con una fila repetida y una fecha inválida: la revisión marca la repetida como aviso (no bloquea) y la fecha como error; descargar el reporte de errores; importar solo las filas válidas. Los nuevos pre-registros quedan Pendientes, del ciclo actual, y ninguna familia recibe correo.
    - **Exportar** CSV, Excel y PDF respeta búsqueda, filtros y orden; "Exportar seleccionados" solo incluye las filas marcadas. Cada descarga aparece en Auditoría.
    - Inscripciones: filtro "Con documentos pendientes"; acciones en lote **Aprobar** y **Rechazar** con la casilla "Notificar a las familias" (desmarcada, no sale correo), **Pasar a revisión** (pide motivo) y **Solicitar documentos** (omite expedientes completos). La exportación no incluye datos médicos.
    - Revisar expediente: marcar varios documentos y **Rechazar seleccionados** con motivo: la familia recibe un solo correo con la lista. El estado de la revisión solo ofrece los cambios permitidos; "Inscripción Completa" se logra con Convertir en alumno en el pipeline.
    - Pipeline: muestra los activos y los completados de los últimos 90 días; "Ver todos" lleva a la lista de inscripciones.

16. Visitas (Data Ops, fase 5):
    - Reservas: buscar por teléfono o por nombre del alumno; filtrar por estado, tipo, origen y rango de fechas; ordenar por fecha, tutor, alumno, asistentes o estado. Recargar la página: filtros, orden y página se conservan (viven en la URL). Ocultar una columna en Columnas y recargar: sigue oculta.
    - Acciones por fila: una reserva confirmada ofrece Asistió, No asistió y Cancelar (ya no Confirmar); una cancelada solo ofrece Reabrir, que pide un motivo y vuelve a Pendiente solo si el horario tiene cupo para todos sus asistentes. Corregir Asistió ↔ No asistió pide motivo. Cada cambio aparece en Auditoría con el motivo.
    - Cupo por asistentes: en un horario de cupo 4 con una reserva de 3 personas, reabrir una reserva cancelada de 2 personas se rechaza con el mensaje de cupo.
    - Lote: seleccionar varias reservas → Confirmar muestra primero el plan ("Se confirmarán N; M se omitirán porque…") y la casilla "Notificar a las familias"; al confirmar, las fallidas aparecen con su motivo y "Reintentar fallidas". Probar también "Seleccionar las N que coinciden".
    - Exportar CSV, Excel y PDF de la vista filtrada y "Solo seleccionadas"; el archivo respeta filtros y orden. En Auditoría aparece la exportación con el número de filas.
    - Horarios (pestaña Horarios): buscar por lugar o evento, filtrar Activos/Inactivos, ordenar por Reservados. Lote Desactivar/Activar; Eliminar en lote omite los horarios con reservas e indica el motivo. Cargar horarios: descargar la plantilla, subirla con una fila repetida, una fecha pasada y un horario existente con otro cupo: la revisión marca error, error y Actualizar; "Descargar reporte de errores" baja el archivo anotado; importar solo las filas válidas.
17. Operaciones de datos: Alumnos, Usuarios y Contraseñas (Data Ops fase 3):
    - Alumnos, filtros: buscar, pestañas de estado, nivel, grado, grupo, acceso y Loyverse; cada filtro aparece como chip y queda en la URL (copiar la URL en otra pestaña muestra la misma vista). Ordenar por Nombre, Matrícula, Grado, Grupo, Estado, Saldo, Ingreso y Último acceso (flecha y `aria-sort` en el encabezado).
    - Alumnos, columnas: Columnas → mostrar Correo e Ingreso, vista compacta, ancho de columna arrastrando el borde; recargar conserva la elección; Restablecer vuelve a la vista original. La columna Nombre queda fija al desplazarse de lado.
    - Alumnos, lote: seleccionar 2 alumnos (uno con saldo en cafetería) → Cambiar estado → Baja definitiva → Continuar: el plan dice "Se darán de baja 2 alumnos" y en **Atención** lista al alumno con su saldo. Confirmar; ambos quedan en Baja definitiva (no se borra nada) y Auditoría muestra una fila por alumno más el resumen. Repetir con Cambiar grupo (sugiere los grupos existentes y acepta uno nuevo) y Cambiar grado. "Seleccionar las N que coinciden" aplica a todo el filtro.
    - Alumnos, exportar: Exportar → CSV, Excel y PDF de la vista filtrada (abren en Excel con acentos; Excel trae saldo como número); con filas seleccionadas, "Exportar seleccionados" descarga solo esas. Ninguna exportación trae datos médicos. Auditoría registra cada exportación con sus filtros.
    - Alumnos, importar: Más acciones → Importar archivo → Descargar plantilla (CSV y Excel) → subir un archivo con una fila nueva, una existente escrita `ci09932`, una fila sin matrícula y una con tutor sin correo. La revisión muestra Crear / Actualizar / Error con el motivo; "Descargar reporte de errores" baja el mismo archivo con las columnas fila, resultado, errores y avisos. Importar solo las filas válidas; el resumen enlaza a Auditoría. Volver a subir el mismo archivo: todas las filas salen "Omitir: Sin cambios".
    - Expediente del alumno: con 3 o más tutores aparecen "Buscar tutores" y "Ordenar tutores".
    - Usuarios: buscar, filtrar por rol y Activas/Inactivas, ordenar, exportar. Seleccionar su propia cuenta y otra → Desactivar: el plan omite su cuenta ("No puede desactivar su propia cuenta") y desactiva la otra; Reactivar la devuelve. Importar → plantilla con correo, nombre, apellidos, rol: las cuentas nuevas se crean sin contraseña; una cuenta existente sale "Omitir"; un correo de familia sale en error.
    - Contraseñas: la vista abre en Pendientes (con el número en la pestaña); Resueltas, Rechazadas y Todas quedan en la URL; filtrar por canal y fechas; exportar. Seleccionar dos pendientes → Rechazar: el motivo es obligatorio y se guarda en la nota y en Auditoría. Rechazar una sola desde su fila también queda en Auditoría. "Generar contraseña" sigue siendo de una en una.
18. Cafetería con operaciones de datos (Phase 6):
    - Saldos: buscar por nombre, `ci09932`, `09932` y correo de un tutor; filtrar por grado, estado del alumno, Saldo bajo y Sin vincular; ordenar por Saldo (flecha y `aria-sort`); la URL conserva todo al recargar. Columnas: ocultar Umbral, cambiar densidad, Restablecer.
    - Exportar la vista filtrada en CSV, Excel y PDF: el archivo trae solo las filas filtradas y en el mismo orden; *Toda la escuela* trae todos los saldos. Cada descarga aparece en Auditoría como `export:cafeteria.balances`.
    - Seleccionar dos alumnos → *Cambiar umbral* a 80: el plan dice cuántos se cambiarán; confirmar; el umbral cambia y Auditoría muestra una fila por alumno y el resumen.
    - *Ajuste masivo*: descargar la plantilla, subir un archivo con un abono, un descuento que dejaría el saldo negativo y una matrícula inexistente: la vista previa muestra el saldo resultante y dos errores; descargar el reporte de errores; importar solo las filas válidas: el saldo cambia, el historial del alumno muestra el Ajuste y la familia recibe aviso solo si la casilla estaba marcada. Volver a subir el mismo archivo: aviso de posible archivo repetido.
    - Movimientos: filtrar por tipo y fechas, buscar un número de recibo; exportar; Devolver una compra exige escribir DEVOLVER.
    - Depósitos: seleccionar una recarga en caja pendiente → *Aplicar*: el diálogo muestra el total en pesos; confirmar; repetir sobre la misma recarga: se omite (no hay doble abono).
    - POS Loyverse: marcar varias recargas como cargadas con *Cargadas en POS*.
    - Reconciliación: *Reconciliar*, paginar, seleccionar una fila con diferencia → *Corregir*: el saldo queda igual a Loyverse, sin aviso a la familia.
    - Clientes Loyverse: 50 por página, filtros por tipo, exportar.
    - Expediente de cafetería de un alumno: Movimientos y Ajustes paginan (más de 20 filas).
    - En el teléfono (menos de 768 px) cada tabla se ve como tarjetas con casilla y menú de acciones; la barra de lote aparece abajo.

15. Comunicados y Contenido en tablas de datos (Data Ops Phase 8, 25-09-2026):
    - Comunicados: buscar por título, filtrar por Estado/Dirigido a/Programación/Enterado y fechas; ordenar por Leídos. Seleccionar dos comunicados → **Duplicar**: aparecen "Copia de …" como inactivos. Seleccionar uno ya enviado → **Eliminar no enviados**: el plan dice "1 porque ya se envió a las familias". **Exportar** CSV/Excel respeta los filtros. En "Ver entrega", **Exportar destinatarios** descarga una fila por familia (leído, enterado, estado de correo y push).
    - Páginas: filtrar Borradores y Plantilla; seleccionar un borrador vacío y una página con bloques → **Publicar**: el plan marca el vacío como "no se puede procesar" y publica el otro. **Eliminar borradores** omite las páginas que ya se publicaron alguna vez. Una cuenta de staff ve la tabla pero sin casillas ni Exportar.
    - Medios: arrastrar a la zona punteada una imagen nueva, un PDF, una foto de más de 10 MB y una imagen ya subida: cada archivo muestra su resultado; la repetida ofrece **Ya existe: usar el existente**. Filtro "Sin usar" + **Eliminar sin usar**: las imágenes en uso se omiten. **Agregar etiqueta** a varias.
    - Formularios: ordenar por Pendientes; abrir **Envíos**: abre en Pendientes, la búsqueda encuentra texto de cualquier respuesta, **Seleccionar las N que coinciden** → Marcar atendidos. Exportar envíos en Excel: una columna por campo.
    - Navegación → Redirecciones: **Importar** un CSV `de,a,permanente` con una ruta repetida y una ruta reservada (`/api/x`): el paso de revisión marca ambas como error, "Descargar reporte de errores" baja el archivo anotado, "Importar solo las filas válidas" crea el resto.
    - Testimonios: cambiar el número de **Orden** en la tabla y presionar Enter: se guarda y la bitácora registra el cambio.
    - Calendario: **Importar** con la plantilla (fechas DD/MM/AAAA); un evento con el mismo título e inicio se actualiza. **Copiar liga .ics** y suscribirse desde Google Calendar: aparecen solo los eventos publicados (en 10 minutos como máximo tras un cambio).
    - Auditoría: cada alta, edición, borrado, acción masiva, importación y exportación anterior aparece con actor y contexto (`cms.*`, `bulk:content.*`, `import:content.*`, `export:*`).

## 4. Comunicación (staff) (5 min)
1. Ve solo Analítica, Páginas y Medios.
2. Edita una página y "Solicitar aprobación"; Dirección recibe aviso con enlace de vista previa; "Pedir cambios" llega al editor.

## 5. Correo y notificaciones (5 min)
1. Todo correo de staging llega con el prefijo `[STAGING]`.
2. Un comunicado con push llega al dispositivo suscrito; el reporte de entrega muestra enviados/fallidos.

## Cierre
- Defectos en GitHub Issues con etiqueta `uat` y el release probado.
- Release aprobado cuando todos los pasos de las secciones 1 a 3 están ✅ en los 3 navegadores.
