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
15. Visitas (Data Ops, fase 5):
    - Reservas: buscar por teléfono o por nombre del alumno; filtrar por estado, tipo, origen y rango de fechas; ordenar por fecha, tutor, alumno, asistentes o estado. Recargar la página: filtros, orden y página se conservan (viven en la URL). Ocultar una columna en Columnas y recargar: sigue oculta.
    - Acciones por fila: una reserva confirmada ofrece Asistió, No asistió y Cancelar (ya no Confirmar); una cancelada solo ofrece Reabrir, que pide un motivo y vuelve a Pendiente solo si el horario tiene cupo para todos sus asistentes. Corregir Asistió ↔ No asistió pide motivo. Cada cambio aparece en Auditoría con el motivo.
    - Cupo por asistentes: en un horario de cupo 4 con una reserva de 3 personas, reabrir una reserva cancelada de 2 personas se rechaza con el mensaje de cupo.
    - Lote: seleccionar varias reservas → Confirmar muestra primero el plan ("Se confirmarán N; M se omitirán porque…") y la casilla "Notificar a las familias"; al confirmar, las fallidas aparecen con su motivo y "Reintentar fallidas". Probar también "Seleccionar las N que coinciden".
    - Exportar CSV, Excel y PDF de la vista filtrada y "Solo seleccionadas"; el archivo respeta filtros y orden. En Auditoría aparece la exportación con el número de filas.
    - Horarios (pestaña Horarios): buscar por lugar o evento, filtrar Activos/Inactivos, ordenar por Reservados. Lote Desactivar/Activar; Eliminar en lote omite los horarios con reservas e indica el motivo. Cargar horarios: descargar la plantilla, subirla con una fila repetida, una fecha pasada y un horario existente con otro cupo: la revisión marca error, error y Actualizar; "Descargar reporte de errores" baja el archivo anotado; importar solo las filas válidas.

## 4. Comunicación (staff) (5 min)
1. Ve solo Analítica, Páginas y Medios.
2. Edita una página y "Solicitar aprobación"; Dirección recibe aviso con enlace de vista previa; "Pedir cambios" llega al editor.

## 5. Correo y notificaciones (5 min)
1. Todo correo de staging llega con el prefijo `[STAGING]`.
2. Un comunicado con push llega al dispositivo suscrito; el reporte de entrega muestra enviados/fallidos.

## Cierre
- Defectos en GitHub Issues con etiqueta `uat` y el release probado.
- Release aprobado cuando todos los pasos de las secciones 1 a 3 están ✅ en los 3 navegadores.
