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

Mapa: 1 a 3 recorren el sitio y los dos portales; 4 es el roster de Loyverse; 5 a 18 son las operaciones de datos (Data Ops) página por página, en el orden del menú de Dirección, con el portal de familias al final; 19 y 20 cubren staff y correo.

## 1. Sitio público (10 min)

1.1. Inicio carga en menos de 3 s en móvil; el video del hero reproduce o muestra imagen.

1.2. Menú: los 4 grupos abren; en móvil el cajón se cierra con Escape y al tocar un enlace.

1.3. `/admisiones` muestra clases abiertas y el FAQ; "Pre-registro" lleva al formulario.

1.4. Pre-registro: la fecha de nacimiento fuera de rango muestra la ayuda de elegibilidad; el borrador se conserva al recargar.

1.5. Calendario: los eventos demo aparecen; descargar `.ics` abre en el calendario del teléfono.

1.6. Franja de aviso: el comunicado "[demo] Suspensión de clases" aparece arriba; al cerrarlo no vuelve en la misma sesión.

1.7. `/sitemap.xml` lista las páginas publicadas; una redirección creada en Navegación funciona.

## 2. Portal familia (15 min)

2.1. Login con contraseña: error claro con contraseña incorrecta; éxito lleva al tablero.

2.2. Novedades: muestra comunicados, eventos y consumos de cafetería; el contador baja al volver a entrar.

2.3. Cafetería: saldo por hijo, historial con filtros, recarga en sandbox termina en "Pendiente de confirmación".

2.4. Credencial: el QR abre en pantalla completa y el brillo sube en móvil.

2.5. Comunicados: marcar leído, comentar; la notificación en campana desaparece.

2.6. Mi perfil: foto (subir, recortar, quitar), datos, preferencias de aviso, Seguridad (historial de accesos, "Cerrar otras sesiones").

2.7. "Olvidé mi contraseña": solo muestra instrucciones para pedirla por WhatsApp o correo (no hay restablecimiento en línea).

Las listas y descargas del portal (filtros, orden, CSV y Excel) se prueban en la sección 18.

## 3. Portal Dirección (20 min)

3.1. Tablero: KPIs de cafetería y colas (admisiones, visitas, recargas, contraseñas, mensajes, formularios).

3.2. Alumnos: alta, edición (campos médicos visibles solo en detalle), estado (baja temporal desactiva el acceso del alumno), exportar CSV.

3.3. Contraseñas: resolver una solicitud genera la contraseña y los textos para WhatsApp/correo.

3.4. Admisiones: revisar documentos (aprobar/rechazar con nota llega por correo al prospecto).

3.5. Visitas: confirmar y marcar asistencia; el embudo en Analítica cambia.

3.6. Comunicados: crear con "Publicar en el sitio" y fecha límite; aparece en la franja pública y se retira en la fecha.

3.7. Páginas (CMS): editar un bloque, Revisar (lista de problemas), vista previa en móvil, publicar; la página pública cambia sin recargar el servidor. Restaurar una versión anterior.

3.8. Formularios: crear uno con campo condicional, enviarlo desde el sitio, verlo en Envíos y exportar CSV.

3.9. Navegación: cambiar el nombre de un grupo del menú; se refleja en encabezado, pie y móvil.

3.10. Nuevo ciclo: la vista previa cuenta bien; NO ejecutar en staging compartido sin avisar.

3.11. Fusionar cuentas: vista previa con dos familias demo; confirmar; la cuenta fusionada ya no puede entrar.

3.12. Seguridad: activar segundo factor con la app, cerrar sesión y volver a entrar con código.

3.13. Auditoría: cada acción anterior aparece con actor y contexto.

## 4. Roster desde Loyverse (Data Ops fase 0, 24-09-2026) (10 min)

4.1. Cafetería → Estado de la sincronización: la luz **Roster** está verde ("Roster sincronizado hace …"). Si está en rojo ("El roster no se ha sincronizado desde …" o "nunca"), presione **Sincronizar roster ahora**: aparece un aviso con altas, actualizados, nombres, vinculados y posibles bajas, y la luz pasa a verde sin recargar.

4.2. Alumnos: la columna **Código Loyverse** (activable en Columnas) muestra `ci09932` mientras **Matrícula** muestra `09932`; lo mismo en la tarjeta móvil y en el expediente del alumno. Buscar `ci09932` y `09932` encuentra al mismo alumno.

4.3. Cafetería → Saldos y Saldo bajo: columna Código Loyverse; la búsqueda cubre todo el plantel (no solo la página) y acepta las dos formas. Clientes Loyverse: buscar `09932` encuentra la tarjeta `ci09932`.

4.4. Portal familia → Cafetería: la credencial dice **Código Loyverse** sobre el código de barras.

4.5. Alumnos → Más acciones → Importar desde Loyverse: la vista previa es una tabla por alumno (Campo, Antes, Después) con buscador y chips por campo; "N clientes omitidos: ver motivos" explica cada omisión. Corrija un nombre en el expediente y vuelva a abrir la importación: no aparece ningún cambio de nombre para ese alumno.

4.6. Alumnos → Más acciones → Vincular Loyverse: si un cliente de Loyverse no trae código de grado, aparece bajo "Sin grado en Loyverse (posible baja)" con su Código Loyverse; nada cambia hasta presionar Dar de baja.

## 5. Operaciones de datos: controles comunes (10 min)

Estos controles son iguales en todas las tablas de Dirección. Pruébelos una vez aquí (en Alumnos, por ejemplo); las secciones 6 a 17 solo indican qué ofrece cada página y lo que cambia.

5.1. Exportar: el menú **Exportar** ofrece CSV, Excel y PDF (algunas páginas solo CSV y Excel). El archivo trae solo las filas de la vista actual (búsqueda, filtros y orden), el CSV abre en Excel con acentos y el Excel trae fechas y montos como números. Cada descarga aparece en Auditoría como `export:<entidad>` con los filtros y el número de filas.

5.2. Solo seleccionados: marque dos filas; el menú Exportar muestra **Solo seleccionados (2)**; actívelo y descargue: el archivo trae solo esas dos filas. La barra de lote ofrece lo mismo con **Exportar seleccionados** (o **Exportar seleccionadas**).

5.3. Límite de exportación: una descarga por encima del tope (10,000 filas en CSV y Excel, 1,000 en PDF) no descarga nada y muestra "Acote los filtros: el límite es N filas." Prueba práctica: Auditoría sin filtros → Exportar → PDF, si la bitácora tiene más de 1,000 entradas (si no, anote "no aplica").

5.4. Importar, archivo: **Importar** abre el asistente Archivo → Revisión → Confirmación → Resumen. **Descargar plantilla CSV** y **Descargar plantilla Excel** bajan los encabezados (obligatorios en negrita) y una fila de ejemplo. Un archivo de 2,001 filas responde "Divida el archivo: el límite es 2,000 filas."; uno de más de 5 MB, "El archivo excede el límite de 5 MB."

5.5. Importar, revisión (dry run): al subir el archivo nada se guarda todavía; la tabla muestra por fila Crear, Actualizar, Omitir o Error con el detalle. **Descargar reporte de errores** baja el archivo en el mismo formato que se subió (CSV si subió CSV, Excel si subió Excel) con las columnas originales más fila, resultado, errores y avisos, las filas con error primero.

5.6. Importar, confirmación: con errores, el botón **Importar N filas** queda deshabilitado hasta marcar **Importar solo las filas válidas (N)**; al importar, el Resumen muestra creados, actualizados, omitidos y con error, y **Ver en auditoría** lleva a las filas `import:<entidad>`. Volver a subir el mismo archivo: las filas ya importadas salen Omitir (o Actualizar si cambió algo).

5.7. Acciones en lote, plan (dry run): seleccione filas y elija una acción: antes de cambiar nada, el diálogo muestra el plan ("Se … N; M se omitirán" y "N porque …" por cada motivo; **Atención** para avisos). Las acciones de retroceso piden **Motivo (obligatorio)**. Cancelar no cambia nada.

5.8. Acciones en lote, resultado: al confirmar, las filas que fallan aparecen una por una con su motivo y **Reintentar fallidas (N)**. **Seleccionar las N que coinciden** aplica la acción a todo el filtro (no solo a la página); por encima de 2,000 filas aparece el mensaje de límite. Auditoría muestra una fila por registro (`bulk:<entidad>:<acción>`) y un resumen.

5.9. Vista: búsqueda, filtros (cada uno como chip), orden y página viven en la URL (copiar la URL en otra pestaña muestra la misma vista); **Columnas** (mostrar u ocultar, densidad, ancho, Restablecer) se conserva al recargar. En el teléfono (menos de 768 px) cada tabla se ve como tarjetas con casilla y menú de acciones, y la barra de lote aparece abajo.

## 6. Alumnos (Data Ops fase 3) (15 min)

6.1. Filtros: buscar, pestañas de estado, nivel, grado, grupo, acceso y Loyverse; cada filtro aparece como chip y queda en la URL. Ordenar por Nombre, Matrícula, Grado, Grupo, Estado, Saldo, Ingreso y Último acceso (flecha y `aria-sort` en el encabezado).

6.2. Columnas: Columnas → mostrar Correo e Ingreso, vista compacta, ancho de columna arrastrando el borde; recargar conserva la elección; Restablecer vuelve a la vista original. La columna Nombre queda fija al desplazarse de lado.

6.3. Lote: seleccionar 2 alumnos (uno con saldo en cafetería) → Cambiar estado → Baja definitiva → Continuar: el plan dice "Se darán de baja 2 alumnos" y en **Atención** lista al alumno con su saldo. Confirmar; ambos quedan en Baja definitiva (no se borra nada) y Auditoría muestra una fila por alumno más el resumen. Repetir con Cambiar grupo (sugiere los grupos existentes y acepta uno nuevo), Cambiar grado y Sincronizar con Loyverse. "Seleccionar las N que coinciden" aplica a todo el filtro.

6.4. Exportar: CSV, Excel y PDF de la vista filtrada (Excel trae el saldo como número); con filas seleccionadas, "Solo seleccionados (N)" o "Exportar seleccionados" descarga solo esas. Ninguna exportación trae datos médicos, CURP ni contacto de emergencia. Auditoría registra `export:students` con sus filtros.

6.5. Importar: Más acciones → Importar archivo → Descargar plantilla (CSV y Excel) → subir un archivo con una fila nueva, una existente escrita `ci09932`, una fila sin matrícula y una con tutor sin correo. La revisión muestra Crear / Actualizar / Error con el motivo; "Descargar reporte de errores" baja el mismo formato con las columnas fila, resultado, errores y avisos. Importar solo las filas válidas; el resumen enlaza a Auditoría. Volver a subir el mismo archivo: todas las filas salen "Omitir: Sin cambios".

6.6. Expediente del alumno: con 3 o más tutores aparecen "Buscar tutores" y "Ordenar tutores".

## 7. Admisiones (Data Ops fase 4, 25-09-2026) (15 min)

7.1. Admisiones abre en **Pre-registros**; la pestaña **Inscripciones** cambia de tabla y limpia los filtros. Recargar la página conserva búsqueda, estado, nivel, ciclo, visita, fechas, orden y página (todo vive en la URL).

7.2. Pre-registros: buscar por alumno, tutor, correo o teléfono; ordenar por Alumno, Grado, Tutor, Fecha y Estado; Columnas permite mostrar Nivel, Ciclo, Visita y Origen; en el teléfono la tabla se ve como tarjetas con casilla de selección.

7.3. El selector de estado de cada fila solo ofrece los cambios permitidos (un pre-registro Inscrito no se puede cambiar). Pasar de Contactado a Pendiente pide un motivo; el cambio aparece en Auditoría con el motivo.

7.4. Seleccionar dos filas, **Marcar contactados**: el diálogo muestra el plan (cuántos se cambian y cuántos se omiten y por qué) antes de confirmar. "Seleccionar las N que coinciden" aplica la acción a todo el filtro.

7.5. **Invitar a inscripción** en lote: solo pendientes y contactados; cada familia recibe su enlace por correo; los rechazados e inscritos se omiten.

7.6. **Importar** pre-registros: descargar la plantilla CSV y Excel, cargar una hoja de feria con una fila repetida y una fecha inválida: la revisión marca la repetida como aviso (no bloquea) y la fecha como error; descargar el reporte de errores; importar solo las filas válidas. Los nuevos pre-registros quedan Pendientes, del ciclo actual, y ninguna familia recibe correo.

7.7. **Exportar** pre-registros en CSV, Excel y PDF respeta búsqueda, filtros y orden; "Solo seleccionados (N)" y "Exportar seleccionados" solo incluyen las filas marcadas. Cada descarga aparece en Auditoría (`export:pre-registros`).

7.8. Inscripciones: filtro "Con documentos pendientes"; acciones en lote **Aprobar** y **Rechazar** con la casilla "Notificar a las familias" (desmarcada, no sale correo), **Pasar a revisión** (pide motivo) y **Solicitar documentos** (omite expedientes completos). Exportar CSV, Excel y PDF (también "Exportar seleccionadas"): no incluye datos médicos (`export:inscripciones`). Inscripciones no tiene importación.

7.9. Revisar expediente: marcar varios documentos y **Rechazar seleccionados** con motivo: la familia recibe un solo correo con la lista. El estado de la revisión solo ofrece los cambios permitidos; "Inscripción Completa" se logra con Convertir en alumno en el pipeline.

7.10. Pipeline: muestra los activos y los completados de los últimos 90 días; "Ver todos" lleva a la lista de inscripciones.

## 8. Visitas (Data Ops fase 5) (15 min)

8.1. Reservas: buscar por teléfono o por nombre del alumno; filtrar por estado, tipo, origen y rango de fechas; ordenar por fecha, tutor, alumno, asistentes o estado. Recargar la página: filtros, orden y página se conservan (viven en la URL). Ocultar una columna en Columnas y recargar: sigue oculta.

8.2. Acciones por fila: una reserva confirmada ofrece Asistió, No asistió y Cancelar (ya no Confirmar); una cancelada solo ofrece Reabrir, que pide un motivo y vuelve a Pendiente solo si el horario tiene cupo para todos sus asistentes. Corregir Asistió ↔ No asistió pide motivo. Cada cambio aparece en Auditoría con el motivo.

8.3. Cupo por asistentes: en un horario de cupo 4 con una reserva de 3 personas, reabrir una reserva cancelada de 2 personas se rechaza con el mensaje de cupo.

8.4. Lote: seleccionar varias reservas → Confirmar muestra primero el plan ("Se confirmarán N; M se omitirán porque…") y la casilla "Notificar a las familias"; al confirmar, las fallidas aparecen con su motivo y "Reintentar fallidas". Probar también "Seleccionar las N que coinciden".

8.5. Exportar reservas en CSV, Excel y PDF de la vista filtrada y con "Solo seleccionados (N)" / "Exportar seleccionadas"; el archivo respeta filtros y orden. En Auditoría aparece `export:bookings` con el número de filas. Reservas no tiene importación.

8.6. Horarios (pestaña Horarios): buscar por lugar o evento, filtrar Activos/Inactivos, ordenar por Reservados. Lote Desactivar/Activar; Eliminar en lote omite los horarios con reservas e indica el motivo. Exportar CSV, Excel y PDF (`export:bookings.slots`).

8.7. Horarios → **Cargar horarios**: descargar la plantilla, subirla con una fila repetida, una fecha pasada y un horario existente con otro cupo: la revisión marca error, error y Actualizar; "Descargar reporte de errores" baja el archivo anotado en el mismo formato; importar solo las filas válidas.

## 9. Cafetería (Data Ops fase 6) (20 min)

9.1. Saldos: buscar por nombre, `ci09932`, `09932` y correo de un tutor; filtrar por grado, estado del alumno, Saldo bajo y Sin vincular; ordenar por Saldo (flecha y `aria-sort`); la URL conserva todo al recargar. Columnas: ocultar Umbral, cambiar densidad, Restablecer.

9.2. Saldos, exportar: CSV, Excel y PDF de la vista filtrada traen solo las filas filtradas y en el mismo orden; "Solo seleccionados (N)" solo las marcadas; el botón de encabezado *Toda la escuela* trae todos los saldos sin filtros. Cada descarga aparece en Auditoría como `export:cafeteria.balances`.

9.3. Saldos, lote: seleccionar dos alumnos → *Cambiar umbral* a 80: el plan dice cuántos se cambiarán; confirmar; el umbral cambia y Auditoría muestra una fila por alumno y el resumen. *Sincronizar* en lote siembra los saldos y hace una sola consulta de recibos a Loyverse para todos.

9.4. *Ajuste masivo* (importación de Saldos): descargar la plantilla, subir un archivo con un abono, un descuento que dejaría el saldo negativo y una matrícula inexistente: la vista previa muestra el saldo resultante y dos errores; descargar el reporte de errores (mismo formato); importar solo las filas válidas: el saldo cambia, el historial del alumno muestra el Ajuste y la familia recibe aviso solo si la casilla estaba marcada. Volver a subir el mismo archivo: aviso de posible archivo repetido. Un archivo de más de 500 filas se rechaza con el mensaje de límite.

9.5. Movimientos: filtrar por tipo y fechas, buscar un número de recibo; exportar CSV, Excel y PDF (también solo seleccionados); no hay acciones en lote. Devolver una compra (por fila) exige escribir DEVOLVER.

9.6. Depósitos: seleccionar una recarga en caja pendiente → *Aplicar*: el diálogo muestra el total en pesos; confirmar; repetir sobre la misma recarga: se omite (no hay doble abono). Exportar CSV, Excel y PDF respeta estado, método y fechas.

9.7. POS Loyverse: marcar varias recargas como cargadas con *Cargadas en POS*; *Quitadas del POS* registra las que ya se quitaron del POS.

9.8. Reconciliación: *Reconciliar*, paginar, seleccionar una fila con diferencia → *Corregir*: el saldo queda igual a Loyverse, sin aviso a la familia. Exportar la reconciliación en CSV, Excel o PDF.

9.9. Saldo bajo: filtrar por grado; exportar CSV, Excel y PDF y "Solo seleccionados (N)" (`export:cafeteria.low_balance`); sin acciones en lote.

9.10. Clientes Loyverse: 50 por página, filtros por tipo, exportar (la vista actual; esta tabla no tiene selección).

9.11. Expediente de cafetería de un alumno: Movimientos y Ajustes paginan (más de 20 filas). **Estado de cuenta** → CSV y PDF descargan el historial del alumno y Auditoría registra `export:cafeteria.student_statement`.

9.12. En el teléfono (menos de 768 px) cada tabla se ve como tarjetas con casilla y menú de acciones; la barra de lote aparece abajo.

## 10. Pagos (Data Ops fase 7) (5 min)

10.1. Buscar por alumno, matrícula (`ci09932` y `09932`), correo del pagador o referencia de la pasarela; filtrar por estado, pasarela y fechas; ordenar por columna. Recargar: la URL conserva todo.

10.2. Exportar CSV, Excel y PDF de la vista filtrada; seleccionar filas → "Solo seleccionados (N)" o "Exportar seleccionados". Auditoría registra `export:payments`. No hay acciones en lote ni importación (el estado de un pago lo fija la pasarela).

## 11. Comunicados (Data Ops fase 8, 25-09-2026) (10 min)

11.1. Buscar por título, filtrar por Estado, Dirigido a, Programación, Enterado y fechas; ordenar por Leídos.

11.2. Lote: seleccionar dos comunicados → **Duplicar**: aparecen "Copia de …" como inactivos. Seleccionar uno ya enviado → **Eliminar no enviados**: el plan dice "1 porque ya se envió a las familias". **Desactivar (archivar)** y **Activar** muestran su plan antes de confirmar.

11.3. **Exportar** CSV y Excel (esta página no ofrece PDF) respeta los filtros; "Exportar seleccionados" solo trae los marcados. No hay importación.

11.4. En "Ver entrega", **Exportar destinatarios** descarga una fila por familia (leído, enterado, estado de correo y push).

## 12. Mensajes (Data Ops fase 7) (5 min)

12.1. Pestañas Pendientes, Atendidos y Todos; buscar por nombre, correo, asunto o texto; filtrar por fechas; la URL conserva todo.

12.2. Lote: seleccionar un mensaje pendiente y uno atendido → **Marcar atendidos**: el plan omite el que ya estaba atendido; **Reabrir** hace lo contrario. Marcar uno solo desde su fila queda en Auditoría (`contact.handled`).

12.3. Exportar CSV, Excel y PDF de la vista y de los seleccionados (`export:contact_messages`). No hay importación.

## 13. Contraseñas (Data Ops fase 3) (5 min)

13.1. La vista abre en Pendientes (con el número en la pestaña); Resueltas, Rechazadas y Todas quedan en la URL; filtrar por canal y fechas.

13.2. Lote: seleccionar dos pendientes → **Rechazar**: el motivo es obligatorio y se guarda en la nota y en Auditoría. Rechazar una sola desde su fila también queda en Auditoría. "Generar contraseña" sigue siendo de una en una.

13.3. Exportar CSV, Excel y PDF de la vista y "Exportar seleccionadas" (`export:password_requests`). No hay importación.

## 14. Contenido (Data Ops fase 8, 25-09-2026) (15 min)

14.1. Páginas: filtrar Borradores y Plantilla; seleccionar un borrador vacío y una página con bloques → **Publicar**: el plan marca el vacío como "no se puede procesar" y publica el otro. **Eliminar borradores** omite las páginas que ya se publicaron alguna vez. Exportar CSV, Excel y PDF. Una cuenta de staff ve la tabla pero sin casillas ni Exportar.

14.2. Medios: arrastrar a la zona punteada una imagen nueva, un PDF, una foto de más de 10 MB y una imagen ya subida: cada archivo muestra su resultado; la repetida ofrece **Ya existe: usar el existente**. Filtro "Sin usar" + **Eliminar sin usar**: las imágenes en uso se omiten. **Agregar etiqueta** a varias. Exportar el listado en CSV, Excel y PDF.

14.3. Formularios: ordenar por Pendientes; **Eliminar sin envíos** omite los formularios con envíos; exportar la lista. Abrir **Envíos**: abre en Pendientes, la búsqueda encuentra texto de cualquier respuesta, **Seleccionar las N que coinciden** → Marcar atendidos. Exportar envíos en Excel: una columna por campo.

14.4. Navegación → Redirecciones: **Importar** un CSV `de,a,permanente` con una ruta repetida y una ruta reservada (`/api/x`): el paso de revisión marca ambas como error, "Descargar reporte de errores" baja el archivo anotado, "Importar solo las filas válidas" crea el resto. Eliminar en lote y exportar (los encabezados coinciden con la plantilla de importación).

14.5. Testimonios: cambiar el número de **Orden** en la tabla y presionar Enter: se guarda y la bitácora registra el cambio. Lote Publicar, Despublicar y Eliminar; exportar CSV, Excel y PDF.

14.6. Calendario: **Importar** con la plantilla (fechas DD/MM/AAAA); un evento con el mismo título e inicio se actualiza. Lote Publicar, Despublicar y Eliminar; exportar. **Copiar liga .ics** y suscribirse desde Google Calendar: aparecen solo los eventos publicados (en 10 minutos como máximo tras un cambio).

14.7. Auditoría: cada alta, edición, borrado, acción masiva, importación y exportación anterior aparece con actor y contexto (`cms.*`, `bulk:content.*`, `import:content.*`, `export:*`).

## 15. Usuarios (Data Ops fase 3) (5 min)

15.1. Buscar, filtrar por rol y Activas/Inactivas, ordenar; exportar CSV, Excel y PDF (`export:staff`).

15.2. Lote: seleccionar su propia cuenta y otra → Desactivar: el plan omite su cuenta ("No puede desactivar su propia cuenta") y desactiva la otra; Reactivar la devuelve.

15.3. Importar → plantilla con correo, nombre, apellidos, rol: las cuentas nuevas se crean sin contraseña; una cuenta existente sale "Omitir"; un correo de familia sale en error y aparece en el reporte de errores; importar solo las filas válidas.

## 16. Auditoría (Data Ops fase 7) (5 min)

16.1. Buscar por actor; filtrar por acción, contexto (p. ej. `cafeteria.adjust`), tipo de objeto e ID (el historial de un registro) y fechas; ordenar por columna. Abrir una entrada: "Cambios: valor anterior y nuevo" muestra Campo, Antes y Después.

16.2. Exportar CSV, Excel y PDF respeta los filtros (`export:audit`); aquí se prueba el límite de PDF del paso 5.3. La bitácora no tiene acciones en lote ni importación (solo se agrega).

## 17. Solicitudes ARCO (Data Ops fase 7) (5 min)

17.1. Pestañas Abiertas, Recibidas, En revisión, Resueltas, Rechazadas y Todas; filtrar por Derecho y Plazo ("Solo vencidas"); el aviso de vencidas cuenta todas las del filtro, no solo la página.

17.2. Lote: seleccionar una recibida y una en revisión → **Marcar en revisión**: el plan omite la que ya estaba en revisión. Resolver o Rechazar desde la fila exige nota (llega por correo al solicitante); reabrir una cerrada también pide nota.

17.3. Exportar CSV, Excel y PDF y "Exportar seleccionadas" (`export:arco`). No hay importación.

## 18. Portal de familias: listas y descargas (Data Ops fase 9) (10 min)

Con la familia de 2 hijos:

18.1. Cafetería → Historial: elegir un hijo, tipo "Compras" y el preset "Este mes"; ordenar por Monto (primer toque de mayor a menor, segundo de menor a mayor, tercero vuelve a "más recientes"). Recargar la página: filtros, orden y página se conservan en la URL; el selector de alumnos del portal marca al mismo hijo.

18.2. Cafetería → Descargar CSV y Excel: el archivo trae solo los movimientos filtrados y en el mismo orden (Alumno, Matrícula, Fecha, Tipo, Descripción, Monto, Saldo); Excel abre con fechas y montos como números. El Estado de cuenta (PDF) mensual no cambia.

18.3. Pagos: filtrar por estado y con los presets de fecha (ya no hay dos campos sueltos), ordenar por Fecha, Monto o Estado; los chips muestran las fechas como DD/MM/AAAA. Descargar CSV y Excel: mismas filas y orden que la lista. El comprobante PDF de un pago completado no cambia.

18.4. Con la cuenta de la otra familia, las descargas no incluyen ningún movimiento ni pago de la familia de 2 hijos (y viceversa). En Dirección → Auditoría aparecen `export:cafeteria.family_transactions` y `export:payments.family` con el usuario de la familia y los filtros usados.

18.5. Comunicados: pasar a la página 2, abrir un comunicado y volver: sigue en la página 2. Con `?page=99` en la URL se muestra la página 1.

18.6. Notificaciones: filtrar "Sin leer", "Marcar todas como leídas": la lista queda vacía con "Está al día" y el botón "Ver todas" quita el filtro.

18.7. Inscripciones (familia con más de una solicitud): los chips de estado filtran y se conservan en la URL.

18.8. Privacidad (`/portal/privacidad`) → **Descargar mis datos**: el archivo trae solo los datos de la familia que lo pide (cuenta, hijos, consentimientos, pagos, visitas, solicitudes ARCO y cafetería).

18.9. El portal no tiene búsqueda, acciones en lote ni importación.

## 19. Comunicación (staff) (5 min)

19.1. Ve solo Analítica, Páginas y Medios.

19.2. Edita una página y "Solicitar aprobación"; Dirección recibe aviso con enlace de vista previa; "Pedir cambios" llega al editor.

## 20. Correo y notificaciones (5 min)

20.1. Todo correo de staging llega con el prefijo `[STAGING]`.

20.2. Un comunicado con push llega al dispositivo suscrito; el reporte de entrega muestra enviados/fallidos.

## Cierre

- Defectos en GitHub Issues con etiqueta `uat` y el release probado.
- Release aprobado cuando todos los pasos de las secciones 1 a 18 están ✅ en los 3 navegadores.
