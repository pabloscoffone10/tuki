# Fase 6 — Notificaciones, recordatorios y pagos rápidos

Extensión sobre las Fases 1–5, sin recrear el proyecto ni otro motor financiero.
No se ejecutaron migraciones remotas, transferencias bancarias, recordatorios
externos ni tareas programadas reales. No se leyó ni modificó `.env.local`.

## Habilitar

1. Verificá que 001–007 estén aplicadas en el proyecto Supabase correcto.
2. En SQL Editor → New query, ejecutá completo **una sola vez**
   `supabase/migrations/202611020008_notifications_quick_payments.sql` como dueño.
   Incluye su transacción y recarga del esquema PostgREST. No repitas ni edites
   migraciones anteriores. Si falla, revisá el mensaje y el orden sin borrar tablas.
3. Reiniciá el servidor de desarrollo y recargá Tuki. La campana, preferencias,
   pagos rápidos y recordatorios manuales no requieren claves ni servicios nuevos.
4. Mantené `tuki_private` fuera de Exposed schemas. No hace falta activar Realtime,
   Vercel Cron, correo, WhatsApp ni suscripciones push para esta fase.

La migración crea `notifications`, `notification_preferences` y las tablas
privadas de outbox, límites e intervalos de recordatorios. Añade la marca
`receiver_attested` y el modo `receiver_receipt` a pagos, conservando los datos.
Extiende las RPC de pago de 007 mediante sus mismos registros, asignaciones,
FIFO, bloqueos y auditoría. Los auxiliares anteriores quedan privados sin EXECUTE
para clientes. La lista explícita del guard de eliminación se amplía solo para
las estructuras nuevas conocidas; no habilita borrar historia financiera.

## Pagos rápidos: qué cambia

Cada deuda neta muestra **Marcar como pagado**, **Pago parcial**, **Recordar pago**
y **Copiar recordatorio**. Los primeros dos abren el mismo diálogo dentro de la
página: las personas quedan fijadas, se valida el saldo vigente y se muestran
grupos relacionados, fecha, método y confirmación final. Pago completo mantiene
el importe validado sin edición; Pago parcial lo permite cambiar. No realiza
transferencias. Al guardar se actualizan los datos de la página, sin recarga
completa del navegador ni seleccionar de nuevo las personas.

- **Soy receptor con cuenta:** puedo declarar que recibí el dinero. Se crea el
  pago y se confirma en una sola transacción. No se simula la identidad del
  pagador ni su firma: la auditoría identifica explícitamente la recepción
  declarada por el receptor. Incluye dinero recibido de un invitado sin cuenta.
- **Soy pagador:** registro una entrega y queda pendiente hasta confirmación
  del receptor. No se descuentan deudas pendientes o rechazadas.
- **Soy administrador tercero:** solo registro dentro de mi ámbito de origen,
  sin autoaprobar. Si confirma una cuenta, debe ser la contraparte autorizada;
  para invitado, otro administrador independiente, distinto de creador y partes.
- **Dos invitados:** se mantiene la atestación administrativa independiente de
  Fase 5. No se crean cuentas ni se reclaman invitados por nombre.

La declaración directa del receptor es una **ampliación explícita de Fase 5**:
el cobro lo valida quien lo recibió, sin exigir otra confirmación del pagador.
Se registra `approval_mode=receiver_receipt`; solo ese receptor puede revertir
su declaración, con motivo, versión y auditoría. Las reglas anteriores siguen
aplicando a los demás pagos. El guard de gastos pagados sigue impidiendo cambios
que dejen asignaciones huérfanas, también para Cuenta inteligente.

El UUID del diálogo y la huella de contenido hacen idempotente un reintento
idéntico. PostgreSQL mantiene el bloqueo financiero y vuelve a validar el neto,
el ámbito, la selección y el importe: dos cobros simultáneos no pueden exceder
el saldo. Un error en la confirmación inmediata revierte también el registro.
No hay una segunda tabla de balances ni compensación duplicada.

Cuando un pago requiere el origen, el diálogo permite elegirlo sin volver a
seleccionar las personas. El administrador no gana acceso a otro origen por
ver la deuda compartida. En Registrar pago se muestran accesos a los grupos:
no tener deudas personales no significa que el grupo esté saldado. Las opciones
se validan en servidor y no cambian silenciosamente las personas de un enlace.

## Campana y centro

La barra superior muestra una campana con contador. Su panel presenta los últimos
8 avisos y enlaza a `/notificaciones`, que permite revisar los últimos 100,
filtrar no leídos y marcar uno o todos como leídos. Los destinos se restringen
en SQL y TypeScript a Pagos, Grupos o Gastos con identificadores UUID v?lidos; no se aceptan URLs externas ni
redirecciones arbitrarias. Las pantallas destino vuelven a comprobar permisos.
Los enlaces abren la sección correspondiente; no incluyen tokens de invitación
ni detalles de un gasto privado en la URL.

La actualización es ligera: una consulta inicial, otra cada **60 segundos** con
la pestaña visible, al volver al foco y tras acciones propias. Un proveedor único
evita consultas simultáneas; limpia temporizadores y listeners al desmontarse y
no rearma un timer de una petición terminada después del desmontaje. Marcar leído
actualiza el contador sin recargar la aplicación. No hay Realtime ni polling
agresivo, notificaciones push o email en esta fase.

## Eventos y privacidad

Los eventos de auditoría existentes producen filas de **outbox transaccional** con
destinatarios identificados en ese momento. No se genera un evento por cada grupo
que proyecta la misma obligación. El par cuenta/evento tiene unicidad. La entrega
a la bandeja se hace después, con reintentos y otra clave única: si falla esa
entrega, el pago ya confirmado permanece válido y la outbox se puede reintentar.

- Pagos: solicitud pendiente, confirmación, rechazo, anulación y deuda saldada.
  Un cobro directo no deja una solicitud innecesaria: al entregar se comprueba
  que el pago siga pendiente. Las solicitudes de invitados van solo a los
  administradores independientes que pueden confirmar.
- Gastos: creación, edición y anulación para cuentas involucradas, diferentes
  del actor, con acceso activo al origen. No se notifican productos ni importes
  privados a miembros de otro grupo receptor.
- Grupos: aceptación de invitación a administradores/remitentes autorizados,
  incorporación de invitados a administradores, e invitación nominada cuando
  una membresía de una cuenta existente pasa a `invited`.

**Los enlaces de invitación de Fase 3 no tienen destinatario nominativo.** No es
posible avisar a una cuenta antes de saber a quién se entregó el enlace. No se
inventa un email ni se notifica a todos: la creación del enlace no genera avisos
a desconocidos. Al aceptarse se avisa a quienes corresponde. El canal de entrega
del enlace sigue siendo el que el usuario elija manualmente.

Cada cuenta solo lee su bandeja bajo RLS. No puede insertar mensajes, cambiar el
destinatario ni escribir directamente en preferencias: usa RPC con identidad
verificada. La outbox y sus auxiliares no son ejecutables ni legibles por el
cliente. Los avisos son mínimos: sin tickets, productos, notas privadas o tokens.
Antes de entregar se revalida acceso al origen. Los avisos ya entregados conservan
texto genérico sin conceder nuevo acceso al recurso.

Los invitados no tienen bandeja. La outbox captura cuentas reales al crear el
evento; no se reasignan avisos antiguos si en una fase futura se vincula un
invitado. Esa fase deberá exigir verificación y diseñar un historial autorizado
por recurso. No se activó esa vinculación ni se hizo backfill de avisos anteriores
a 008.

## Recordatorios manuales

**Recordar pago** solo permite al acreedor autenticado solicitar un aviso de una
deuda neta positiva hacia él. El servidor calcula el importe vigente, encuentra
la cuenta del deudor y aplica **uno por par cada 24 horas y cinco por acreedor
en 24 horas**. No confía en un texto, monto o destinatario de la pantalla.
Respeta la preferencia de recordatorios del destinatario; el mensaje de resultado
no revela si esa persona los desactivó.

Para un invitado devuelve un mensaje copiable, sin crear una bandeja ni enviar
nada fuera de Tuki. **Copiar recordatorio** copia solamente la deuda ya visible
en pantalla y deja al usuario elegir si compartirla por un canal externo.
Tuki no usa herramientas de mensajería. Los administradores terceros no pueden
enviar recordatorios personales en nombre del acreedor.

Si la deuda se saldó antes de entregar un recordatorio en cola, se descarta.
Los avisos manuales son fotografías del importe al solicitarlo: el enlace lleva
al saldo actual, que puede haber cambiado parcialmente después.

## Preferencias y automáticos opcionales

En Configuración: Pagos, Gastos, Grupos, Recordatorios y Automáticos personales;
frecuencia semanal o quincenal. Los informativos vienen habilitados y los
automáticos **deshabilitados**. Desactivar pagos no elimina solicitudes:
**Pagos por confirmar** permanece accesible con los permisos de Fase 5.

Los automáticos son **recordatorios personales al titular que optó por recibirlos**
sobre saldos por pagar o cobrar. No envían mensajes automáticos a otras personas.
Se omiten pares saldados, se respeta un intervalo de 7/14 días y se revalida saldo
y preferencia antes de entregar. El proceso agrega hasta 200 avisos por ejecución;
las siguientes ejecuciones continúan con los pendientes elegibles.

Para activarlos hacen falta tanto preferencia del usuario como una configuración
autorizada del despliegue. No se añadió un cron de Vercel ni se asumió ningún plan.
La ruta preparada es **POST `/api/internal/reminders`**, deshabilitada por defecto.
Requiere configurar **solo en el servidor**:

```dotenv
TUKI_AUTOMATIC_REMINDERS_ENABLED=false
TUKI_CRON_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
```

1. Obtené la service role del proyecto y mantenela fuera de `NEXT_PUBLIC_` y del
   repositorio. Su uso está limitado a esta ruta del servidor. Nunca la pegues
   en formularios ni código del navegador.
2. Generá un secreto aleatorio de al menos 32 caracteres; por ejemplo, localmente:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. Después de autorizar la ejecución automática, cambiá el flag a `true` y
   reiniciá/desplegá. Configurá un programador de confianza que soporte POST
   diario por HTTPS con `Authorization: Bearer <tu secreto>`. No lo coloques en
   la URL. Puede ser cualquier servicio compatible; no necesita Vercel Cron.
4. La ruta usa comparación segura del secreto y ejecuta únicamente
   `tuki_run_automatic_reminders()`, con EXECUTE reservado a `service_role`.
   Es reintentable: no repite avisos dentro de su intervalo. No devuelve datos
   personales, solo cuántos avisos quedaron en cola.
5. Para detenerlo, desactivá el programador y volvé el flag a `false`. Desactivar
   una preferencia también impide entregar automáticos todavía en la outbox.

El proxy omite la sesión de navegador **solo para esa ruta exacta**, cuya
autenticación es su propio secreto. Las demás rutas privadas siguen protegidas.
No se configuró ni se probó un programador externo real durante este trabajo.

## Probar con Juana y Piria Halloween

Usá datos de prueba: los pagos y gastos quedan auditados. Verificá IDs globales
compartidos, no solo nombres iguales.

1. Generá en Piria una deuda de Mati a Pablo de **800 UYU**, con ambos activos en
   Juana. Abrí Juana con la cuenta de Pablo y pulsá **Pago parcial**. El diálogo
   ya debe mostrar Mati → Pablo y el origen Piria; ingresá **300**, fecha y método.
2. Pablo confirma que recibió el dinero: el saldo baja inmediatamente a **500**
   tanto en Juana como en Piria. Hay un solo pago, una asignación y auditoría de
   recepción declarada. Mati no tiene que aprobarlo otra vez.
3. Repetí desde Mati usando Marcar como pagado: queda **esperando confirmación**;
   la deuda no baja. Pablo recibe el aviso y confirma desde Pagos. Un administrador
   tercero no puede usar la recepción directa fingiendo ser Pablo.
4. Probá un invitado que paga a Pablo: Pablo puede declarar el cobro. En sentido
   inverso, si cobra el invitado, corresponde confirmación administrativa
   independiente. Entre dos invitados se conserva esa independencia.
5. Abrí la campana de cada cuenta, marcá un aviso leído y filtrá no leídos. No debe
   verse la bandeja de otra cuenta. Un observador de Juana ajeno a Piria solo ve
   la deuda proyectada: no recibe avisos del gasto privado ni puede abrir su ticket.
6. Creá, editá y anulá un gasto sin pagos confirmados que involucre a otra cuenta.
   Esa cuenta recibe el aviso del tipo correcto; usuarios no involucrados no.
7. Con un saldo pendiente, el acreedor pulsa Recordar pago. Repetir antes de 24 h
   debe bloquearse. Un tercero no puede enviarlo en su nombre. Para invitados,
   probá Copiar recordatorio y verificá que no se envió nada automáticamente.
8. Desactivá avisos de pagos: deben seguir apareciendo las solicitudes en Pagos.
   Los automáticos no se ejecutan hasta completar la configuración anterior.
9. Anulá un cobro directo como su receptor con motivo y versión vigente: se
   revierte y avisa a la contraparte. Un reintento idéntico no duplica efectos.

## Archivos nuevos y validación

Resultado local de entrega: **285 pruebas aprobadas, ninguna fallida y 26
omitidas**. Incluye **20 pruebas SQL nuevas** y **103 SQL anteriores**. Las
omitidas requieren PostgreSQL local con varias conexiones: 3 nuevas y 23 de
fases previas. Lint, typecheck y build se ejecutan sobre la versión final.

- `supabase/migrations/202611020008_notifications_quick_payments.sql`.
- `features/notifications/{types.ts,links.ts,actions.ts,components.tsx}`.
- `features/payments/{quick-actions.ts,quick-data.ts}`.
- `features/payments/components/{quick-debt-actions.tsx,administrative-contexts.tsx}`.
- `app/(private)/notificaciones/page.tsx` y `app/api/internal/reminders/route.ts`.
- `tests/notifications-sql.test.ts`, `notifications-actions.test.ts`,
  `notifications-ui.test.tsx`, `notifications-concurrency.test.ts`,
  `quick-debt-actions.test.tsx`, `reminder-cron-route.test.ts`.
- Esta guía. Se actualizaron shell, deudas, pagos, Configuración, proxy, README
  y `.env.example`. Las migraciones 001–007 permanecen sin modificar.

Pruebas SQL reales con PGlite cubren recepción completa/parcial, invitado y
administrador, independencia, reversión, idempotencia, proyecciones, outbox,
fallos de entrega, preferencias, RLS, invitaciones, gastos y recordatorios.
La validación completa usa lint, typecheck, tests y build.

Hay tres escenarios concurrentes nuevos para PostgreSQL real: dos cobros completos,
un mismo cobro con reintento simultáneo y dos recordatorios del mismo par. Para
ejecutarlos, usá una base **nueva, local y descartable**:

```powershell
$env:TUKI_NOTIFICATIONS_TEST_DATABASE_URL = 'postgresql://USUARIO:CLAVE@127.0.0.1:5432/tuki_phase6_test'
npx vitest run tests/notifications-concurrency.test.ts
Remove-Item Env:TUKI_NOTIFICATIONS_TEST_DATABASE_URL
```

No acepta hosts remotos ni reinicia bases existentes. Sin PostgreSQL local esas
pruebas se omiten, no se consideran aprobadas. PGlite no demuestra concurrencia
entre conexiones. Quedan pendientes ese control, la prueba manual de tu Supabase,
el programador externo y la revisión visual en dispositivos reales.

Límites: no hay email, SMS, push, entrega externa de enlaces, reclamo de invitados,
notificaciones históricas anteriores a 008 ni sincronización en tiempo real al
segundo. La bandeja muestra las últimas 100, sin paginación adicional ni política
automática de retención todavía. Los eventos privados acumulados deben conservarse
o depurarse mediante una política explícita futura; no se borran datos existentes.
No se avanzó a la Fase 7.
