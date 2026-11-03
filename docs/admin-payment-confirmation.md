# Pagos y confirmaciones: revisión posterior a Fase 6

Esta revisión sustituye la regla anterior de administrador independiente. No agrega
otra contabilidad ni avanza a Fase 7. Todos los importes finales siguen en UYU y
las asignaciones usan las obligaciones y el motor FIFO/manual existentes.

## Aplicar

1. En el proyecto Supabase correcto, verificá que estén aplicadas las migraciones
   001 a 008, en orden. Hacé una copia de respaldo antes de modificar producción.
2. Abrí `supabase/migrations/202611020009_admin_payment_confirmation.sql`, copiá
   su contenido completo y ejecutalo **una sola vez** en Supabase SQL Editor como
   propietario. No vuelvas a ejecutar ni edites las migraciones anteriores.
3. Desplegá esta versión de la aplicación o reiniciá el servidor local y recargá
   Pagos/Notificaciones. No requiere nuevas variables ni cambiar RLS, Auth o cron.

No se ejecutó SQL remoto desde el desarrollo. La migración es transaccional:
reemplaza funciones, incorpora el motivo administrativo y cambia el aprobador de
los pagos **pendientes** al receptor. No confirma pagos antiguos automáticamente,
no cambia importes/asignaciones y conserva los pagos ya resueltos y su auditoría.
Las solicitudes pendientes reciben un aviso al receptor o administrador habilitado
si todavía no tenían uno en el outbox.

## Reglas y uso

- **Dos cuentas registradas:** el pagador registra un pago pendiente. Solo el
  receptor confirma o rechaza, desde Notificaciones o Pagos por confirmar. Ser
  administrador no habilita a sustituir al receptor. El receptor también puede
  registrar y confirmar directamente un cobro que recibió.
- **Una o ambas personas invitadas:** abrí Pagos desde el grupo de origen. Un
  administrador activo puede registrar y confirmar en una operación, con motivo
  de 8 a 500 caracteres y confirmación explícita. Puede ser el creador del pago
  o una de sus partes; no necesita otro administrador. Las solicitudes antiguas
  del ámbito del grupo también pueden confirmarse desde Pagos o Notificaciones.
- **Pago parcial:** usá Pago parcial y cambiá el importe; Marcar como pagado
  propone el máximo autorizado. El servidor comprueba nuevamente saldo y permisos
  dentro de la transacción. Los pendientes no reservan ni descuentan deuda.
- Los filtros Todos, Pendientes, Esperando confirmación y Saldados están en
  Saldar deudas, también al abrirlo para un grupo. Cada par enlaza su historial
  visible. Los comprobantes y las notas conservan sus permisos originales.
- La auditoría conserva autor, fecha, método, importe, partes, grupo, motivo y
  modo de confirmación. Una confirmación administrativa es una declaración, **no
  prueba de una transferencia bancaria**. Las cuentas involucradas reciben el
  resultado en el outbox existente; los invitados no reciben cuentas ni inbox.

## Tres pruebas manuales

1. **Dos cuentas:** generá una deuda de $800, entrá como pagador y registrá $300.
   El saldo sigue en $800. El receptor verá “¿Recibiste el dinero?”; al confirmar
   queda $500. El pagador, aunque sea administrador, no puede confirmar su pago.
   En otro pago, elegí No recibí el pago, agregá motivo y comprobá que no descuente.
2. **Administrador e invitado:** desde el origen de una deuda con un invitado,
   registrá $300 de $800, agregá motivo y aceptá la declaración administrativa.
   Queda confirmado por ese administrador y resta $500 sin pedir una segunda
   cuenta. Repetí con un invitado como receptor y con dos invitados. Un miembro
   sin rol administrador no obtiene esa autorización.
3. **Identidad compartida:** reutilizá la misma persona invitada en dos grupos.
   Pagá parcialmente desde el origen y comprobá que el saldo se actualice en
   ambos grupos sin duplicar pago ni obligaciones. Un administrador del otro
   grupo no puede imputar ese pago a obligaciones ajenas a su origen.

También podés probar el cobro directo como receptor registrado y anular un pago
con motivo: se revierten asignaciones y se recupera el saldo conservando eventos.
Las repeticiones con el mismo ID no duplican el pago; una solicitud nueva que
excede el saldo disponible se rechaza.

## Límites conservados

La declaración administrativa cubre **un único origen autorizado** y queda limitada
por el saldo neto del par. Si una deuda proyectada reúne varios orígenes, abrí el
origen correspondiente y registrá solo el importe habilitado allí. No habilita
compensaciones triangulares, créditos ni movimientos entre grupos por autoridad
administrativa. La confirmación personal del receptor mantiene el alcance global
existente. La visibilidad de historial/comprobantes no se amplía a otros grupos.

Los avisos se entregan al consultar el inbox; no hay envío externo ni tiempo real.
Las preferencias pueden desactivar avisos, pero las solicitudes siguen en Pagos.
Los recordatorios automáticos conservan su configuración desactivada por defecto.

## Archivos de esta revisión

Nuevos:

- `supabase/migrations/202611020009_admin_payment_confirmation.sql`
- `features/payments/components/debt-board.tsx`
- `features/notifications/payment-actions.tsx`
- `tests/admin-payment-sql.test.ts`
- `tests/admin-payment-concurrency.test.ts`
- `tests/debt-board.test.tsx`
- `tests/notification-payment-actions.test.tsx`
- `docs/admin-payment-confirmation.md`

Actualizados: formularios y diálogos de pagos, workspace, acciones de servidor,
validación, tipos y errores de `features/payments`; componentes y tipos de
notificaciones; detalle del grupo y README. Se ampliaron las pruebas de acciones
y diálogos y se ajustaron los mocks de los componentes que incorporan esos nuevos
límites de servidor. Los fixtures históricos de notificaciones se fijaron hasta
008 y se corrigió un delimitador SQL de su prueba opcional de concurrencia.
Las migraciones 001–008 se mantienen sin cambios.

## Verificación local

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
Las pruebas SQL con PGlite aplican las migraciones y ejercitan permisos, estados,
proyecciones, rechazo, reversión, idempotencia y compatibilidad con pendientes de
008. Los fixtures de fases anteriores quedan fijados a su versión de esquema.

Para concurrencia real, usá una base PostgreSQL local **vacía y descartable**
llamada `tuki_admin_payments_test`, con usuario que pueda crear roles y esquemas.
Definí `TUKI_ADMIN_PAYMENTS_TEST_DATABASE_URL` solo para ese comando y ejecutá
`npx vitest run tests/admin-payment-concurrency.test.ts`. El guard impide conexiones
remotas y no sobrescribe bases ya inicializadas. Sin esa variable, esas pruebas
se omiten explícitamente; PGlite no sustituye una prueba de dos conexiones reales.
