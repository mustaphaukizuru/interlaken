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
15. Cafetería con operaciones de datos (Phase 6):
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

## 4. Comunicación (staff) (5 min)
1. Ve solo Analítica, Páginas y Medios.
2. Edita una página y "Solicitar aprobación"; Dirección recibe aviso con enlace de vista previa; "Pedir cambios" llega al editor.

## 5. Correo y notificaciones (5 min)
1. Todo correo de staging llega con el prefijo `[STAGING]`.
2. Un comunicado con push llega al dispositivo suscrito; el reporte de entrega muestra enviados/fallidos.

## Cierre
- Defectos en GitHub Issues con etiqueta `uat` y el release probado.
- Release aprobado cuando todos los pasos de las secciones 1 a 3 están ✅ en los 3 navegadores.
