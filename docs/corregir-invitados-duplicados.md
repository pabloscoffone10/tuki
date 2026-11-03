# Corregir un invitado duplicado en un grupo

Esta herramienta acotada sirve antes de cargar gastos o pagos. No es una fusión
global, no identifica personas por su nombre y no reclama cuentas ni invitados.

**Fase 4:** completá estas correcciones antes de aplicar la migración 004.
Al instalar las tablas financieras, la RPC se bloquea y la interfaz oculta esta
herramienta, incluso si todavía no cargaste gastos. No intentes quitar ese bloqueo.
Las membresías ya corregidas siguen siendo válidas y nunca se reactivan por error.

## Habilitar

Revisá y aplicá una sola vez, desde Supabase SQL Editor, el archivo nuevo:

`supabase/migrations/202611020003_replace_duplicate_guest.sql`

Requiere la Fase 3 auditada ya instalada. El preflight detecta si falta la
protección de retirados de esa base y detiene la aplicación. No repitas las
migraciones anteriores ni borres tablas si aparece ese error; hace falta revisar
una actualización incremental del esquema que tengas aplicado.

La migración agrega dos columnas de trazabilidad a membresías, su FK compuesta,
el tipo de evento `guest_replaced` y una RPC con permisos restringidos. Conserva
las políticas RLS, las cuentas, identidades, membresías e invitaciones existentes.
Extiende `tuki_set_member` para impedir reactivar una fila ya reemplazada. No
ejecuta ninguna corrección automáticamente y no modifica los grupos al aplicarse.
No se ejecutó SQL remoto durante el desarrollo.

## Ejemplo: conservar la identidad de Mati en Juana

1. Entrá como administrador de **Piria Halloween**.
2. En el Mati duplicado, abrí **Corregir invitado duplicado**.
3. Elegí la identidad de Mati que aparece con **Juana** como referencia.
   Revisá el ID global completo que muestra la selección; no alcanza con que los
   nombres sean iguales. Solo aparecen identidades invitadas que creaste y podés
   reutilizar. Los nombres de grupos de referencia se filtran con RLS.
4. Marcá la confirmación y pulsá **Confirmar reemplazo en este grupo**.
   Si cambiás el destino, el checkbox vuelve a quedar sin marcar.
5. Piria Halloween tendrá una sola participación activa para esa persona, usando
   el ID conservado de Juana. La participación duplicada queda retirada y marcada
   como reemplazada, visible solo como historial. Juana no cambia.
6. Repetí con Guille y los demás duplicados, eligiendo conscientemente el ID que
   querés conservar en todos los grupos. Para nuevos grupos, usá «Reutilizar un
   invitado que creé» con esos mismos IDs.

Si el destino ya participa activo en Piria Halloween, se conserva esa membresía
sin alterarla ni duplicarla, y se retira únicamente la fila duplicada. Si está
retirado, pendiente o reemplazado, la herramienta no lo reactiva ni lo modifica.

## Qué conserva y qué rechaza

- Solo un administrador activo del grupo puede corregirlo; no funciona archivado.
- Origen: invitado activo de rol miembro, sin cuenta, sin fusión y con procedencia
  de creación. No se modifican personas asociadas a usuarios registrados.
- Destino: otra persona invitada global, sin cuenta ni fusión, creada por el
  administrador que realiza la operación. Si la creó otro administrador, esa
  persona debe efectuar la corrección contando con administración en este grupo.
- Se conserva la identidad global de ambos. No se cambia `merged_into`, `user_id`
  ni el nombre global. No se borra ninguna persona, aunque parezca sin uso.
- La membresía original conserva su fecha de incorporación, queda retirada y
  guarda `replaced_by_person_id`/`replaced_at`. No puede reactivarse por edición.
- Las invitaciones permanecen intactas. El historial original no se reasigna ni
  se reescribe: se añade un evento de corrección con actor, origen y destino.
- No se admiten roles administrativos previos, autoría de grupos/eventos ni
  participación en invitaciones asociadas a esas identidades: no serían simples
  invitados duplicados. En el grupo corregido solo se admiten antecedentes de
  alta/reutilización/cambio de nombre; cambios previos de rol o estado y cadenas
  de reemplazos requieren revisión fuera de esta herramienta.
- No hay botón para deshacer ni sistema general de fusión. Si se elige mal un ID,
  una nueva corrección sobre esa cadena queda bloqueada para revisión manual.

## Barrera previa a datos financieros

La operación falla de forma conservadora si encuentra tablas públicas fuera del
esquema conocido de Fases 2/3, incluso si están vacías o no tienen foreign keys.
También rechaza FKs de tablas adicionales hacia personas, grupos, membresías,
invitaciones o eventos desde otros esquemas.

Así queda bloqueada cuando se incorporen tablas de gastos, pagos u otras fases,
sin intentar adivinar cómo reasignar dinero o datos desconocidos. Una tabla
pública ajena también la bloquea: **no la borres para habilitar la corrección**.
Se requiere revisar ese esquema. La barrera cubre el modelo de Tuki conocido y
sus referencias declaradas; datos externos fuera de ese modelo no se interpretan
automáticamente como movimientos. No se implementó el motor de la Fase 4.

## Transacciones, permisos y pruebas

La RPC usa SECURITY DEFINER con `search_path` vacío, EXECUTE solo para
authenticated y comprobaciones internas de usuario y administrador. No se usa
service_role. Bloquea primero el grupo, luego las dos personas en orden estable
y sus membresías; la corrección y el evento se confirman o revierten juntos.
La FK compuesta asegura que el destino pertenece al mismo grupo y conserva las
referencias históricas. Las demás operaciones del grupo usan el mismo bloqueo.

Las pruebas SQL ejecutan las tres migraciones en PostgreSQL embebido con roles y
RLS reales. Cubren aislamiento entre grupos, conservación del historial y de
invitaciones, destino ya activo, no reactivación de retirados, bloqueo de cuentas,
confirmación, permisos, referencias externas y barrera frente a tablas financieras.
La UI prueba que cambiar de identidad requiere confirmar otra vez.

Se agregó una prueba opcional de reemplazos concurrentes con dos conexiones.
No se ejecuta sin un PostgreSQL local descartable configurado según la guía de
Fase 3; no equivale a una prueba de concurrencia real el motor de una conexión
de PGlite. No se verificó la aplicación remota ni el flujo con tus grupos reales.

## Archivos principales

- Migración `202611020003_replace_duplicate_guest.sql`, sin cambiar las anteriores.
- `features/groups/components/replace-guest-form.tsx` y su integración en detalle.
- Acciones, esquemas, consultas, tipos, errores y etiquetas de eventos de grupos.
- Pruebas SQL, de Server Actions, formulario y escenario opcional de concurrencia.

Ejecutar: `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.

Resultados de esta entrega: lint, typecheck y build correctos; 155 pruebas
aprobadas, incluidas 50 pruebas SQL con las tres migraciones. Siete pruebas
opt-in de concurrencia real quedaron omitidas por falta de servidor local.
El test que inicializa una segunda instancia PostgreSQL en memoria dispone de
20 segundos para evitar un timeout de arranque al correr toda la suite en paralelo.
