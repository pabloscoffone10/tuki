# Fase 5 — Pagos, liquidaciones y compensación

Nota de evolución: la [Fase 6](fase-6-notificaciones.md) añade cobros declarados
por el receptor con confirmación atómica y notificaciones. Después de aplicar
008, ese caso ya no necesita una segunda aprobación del pagador. Las reglas de
independencia siguen vigentes cuando un tercero administra pagos de invitados.

Tuki documenta dinero entregado **fuera de la aplicación**. No conecta bancos,
no mueve fondos y no crea billeteras, créditos generales ni pagos ficticios.
Todo el dinero final es UYU, con centésimos enteros, `bigint` y `numeric`.

## Aplicar la migración

1. Verificá el proyecto Supabase seleccionado y que ya aplicaste 001–006.
2. En **SQL Editor → New query** pegá completo
   `supabase/migrations/202611020007_settlements.sql` y ejecutalo **una sola vez**
   como propietario. Incluye transacción `begin` / `commit` y recarga de PostgREST.
3. No repitas ni modifiques las migraciones previas. Si falla, revisá el mensaje
   y el orden antes de reintentar; no borres tablas. El preflight exige la Fase 4.5.
4. Reiniciá el servidor local y recargá Tuki. No hacen falta variables nuevas,
   claves privadas, proveedores bancarios ni nuevos buckets.

No se ejecutó SQL remoto durante este desarrollo. No se leyó ni modificó
`.env.local`. La migración conserva los registros existentes y no confirma
pagos automáticamente.

## Integración y reglas financieras

`payments` guarda participantes globales, importe, fecha, método, nota/referencia,
contexto de grupo, creador, contraparte autorizante, versión y estado.
`payment_allocations` vincula cada pago confirmado con las obligaciones exactas
de una revisión de gasto, importe, actor y fecha. Una reversión conserva las
asignaciones con fecha y actor de reversión. `payment_events` audita cada transición.
No se borran pagos ni asignaciones desde la aplicación.

No se regeneran obligaciones al pagar. La vista privada `open_obligations`
calcula importe original menos asignaciones confirmadas no revertidas. Las RPC
existentes de balances y proyecciones usan esos pendientes. Las obligaciones
originales siguen intactas y las versiones de gasto conservan sus IDs.

La compensación de Fase 4 sigue siendo **matemática entre cada mismo par**. No
genera pagos ni asignaciones. Ejemplo: 500 en un sentido y 200 en el otro permiten
pagar 300. Confirmar ese pago deja 200 pendientes brutos por lado y saldo neto
cero; no vuelve a compensarse como si se hubieran pagado otros 200. No hay
triangulación ni entre grupos ni entre tres personas.

Un pago puede cubrir varias obligaciones, incluso de distintos orígenes cuando
lo registra una de sus contrapartes con cuenta y la otra contraparte lo confirma.
FIFO usa fecha de creación del gasto, versión e ID de obligación. La selección
manual restringe los candidatos y conserva ese mismo orden dentro de ellos.
Si una selección quedó desactualizada, no se redirige a otra obligación silenciosamente.

El importe se valida contra el neto global del par y, cuando corresponde, contra
el neto del ámbito autorizado. No puede superar el saldo ni quedar dinero sin
asignar. No hay saldos a favor independientes. Los pendientes no reservan deuda:
si dos solicitudes exceden juntas el saldo, la segunda confirmación falla y
puede rechazarse/anularse para registrar un importe corregido.

Los balances propios muestran pagado en gastos, consumido, pagos realizados,
pagos recibidos y balance pendiente. Los pagos se atribuyen a cada origen según
sus asignaciones, no al grupo desde el que se abrió el formulario. El resumen
personal consulta obligaciones únicas; nunca suma sus vistas repetidas por grupo.

## Autorización y confirmación

- Si registra el **pagador**, confirma el receptor. Si registra el **receptor**,
  confirma el pagador. El creador no puede aprobar su propio registro.
- Un administrador activo puede registrar pagos de otras personas **solo para
  obligaciones originadas en el grupo que administra**. Abrí Pagos desde ese
  grupo. Si la contraparte autorizante tiene cuenta, debe confirmar ella; otro
  administrador no puede reemplazar esa confirmación.
- Cuando la contraparte autorizante es **invitada sin cuenta**, el pago debe
  indicar su grupo de origen y queda limitado a obligaciones de ese grupo.
  Confirma administrativamente **otro administrador activo**, distinto del
  creador y de ambas partes del pago. Queda identificado por nombre, modo
  administrativo y evento de auditoría.
- **Decisión conservadora:** un único administrador no puede registrar y
  aprobar unilateralmente un pago propio o entre invitados. Se necesita otro
  administrador independiente o una contraparte registrada que corresponda al
  flujo. Esto puede exigir promover previamente a otra cuenta confiable. No
  se apropian invitados ni se les asigna una cuenta por coincidencia de nombre.
- El creador puede anular un pendiente. La contraparte o el administrador
  independiente autorizado puede confirmar o rechazar; rechazar/anular exige
  un motivo de al menos 8 caracteres.
- Un pago confirmado por cuenta se revierte únicamente por **quien lo confirmó**.
  Uno confirmado administrativamente puede revertirlo un administrador activo
  independiente bajo las mismas restricciones. El creador no puede revocar su
  propio pago confirmado eludiendo a la contraparte.

Cambiar un grupo de contexto no amplía los permisos del rol de administrador.
Un administrador de Juana no puede asignar por ese rol dinero a una obligación
privada de Piria. Si él mismo es una de las partes, sus permisos personales son
distintos de su rol administrativo y le permiten gestionar sus propias deudas.
Si existen compensaciones privadas, PostgreSQL puede rechazar un importe
administrativo sin revelar sus detalles; la validación del saldo siempre es final.

Los nombres, importes pendientes y orígenes compartidos mantienen la regla de
ambos miembros activos en el grupo receptor. Las notas, referencias, comprobantes
y auditoría de un pago solo son visibles a sus partes, creador y administradores
del ámbito de origen cuando el pago es administrativo/de ámbito de grupo.
El rol de un grupo receptor no concede acceso a un pago global ajeno.

## Archivo, retiros y correcciones de gastos

Las deudas de grupos archivados siguen siendo pagables; no se habilitan gastos
nuevos en ellos. Una contraparte retirada puede pagar o confirmar desde sus
deudas personales. Para operaciones de invitados puede abrir el contexto de un
grupo del que se retiró: esa vista histórica solo muestra sus propias obligaciones,
no los movimientos actuales de los demás. Las filas reemplazadas por 003 no
se pueden usar como membresías válidas ni se reactivan.

Una membresía relacionada con pagos registrados desde ese grupo se conserva y
retira, incluso si el pago luego fue rechazado o anulado. Registrar un pago desde
un grupo marca historia financiera permanente: ese grupo se archiva en vez de
borrarse. Las identidades globales conservan referencias por FK y no pueden
eliminarse como huérfanas mientras existan pagos o auditoría que las necesiten.

**Política de gastos pagados:** se bloquea editar o anular un gasto cuando alguno
de sus pares de personas tiene pagos confirmados vigentes, incluidos los pares
inversos usados en la compensación y referencias de revisiones anteriores. Es
deliberadamente conservadora: puede bloquear más gastos que los asignados
directamente. Primero deben revertirse los pagos de ese par por sus actores
autorizados, luego corregir el gasto y registrar/confirmar el pago correcto.
No hay ajustes contables automáticos ni reasignación silenciosa de pagos.

Un gasto con solo pagos pendientes se puede corregir. La confirmación pendiente
revalida el saldo actual y la selección; puede fallar por monto/obligaciones
cambiadas. Nada queda liquidado parcialmente. Esta protección también cubre
Cuenta inteligente y sus versiones.

## Interfaz y prueba con Juana / Piria Halloween

Usá datos de prueba y cuentas distintas. Los gastos y pagos permanecen en el
historial aunque se anulen. Confirmá que Pablo y Mati sean las mismas identidades
globales en los dos grupos, no invitados homónimos duplicados.

1. En Piria cargá un gasto que deje a Pablo debiendo **800 UYU** a Mati. Ambos
   deben estar activos también en Juana. Verificá la misma deuda en los dos grupos.
2. Con la cuenta de Pablo, abrí **Pagos → Saldar deudas** o **Gastos y balances →
   Pagos y liquidaciones de deudas**. Pulsá **Saldar** para ese par. Se abre el
   mismo formulario de registro manual con 800 precompletados. Cambialo a **300**,
   elegí fecha/método y confirmá que el dinero ya se entregó fuera de Tuki.
3. El pago queda **Pendiente de confirmación**. En ambos grupos siguen debiéndose
   800. Con la cuenta de Mati, abrí Pagos → **Pagos por confirmar** y confirmá.
   Ahora ambos grupos muestran **500**. Hay un solo pago y una asignación, no
   un registro por grupo. Podés descargar un comprobante solo con autorización.
4. Registrá el siguiente pago desde el receptor: Mati dice que recibió 200.
   Ahora debe confirmarlo Pablo. Mati no puede confirmar su propio registro.
5. Probá rechazo: una solicitud rechazada no reduce la deuda. Probá anular un
   confirmado con quien lo confirmó y un motivo: reaparece su saldo, manteniendo
   el evento y las asignaciones revertidas. El creador no puede hacerlo si no
   es quien está autorizado para revertir esa confirmación.
6. Creá dos obligaciones de Pablo a Mati, una en cada grupo, y registrá un pago
   que cubra ambas. Revisá FIFO y los grupos en las asignaciones del historial.
   Repetí con selección manual y un importe parcial. Probar más que el neto
   disponible debe fallar sin dejar un pago confirmado a medias.
7. Creá una obligación inversa: Pablo debe 500 y Mati debe 200. El neto es 300;
   no aparecen pagos ficticios por la compensación. Solo se permite saldar 300.
8. Para invitados, abrí Pagos desde **el grupo de origen** y probá con dos
   administradores independientes. El segundo confirma administrativamente y
   queda explícito en el historial. Un administrador de Juana no puede seleccionar
   por su rol una obligación originada únicamente en Piria.
9. Archivá un origen o retirate como contraparte: la deuda personal sigue
   disponible. En la vista histórica no deben verse deudas de otras personas.
10. Intentá editar/anular un gasto de un par con pago confirmado: debe bloquearse
    con explicación. Revertí primero el pago con autorización y luego corregí
    el gasto. Probá también una Cuenta inteligente.

El resumen de Pagos distingue Debés, Te deben, pendientes y confirmados. El
historial incluye pagador, receptor, monto, fecha, método, creador, confirmador,
modo de autorización, asignaciones y motivos de las transiciones.

## Seguridad, consistencia e idempotencia

Todas las escrituras usan RPC `SECURITY DEFINER` con `search_path=''`; las tablas
no tienen permisos de escritura para clientes. Las políticas RLS protegen pagos,
asignaciones y eventos; solo el auxiliar de autorización necesario para políticas
tiene EXECUTE autenticado. Los motores anteriores y los bloqueos son privados.

Esta fase usa una **fila privada de exclusión mutua para todas las mutaciones
financieras**. Siempre se adquiere antes de bloquear grupos o pagos. Simplifica
la seguridad frente a confirmaciones simultáneas, ediciones y anulaciones, a
costa de serializar escrituras financieras de pares independientes. No se
mantiene durante archivos, red o confirmaciones humanas; cada operación es una
transacción corta. Antes de escalar volumen, rediseñar bloqueos por par/grupo
con pruebas de orden de adquisición, no quitar este control sin reemplazo.

El formulario conserva un UUID para creación y una huella del contenido; el
reintento idéntico devuelve el pago existente. Cada transición tiene otro UUID
estable y huella de pago/versión/acción/motivo: repetirla no crea asignaciones
duplicadas. Cambiar el contenido de un ID existente falla. La versión impide
que una segunda confirmación o una página antigua pise el estado vigente.

Los comprobantes de pago son JPG/PNG/PDF de hasta **512 KiB**, con firma y MIME
comprobados en SQL. Se guardan privados junto al pago, sin URLs públicas. El
Route Handler verifica sesión y RLS y responde como adjunto `no-store`, `nosniff`
y sandbox. No se reutiliza el bucket de tickets de IA ni se envían comprobantes
de pago a OpenAI. No se registran archivos ni secretos en logs.

## Archivos nuevos

- `supabase/migrations/202611020007_settlements.sql`.
- `features/payments/types.ts`, `schemas.ts`, `errors.ts`, `data.ts`, `actions.ts`.
- `features/payments/components/payment-form.tsx`, `workspace.tsx`.
- `app/(private)/pagos/nuevo/page.tsx` y
  `app/(private)/pagos/[paymentId]/comprobante/route.ts`.
- `tests/payments-sql.test.ts`, `payments-actions.test.ts`,
  `payments-form.test.tsx`, `payments-receipt-route.test.ts`,
  `payments-concurrency.test.ts`.
- Esta guía. También se actualizaron Pagos, balances, detalles/edición de gasto,
  el enlace de grupo, ayuda, el aviso inicial y README. Las migraciones 001–006
  permanecen sin cambios; sus suites se conservan contra sus propias bases.

## Validación y pendientes

Validación local de entrega: **255 pruebas aprobadas y 23 omitidas**. Incluye
**22 pruebas SQL nuevas de pagos** y las **81 SQL previas**. Las omitidas son
5 escenarios nuevos con varias conexiones y 18 anteriores; falta un servidor
PostgreSQL local para ejecutarlas. Lint, typecheck y build se verifican con la
implementación final.

Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
Las pruebas SQL con PGlite aplican 001–007 y roles reales, RLS, permisos, FIFO,
selección, parciales/completos, compensación inversa, rechazo, reversión,
invitados, privacidad, historial, retiros, archivo y compatibilidad con Cuenta
inteligente. Las pruebas de interfaz confirman que Saldar y registro manual
comparten formulario y que no se cambia de par silenciosamente.

PGlite no prueba bloqueos entre conexiones. Se agregaron cinco escenarios
optativos con PostgreSQL real: confirmaciones que exceden el saldo, doble
confirmación, reintento concurrente con el mismo ID, confirmar antes de anular
gasto y anular gasto antes de confirmar. Para ejecutarlos usá una base local
**nueva y descartable** con un usuario con permisos DDL:

```powershell
$env:TUKI_PAYMENTS_TEST_DATABASE_URL = 'postgresql://USUARIO:CLAVE@127.0.0.1:5432/tuki_phase5_test'
npx vitest run tests/payments-concurrency.test.ts
Remove-Item Env:TUKI_PAYMENTS_TEST_DATABASE_URL
```

No acepta hosts remotos ni reinicia bases existentes; no carga `.env.local`.
Sin PostgreSQL local se omiten esos escenarios y no se consideran aprobados.
También quedan pendientes la prueba manual contra tu Supabase y la revisión
visual en móvil/escritorio. No se hicieron transferencias ni operaciones
remotas de usuarios para probar.

Límites: no hay notificaciones push/email (las solicitudes aparecen al abrir
Pagos), extractos bancarios, fondos reales, créditos generales, conciliación
bancaria ni ajustes contables automáticos. Los listados aún no están paginados.
No hay edición de un pago existente: anulá/rechazá según autorización y registrá
uno nuevo para conservar la historia. La eliminación manual de cuentas Auth
puede dejar confirmaciones sin su actor autorizado: requiere un procedimiento
administrativo futuro, no suplantación de identidades. No se avanzó a otra fase.
