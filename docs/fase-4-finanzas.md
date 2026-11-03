# Fase 4: gastos, deudas compartidas y eliminación segura

Implementación incremental sobre las Fases 1–3. No incluye pagos, liquidaciones,
estadísticas avanzadas ni PWA. No se ejecutó SQL en Supabase desde este trabajo.
No cambia la confirmación de email, las claves ni las políticas de las fases anteriores.

## Aplicar en Supabase

1. Verificá el proyecto seleccionado y que ya aplicaste **001**, la **002 auditada** y **003**.
   No vuelvas a ejecutar las migraciones ya aplicadas. No edites esos archivos.
2. Si todavía tenés invitados duplicados en Juana y Piria Halloween, usá primero
   la corrección de la Fase 3. Comprobá los IDs, no solo los nombres. Al instalar
   las tablas financieras, la herramienta 003 se bloquea por diseño; esta fase
   no implementa fusiones ni reasignaciones de gastos entre identidades.
3. En **SQL Editor → New query**, pegá el archivo completo
   `supabase/migrations/202611020004_finance.sql` y ejecutalo **una sola vez** como
   propietario del proyecto. Incluye su propia transacción `begin` / `commit`.
4. En otra consulta ejecutá completo `202611020005_safe_removal.sql`, una sola vez.
5. Ambas migraciones notifican a PostgREST que recargue el esquema. Si una falla,
   revisá el error y el orden; no borres tablas para reintentarlo. Reiniciá el
   servidor de desarrollo y recargá Tuki después de aplicarlas.

No requiere variables nuevas, service role en el navegador, buckets ni URLs
públicas de archivos. Mantené `tuki_private` fuera de **Exposed schemas** de la
API. Su permiso `USAGE` y las funciones auxiliares de lectura ya existían en 002;
los nuevos auxiliares de eliminación no son ejecutables por clientes.

## Cómo funciona

`expenses` identifica el gasto; `expense_revisions` conserva cada versión con
importe original, cotización fija, total UYU, pagador y comprobante. `expense_shares`
conserva sus repartos. `expense_people_history` registra **todas** las personas que
alguna vez intervinieron, incluso después de editar el reparto. `expense_events`
registra creación, edición y anulación. Los clientes no pueden escribir en tablas.

Solo miembros activos pueden crear gastos en grupos activos. El autor o un
administrador activo puede editar o anular. Editar exige la versión vigente;
dos ediciones sobre la misma versión no se pisan. Crear usa un UUID estable y
una huella del contenido para que reintentos idénticos no generen obligaciones
duplicadas. Anular conserva las revisiones y cancela las obligaciones activas;
no borra gastos. Se permite anular un gasto de un grupo archivado conservando
el registro de esa corrección; no se permite crear ni editar allí.

Dinero en centésimos enteros con `bigint` en TypeScript y `numeric` en PostgreSQL.
Las respuestas financieras usan strings decimales. Hasta 2 decimales para importes,
6 para cotización y 4 para porcentajes/cantidades. La conversión es manual y
redondea medio centésimo hacia arriba una vez. Los importes personalizados son
en **UYU**. Los demás repartos usan mayor resto; empates por UUID ascendente.
El pagador puede quedar fuera de los participantes seleccionados.

Cada obligación vincula dos `persons` y conserva gasto, revisión y grupo de origen.
Una edición desactiva las anteriores y registra nuevas obligaciones; no reescribe
su historia. Se compensan únicamente direcciones inversas del mismo par. Nunca
se triangulan cadenas de tres personas. Las proyecciones no crean filas nuevas.

En **Grupo → Gastos y balances**, el balance propio muestra lo pagado, consumido
y su diferencia por los gastos originados ahí. Las deudas compartidas incluyen
obligaciones de cualquier origen cuando **ambas personas son miembros activos**
del grupo consultado. Muestran nombres, importe UYU y grupo de origen, sin IDs
de gasto, notas, moneda original ni comprobantes ajenos. Archivar el origen no
extingue obligaciones. Retirar a alguien lo excluye de esas proyecciones, pero no
borra sus deudas globales. El resumen personal consulta obligaciones únicas de
la persona, nunca suma los totales repetidos de los grupos.

## Comprobantes

PNG, JPEG o PDF, hasta **512 KiB**, MIME y firma inicial comprobados en servidor
y SQL. Se guardan privados en PostgreSQL, versionados con el gasto. Descarga por
Route Handler que verifica sesión y RLS del grupo de origen en cada petición,
con `no-store`, `nosniff` y descarga como adjunto. No usa enlaces públicos ni
URLs firmadas que queden vigentes después de perder acceso. Quitar o reemplazar
el archivo solo afecta a la nueva versión, conservando las anteriores.

Este mecanismo es sencillo para comprobantes pequeños; no es un almacenamiento
masivo ni un antivirus. Antes de ampliar tamaños o volumen, diseñar Storage
privado con autorización equivalente, retención y límites de consumo.

## Eliminaciones

- **Grupo → Eliminar grupo definitivamente**: exige administrador activo y
  confirmación. Solo permite grupos que nunca tuvieron actividad financiera.
  Incluso con todos los gastos anulados, `had_financial_activity` conserva la
  prohibición permanente. Se eliminan explícitamente eventos administrativos,
  invitaciones y membresías; nunca `persons`. Si tuvo gastos, usá **Archivar**.
- **Participante → Eliminar participación**: solo administrador; último
  administrador activo protegido. Sin referencias incompatibles, borra solo
  esa membresía. Con gastos históricos, invitaciones consumidas, auditoría o
  reemplazos, conserva y retira. Informa qué ocurrió. No cambia otros grupos.
  El administrador puede reactivar un retirado mediante Gestionar participación;
  una fila reemplazada en 003 nunca puede reactivarse. Para membresías borradas,
  reutilizá el invitado existente por ID o generá otra invitación para una cuenta.
- **Mis invitados**: solo el creador de un invitado sin cuenta puede borrarlo.
  Se inspeccionan todas las FK entrantes; una sola referencia de grupo,
  invitación, auditoría, gasto o reemplazo bloquea la operación. Quitar una
  membresía puede dejar eventos administrativos: en ese caso la identidad se
  conserva, como corresponde. No se buscan coincidencias por nombre.

Las operaciones comparten el bloqueo de la fila del grupo con creación de gastos,
cambios de membresía e invitaciones. Las comprobaciones ocurren después del
bloqueo y dentro de la transacción. La eliminación de huérfanos bloquea la persona;
las FK impiden insertar nuevas referencias a una identidad eliminada. El borrado
de grupo/huérfano deja una auditoría mínima en `lifecycle_audit`, sin nombre de
grupo ni detalles privados. No hay cascadas indiscriminadas.

La eliminación física falla de forma conservadora si aparecen tablas de dominio
desconocidas o referencias de otros esquemas. Al incorporar pagos/liquidaciones,
hay que revisar estas reglas explícitamente; no basta con añadir tablas nuevas.

## Prueba manual: Juana y Piria Halloween

1. Confirmá que Pablo, Mati y Guille usan **los mismos IDs globales** en ambos
   grupos. Reutilizá invitados existentes; no los crees otra vez por nombre.
   Facu debe estar solo en Piria Halloween. Trabajá con datos de prueba: los
   gastos que crees quedarán en el historial aunque los anules.
2. En Piria Halloween → Nuevo gasto: 1.000 UYU, pagó Mati, reparto igual entre
   Mati y Pablo. Pablo debe 500 a Mati. Verificá la obligación en Piria y Juana:
   misma obligación, origen Piria Halloween; en Juana no aparece como gasto propio.
3. Creá otro gasto de 400 UYU, pagó Pablo, entre Pablo y Mati. El neto es 300
   a favor de Mati. Desplegá obligaciones originales: 500 y 200, no una fusión.
4. Un gasto pagado por Pablo con solo Facu seleccionado genera deuda de Facu
   a Pablo; no se muestra en Juana. Para la dirección Pablo → Facu, elegí a
   Facu como pagador y solo a Pablo en el reparto.
5. Probá porcentajes 33.3333 / 66.6667, cantidades 1 / 3 y personalizados que
   sumen el total UYU. Probá 0.01 USD a 40.5: total 0.41 UYU. Cambiar la
   cotización de otro gasto no debe alterar el anterior.
6. Entrá con un usuario que pertenezca a Juana pero no a Piria. Ve la deuda
   compartida y el origen; no debe poder abrir detalles ni descargar comprobantes
   de Piria, aunque copie sus URLs. Comprobá también pérdida de acceso al retirarse.
7. Editá y luego anulá un gasto: se conserva su historial; cambian las deudas
   activas. Archivá Piria: sus deudas activas siguen proyectándose en Juana.
8. En un **grupo de prueba sin gastos**, agregá un invitado y eliminá su
   participación: informa eliminación de membresía, sin borrar la identidad.
   Con un participante que haya intervenido en gastos, informa retiro lógico.
   Intentá quitar al último administrador: debe bloquearse.
9. Eliminá un grupo vacío de prueba: desaparecen sus referencias administrativas;
   sus invitados globales permanecen. Un grupo que tuvo un gasto, incluso anulado,
   no puede borrarse: debe archivarse. Revisá Mis invitados: solo un huérfano
   sin referencias se puede eliminar; las cuentas registradas no son candidatas.

## Validación y límites pendientes

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

Resultado local de entrega (2 de noviembre de 2026): lint, typecheck y build
correctos; **189 pruebas aprobadas y 14 omitidas**. Incluye **68 pruebas SQL reales**
(50 de grupos/corrección y 18 financieras) sobre PostgreSQL embebido. Las 14
omitidas son los escenarios de concurrencia con PostgreSQL externo local.

Las pruebas financieras puras comprueban conversión, cuatro repartos,
compensación por pares y deduplicación. Las pruebas SQL con PGlite aplican las
cinco migraciones reales, usan roles autenticados, RLS, privilegios y RPC, y
verifican aislamiento, historial, anulaciones y eliminación. La suite anterior
se conserva como regresión, incluyendo autenticación y corrección prefinanciera.

**PGlite no prueba concurrencia entre conexiones.** La suite optativa nueva usa
PostgreSQL local real, dos conexiones y observa que la segunda espere un bloqueo:
crear gasto versus borrar grupo (ambos órdenes), quitar participante (ambos
órdenes), ediciones simultáneas, archivo y reintentos. Requiere una base
**nueva y descartable** `tuki_phase4_test` y un usuario local con permisos DDL:

```powershell
$env:TUKI_FINANCE_TEST_DATABASE_URL = 'postgresql://USUARIO:CLAVE@127.0.0.1:5432/tuki_phase4_test'
npx vitest run tests/finance-concurrency.test.ts
Remove-Item Env:TUKI_FINANCE_TEST_DATABASE_URL
```

No usa `.env.local`, no acepta hosts remotos, no elimina ni reinicia bases
existentes. Cambia únicamente esa base local de prueba. La suite concurrente
anterior usa otra base (`tuki_phase3_test`). Sin esas variables, los escenarios
se marcan **omitidos**, no aprobados. En este entorno faltó un PostgreSQL local
para ejecutarlos: quedan pendientes junto con la prueba manual contra tu proyecto
Supabase y la revisión visual en móvil/escritorio. No se ejecutaron operaciones
de usuario ni migraciones remotas para validar el build.

Límites: hasta 100 participantes por gasto; nueve monedas de dos decimales;
importes originales de hasta 10.000.000.000 unidades, cotización hasta 1.000.000
y total hasta 1.000.000.000.000 UYU. No hay paginación del listado financiero
todavía; revisar límites de respuesta/volumen antes de un uso grande. No hay
pagos, liquidaciones, reclamos de invitados ni fusiones de identidades.
