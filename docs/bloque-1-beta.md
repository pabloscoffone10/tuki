# Tuki — Bloque 1: integridad y preparación de beta

Fecha: 2026-11-03. Trabajo sobre el proyecto existente. No hay cambios de identidad
visual, motor de liquidación paralelo, transferencias bancarias ni Bloque 2.
No se leyó el contenido de `.env.local`, ejecutó SQL remoto, modificó producción,
instaló dependencias ni llamó al proveedor de IA durante las pruebas.

## Problemas reinspeccionados y correcciones

| Hallazgo confirmado en código | Corrección |
| --- | --- |
| Reabrir QuickDebtActions generaba una nueva clave sin consultar el intento anterior | Operación durable por cuenta en PostgreSQL, recuperación antes de mostrar formularios, mismo ID para reenviar y reconocimiento explícito antes de otro pago |
| Una respuesta HTTP perdida no distinguía rechazo de resultado desconocido | Preparar, enviar y consultar son pasos separados; errores de transporte bloquean nuevos pagos hasta conciliar |
| Un pago histórico podía producir “Saldado” por faltar la obligación en la proyección | `pair_states` obtiene evidencia explícita del libro autorizado; falta de evidencia produce `unverifiable`/null, nunca cero |
| El bloqueo conservador de edición no explicaba completamente la salida | Se conserva el bloqueo y se describe la reversión autorizada, incluidas deudas inversas y privacidad entre grupos |
| Escaneo reservaba hash por 24h aunque fallara y no guardaba resultado recuperable | Cache privado por dueño/grupo/hash, estados, lease, resultados recuperables, reintentos controlados y cuotas existentes |
| Faltaba ejecución reproducible de carreras PostgreSQL y procedimiento operativo | Entorno Docker/local aislado, once carreras de beta, auditoría de permisos, SELECT de conciliación y guía de recuperación |

No se afirmó una vulnerabilidad explotada de RLS. Se agregaron pruebas positivas y
negativas y de catálogo; las políticas desplegadas todavía requieren comprobación
en el proyecto real. El riesgo de duplicación por respuesta perdida se reprodujo
como escenario local controlado, descartando la respuesta de una operación de 300
UYU y recuperando el mismo ID sin una segunda asignación.

## Protocolo durable de creación de pagos

La nueva tabla `tuki_private.payment_operations` no puede leerse/escribirse desde
roles del navegador. Contiene temporalmente payload y comprobante; las respuestas
incluyen solamente estado, referencia y un resumen autorizado para el dueño.
No se usa localStorage/sessionStorage/IndexedDB para conservar datos de pagos.

1. `tuki_prepare_payment(id,data,true)` guarda un intento inmutable en servidor.
2. `tuki_submit_prepared_payment(id)` usa ese mismo payload y el motor de 009.
3. `tuki_current_payment_operation()` o `tuki_payment_operation(id)` concilia.
4. `tuki_ack_payment_operation(id)` reconoce un resultado ya procesado/rechazado.
5. `tuki_cancel_payment_operation(id)` cancela únicamente un intento preparado
   sin pago registrado; invalida cualquier envío tardío de esa clave.

Un índice único admite una operación sin reconocer por cuenta, compartida entre
diálogos, formularios, pestañas, grupos y dispositivos autenticados. Una segunda
clave no reemplaza silenciosamente al intento anterior. El endpoint heredado
`tuki_create_payment` conserva su firma y tampoco puede saltarse esta protección.

Las operaciones de envío/cancelación/reconocimiento y las consultas de recuperación
se serializan mediante el bloqueo financiero existente. La consulta espera un
commit en curso antes de declarar un intento ausente o preparado. No se sostiene
un bloqueo de base durante peticiones al proveedor de IA.

| Estado | Significado y acción |
| --- | --- |
| No enviada / `prepared` | Todavía no existe un pago de este intento. Revisar resumen y enviar la misma clave, o cancelar de forma segura |
| Procesando | La interfaz espera el envío; no habilita doble clic ni un pago nuevo |
| Procesada / `processed` | Existe el pago; consultar `payment_status`, reconocer el resultado y recién entonces iniciar otro pago legítimo |
| Rechazo técnico / `rejected` | La subtransacción financiera se revirtió por una validación definitiva. No se creó un pago; reconocer y corregir en otro intento |
| Resultado desconocido | No se conoce el resultado de transporte. Consultar; no generar automáticamente otra clave |
| Cancelada / `cancelled` | No se puede reutilizar esa clave ni enviarla posteriormente |

`processed` con `payment_status='pending'` **no significa deuda reducida**: el
registro terminó, pero falta el receptor. `payment_status='rejected'` es el
rechazo del receptor y difiere de un rechazo técnico del intento.

Reconocer elimina el payload temporal, no el pago, asignaciones ni auditoría.
No hay vencimiento automático que descarte intentos desconocidos. Dos pagos
reales de igual importe son válidos: el segundo se inicia explícitamente tras
reconocer el primero, no se deduplica por nombres, fecha o cantidad.

Compatibilidad: 001–009 permanecen intactas, pero los clientes antiguos que
registren otro pago sin reconocer el anterior recibirán `operation_unresolved`.
Publicar esta versión junto con el protocolo 010; no prometer compatibilidad
transparente con una pestaña antigua abierta.

## Saldos y estados financieros

`tuki_payment_workspace` conserva su información anterior y agrega `pair_states`:
pendiente, parcialmente pagada, saldada o no verificable. Una solicitud pendiente
se indica por separado: no descuenta dinero ni oculta el saldo pendiente.

- Se leen obligaciones activas, incluidos sus importes restantes cero, y las
  asignaciones confirmadas no revertidas.
- Cero neto se verifica con obligaciones explícitas, incluidas compensaciones
  inversas; no se deduce de un array vacío.
- La parte autenticada consulta su alcance personal. La proyección compartida
  mantiene la regla de ambas identidades activas en el grupo consultado.
- Cuando solo hay autoridad administrativa del origen, se devuelve el alcance
  `group` y se explica que no necesariamente representa el total global.
- Sin evidencia o permiso suficiente se devuelve saldo null/no verificable.
- El historial sigue disponible según sus permisos originales. No se revelan
  títulos, notas, productos ni comprobantes de otros orígenes.

Se conserva `assert_expense_unsettled`: puede bloquear por pagos confirmados de
un mismo par, incluso inversos. El detalle explica que sus autorizados deben
anular los pagos con motivo, corregir el gasto y volver a registrarlos. No entrega
IDs privados ni otorga autoridad para revertir pagos de otros grupos.

## Escaneo recuperable

011 agrega `tuki_private.scan_jobs`; solo su dueño con membresía vigente puede
reservar/finalizar o recuperar, incluso si otra persona integra el mismo grupo.
La tabla no almacena imágenes, solo extracción estructurada con caducidad de 24h.

- Estados: pending, processing, completed, failed y recoverable.
- Lease de 2 minutos: la misma lectura activa no inicia otra petición.
- Fallo conocido: reintento después de 1 minuto, bajo cuotas.
- Resultado de proveedor desconocido/lease vencido: exige aceptación extra antes
  de repetir una llamada que podría generar otro costo.
- Completed: recupera el resultado existente sin llamar otra vez al proveedor,
  también cuando se deshabilitó IA. Requiere el mismo archivo y grupo.
- El resultado se valida con Zod y se confirma su persistencia antes de anunciar
  completado. Perder la respuesta de persistencia conduce a consultar, no repetir.
- Se conservan consentimiento, validación de archivos/páginas y límites:
  10 solicitudes por usuario/día, 2/minuto y 200 globales/día.
- La carga manual sigue disponible, incluida IA deshabilitada.

La reserva antigua `tuki_reserve_scan` deja de ser ejecutable por clientes.
`tuki_purge_expired_scans()` queda solo para el operador/service-role. Ejecutarla
diariamente mediante un programador autorizado o manualmente; no se habilitó
ningún cron remoto. El cache expira lógicamente aunque no se haya purgado.
Después de caducar no se garantiza recuperar una extracción anterior.

No existe garantía de “exactamente un cobro” del proveedor cuando se pierde una
respuesta externa. Se evita repetir automáticamente; una repetición autorizada
podría producir otro costo. Todas las pruebas del proveedor usan respuestas mock.

## Errores, seguridad y observabilidad

Los mensajes separan permisos, conflicto de versión/saldo, rechazo definitivo,
operación procesada e incertidumbre de red. Las referencias son UUID de operación;
los logs nuevos de pagos contienen solo evento, operación, referencia y código
permitido. No incluyen payloads, cantidades, identidades, recibos, tokens ni claves.
Los logs de escaneo contienen ID técnico y clasificación del resultado.

La matriz de roles, validación de RLS/EXECUTE/USAGE/SECURITY DEFINER/search_path,
URLs privadas, Storage y cron se detalla en [operaciones](bloque-1-operaciones.md).
No se contrató ni instaló monitoreo pago. El mecanismo de alerta preparado es la
conciliación diaria con responsable, además de revisión de los eventos seguros.

## Migraciones: aplicación manual

No ejecutar otra vez 001–009. Verificar primero que 009 esté aplicada y tomar
respaldo verificado. Ensayar en una copia aislada antes del proyecto de beta.

1. Abrir `supabase/migrations/202611020010_financial_integrity.sql`.
2. Pegar **todo** en SQL Editor del proyecto correcto como propietario y ejecutar
   una sola vez; esperar commit sin errores.
3. Repetir con `202611020011_scan_recovery.sql`, en ese orden.
4. Ejecutar el SELECT de conciliación dentro de `BEGIN TRANSACTION READ ONLY`.
5. Publicar/reiniciar esta versión web y recargar las pestañas antiguas.
6. Realizar las pruebas manuales siguientes y conservar evidencia restringida.

Las migraciones no recalculan importes existentes ni confirman pagos antiguos.
La nueva función de eliminación reconoce exclusivamente la FK de cache de escaneo
que se elimina en cascada con su grupo financieramente vacío; referencias futuras
desconocidas siguen bloqueando eliminaciones.

Si falla una migración, confirmar rollback antes de reintentar. No pegar fragmentos
sueltos, borrar objetos para “hacerla pasar”, resetear Supabase ni editar balances.

## Validación y límites de evidencia

La batería completa se ejecuta con lint, typecheck, `npm test` y build. Incluye
pruebas unitarias/UI, integración de acciones mock y SQL con PGlite. Las suites
históricas están fijadas a su fase; las nuevas aplican 010/011 según corresponda.

Resultado ejecutado el 2026-11-03:

| Comprobación | Resultado |
| --- | --- |
| `npm run lint` | Correcto |
| `npm run typecheck` | Correcto |
| `npm test` | 360 aprobadas, 40 omitidas, 0 fallidas; 51 suites aprobadas y 7 omitidas |
| `npm run build` | Correcto; 29 páginas generadas |
| PostgreSQL con varias conexiones | No ejecutado: Docker/PostgreSQL no disponibles |
| Respaldo, restauración y conciliación reales | No ejecutados: requieren acceso y destino autorizados |

La batería nueva incluye 14 regresiones SQL financieras, 9 de escaneo, 7 de
permisos, 7 de conciliación y pruebas de acciones/interfaz. Los 40 escenarios
omitidos son de las siete suites PostgreSQL reales; once pertenecen a la suite
beta nueva. No se contabilizan como aprobados.

La conciliación es un SELECT owner-only probado tanto con fixtures consistentes
como corruptos: sumas de asignaciones/pagos, sobreasignación, estados, reversión,
partes/orígenes, obligaciones/repartos versionados, referencias, auditoría y tickets.
No considera duplicado dos pagos legítimos con igual importe y no modifica datos.
**No se ejecutó sobre los datos reales de Tuki**; no existe un informe real de
“cero inconsistencias”. Metadatos Storage no prueban existencia de los bytes.

Docker/psql/pg_ctl no están disponibles en este entorno. El runner lo detectó:
las pruebas de concurrencia PostgreSQL reales están omitidas, no aprobadas.
Se prepararon once carreras nuevas y un entorno local aislado; comandos y límites
de medición en [la guía operativa](bloque-1-operaciones.md). No se reemplazó el
bloqueo financiero global ni se inventaron tiempos de espera.

No se consultó el plan real de Supabase ni se realizó respaldo/restauración real.
La guía operativa distingue DB, comprobantes embebidos y bytes Storage, describe
restauración aislada, conciliación e incidentes y propone RPO/RTO a medir.
La recuperación automática por cuenta cubre intentos creados con 010. Los pagos
anteriores siguen en el historial y pueden consultarse por ID por su creador;
no se puede reconstruir retroactivamente una intención humana desconocida sin ID.

## Pruebas manuales para el operador

1. Dos registrados: registrar 300 de 800, comprobar saldo sin cambio; solo el
   receptor confirma o rechaza, incluido pagador con rol administrador.
2. Receptor registra su propia recepción: operación atómica, sin segunda
   confirmación. Con invitados, administrador del origen con motivo.
3. Interceptar/cortar la respuesta después del commit de un pago parcial: recargar,
   cerrar y reabrir; recuperar el mismo ID y una sola asignación. Reconocer resultado
   y comprobar que un segundo pago real de 300 sea posible con ID diferente.
4. Dos pestañas: preparar intentos distintos; una debe recuperar el intento
   existente. Cambiar de usuario no debe mostrar el intento del anterior.
5. Preparar sin enviar: cancelar y comprobar que un envío tardío del ID no cree pago.
6. Rechazo técnico por importe excedido: ningún pago/asignación; rechazo del
   receptor: pago rechazado existente y deuda conservada.
7. Compartir identidades entre Piria y Juana: actualización sin duplicación y sin
   acceso a gastos/comprobantes privados del otro origen.
8. Retirar participante/archivar grupo: verificar saldo histórico autorizado y
   estado no verificable cuando no corresponda revelar saldo, nunca cero inferido.
9. Anular un pago con motivo: revisar asignaciones revertidas y saldo restaurado.
   El gasto bloqueado debe explicar el procedimiento y no entregar IDs privados.
10. Escaneo con proveedor mock/entorno autorizado: respuesta fallida, reintento
    controlado, resultado cacheado y lease vencido. No realizar llamadas pagas
    como parte de las pruebas sin autorización.
11. Probar URLs directas de gastos/comprobantes, resultado de escaneo e intento
    ajenos; comprobar rechazo o ausencia, no solo botones ocultos.
12. Ejecutar el runner PostgreSQL real y un ensayo de restauración en destino
    aislado. Conservar salida, conteos, hashes de objetos y tiempo medido.

## Archivos creados y modificados

Nuevos:

- Migraciones `202611020010_financial_integrity.sql` y `202611020011_scan_recovery.sql`.
- `supabase/audits/financial_reconciliation.sql`.
- `features/payments/operation-types.ts`, `operation-server.ts`, `operation-actions.ts`,
  `debt-state.ts` y `components/operation-recovery.tsx`.
- `lib/operation-log.ts`.
- `docker/compose.concurrency.yml`, `docker/init-concurrency.sql` y
  `scripts/run-concurrency.mjs`.
- Pruebas `beta-financial-sql`, `beta-finance-concurrency`, `scan-recovery-sql`,
  `security-audit-sql`, `financial-reconciliation`, `payment-operation-actions`
  y `payment-operation-recovery`.
- Esta guía y `docs/bloque-1-operaciones.md`.

Modificados:

- Pagos: `actions.ts`, `quick-actions.ts`, `errors.ts`, `types.ts`,
  `components/payment-form.tsx`, `components/quick-debt-actions.tsx` y
  `components/debt-board.tsx`.
- Finanzas: `types.ts` y `components/views.tsx`.
- Cuenta inteligente: `actions.ts`, `provider.ts` y `components/smart-bill-form.tsx`.
- Pruebas de acciones/formularios/notificaciones/tablero/escaneo y los fixtures
  históricos `admin-payment-sql` y `admin-payment-concurrency` fijados hasta 009.
- README con acceso a estas guías.

## Decisión de beta

El bloque prepara el código y las herramientas; no declara listo un despliegue
sin comprobarlo. Antes de beta quedan como condiciones: concurrencia real aprobada,
políticas/migraciones reales verificadas, respaldo y restauración ensayados,
conciliación del proyecto y pruebas manuales de red, sesiones y comprobantes.
No se avanzó al Bloque 2.
