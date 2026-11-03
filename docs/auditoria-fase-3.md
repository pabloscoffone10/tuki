# Auditoría final de seguridad — Fase 3

## Resultado y aplicación

Se corrigió `202611020002_groups_persons.sql` antes de su primera aplicación.
La versión completa actualizada está preparada para pegar en Supabase SQL Editor
después de la migración de perfiles de la Fase 2, ejecutando como propietario
del proyecto (rol postgres). No se ejecutó SQL ni se modificó configuración remota.

Usá el archivo actualizado completo, no la selección anterior del editor. La
migración es de **primera aplicación**, no un parche idempotente: si ya se aplicó
otra versión, no la repitas ni borres tablas para forzarla; se necesita una nueva
migración incremental revisada sobre ese estado.

## 1. Reactivación por invitación: problema corregido

Antes, `ON CONFLICT DO UPDATE` podía pasar una membresía retirada a activa con
cualquier enlace vigente, incluso generado antes del retiro. Eso permitía eludir
la decisión del administrador.

Ahora se bloquea el grupo, luego la invitación y luego la membresía; se consulta
el estado actual. Si es `retired`, devuelve `member_retired` sin modificar rol,
estado, fechas ni consumir el token. **Solo `tuki_set_member`, invocada por un
administrador activo, puede reactivar.** Un miembro pendiente puede aceptar con
su propia identidad de cuenta; una membresía activa nunca se duplica. El reintento
idempotente también comprueba vencimiento y archivo antes de devolver éxito.

## 2. Roles y estados

La validación SQL ya no depende solo de Zod o de un error genérico de constraint.
Rechaza nulos, valores desconocidos y `admin/invited` con `invalid_member_state`.
La tabla exige además coherencia entre `status='retired'` y `retired_at` no nulo.

| Estado de destino | Cuenta | Invitado sin cuenta |
| --- | --- | --- |
| `admin/active` | Administrador activo puede asignarlo | Rechazado |
| `admin/retired` | Permitido; no concede permisos activos | Rechazado |
| `admin/invited` | Rechazado | Rechazado |
| `member/active` | Permitido por administrador | Permitido por administrador |
| `member/retired` | Permitido por administrador; retiro propio sin cambio de rol | Permitido por administrador |
| `member/invited` | Permitido por administrador; sin acceso al grupo | Permitido por administrador; sin acceso |

Un miembro activo común solo puede retirarse él mismo, conservando su rol; no
puede cambiar a otros, promoverse, marcarse pendiente ni reactivarse. Los usuarios
retirados o pendientes no tienen autoridad para modificar el grupo. Una identidad
fusionada no se puede reactivar. Toda transición conserva auditoría antes/después.

## 3. Permisos y esquema interno

Los tests consultan los catálogos de PostgreSQL, no solo el texto del archivo:

- Funciones auditadas SECURITY DEFINER con `search_path` vacío y tablas calificadas.
- Sin EXECUTE concedido a PUBLIC o anon, incluida la función de perfiles de Fase 2.
- EXECUTE de las RPC públicas solamente para authenticated, con verificación de
  cuenta y permisos dentro de las funciones; no se confía en un user_id del cliente.
- Helpers internos de escritura (`lock_admin`, `event`, `profile_person`) sin
  EXECUTE para authenticated. Las funciones de permisos sí lo necesitan para RLS.
- `tuki_private`: USAGE para authenticated, sin CREATE; anon sin USAGE. Se probaron
  intentos reales de ejecutar helpers internos y crear una función: rechazados.
- Tablas sin escritura directa para clientes; hashes de tokens sin SELECT por API.
- Creación y revocación de privilegios dentro de la misma transacción, sin una
  ventana de EXECUTE público entre operaciones.

Las RPC mutadoras públicas son deliberadamente funciones de privilegio elevado
con contratos acotados, sin SQL dinámico y con autorización interna. RLS protege
las lecturas, no reemplaza esos controles internos.

**Comprobación manual en Supabase:** Settings / Data API → Exposed schemas no
debe incluir `tuki_private`. No se lo expone desde esta migración. La lista de
esquemas de PostgREST es configuración externa y no se puede certificar con un
test de PostgreSQL embebido. No lo agregues para intentar solucionar errores RPC:
los endpoints de aplicación están en `public`.

## 4. Privacidad de participantes retirados

La política anterior permitía consultar la ficha global completa de cualquier
participante histórico solo por ser miembro activo del mismo grupo. Se restringió
esa autorización: ahora el participante objetivo también debe estar activo, salvo
que el lector sea administrador activo de ese grupo.

Se mantienen accesos independientes legítimos: la persona consulta su propia
identidad, quien creó un invitado conserva ese contacto, y compartir otro grupo
donde ambos están activos permite ver la identidad por ese otro vínculo. Retirarse
no borra personas ni registros de membresía ni convierte sus IDs en credenciales.
Un usuario retirado pierde acceso a los datos e historial del grupo.

La UI y el cargador toleran `person=null` por RLS, sin errores y sin inferir
«Sin cuenta» cuando simplemente no hay autorización para consultar esa ficha.
Los eventos mantienen datos de rol/estado; las relaciones de nombres también
respetan la política de `persons`.

## 5. Último administrador

Se conserva el bloqueo de la fila del grupo antes de decidir permisos o contar
administradores. No se puede retirar, demover o marcar pendiente al último
administrador activo. Otro administrador con cuenta debe permanecer activo.
Las cuatro transiciones válidas que quitarían al último administrador se probaron
por separado; `admin/invited` se rechaza directamente como combinación inválida.

El invariante se garantiza para los flujos/RPC soportados, no frente a SQL manual
de un propietario que omita esos flujos. No existe borrado de cuentas en Tuki:
antes de borrar usuarios manualmente en Auth debe transferirse la administración.
La conservación de identidad al eliminar una cuenta no representa una nueva cuenta
con capacidad de administrar automáticamente sus grupos.

## 6. Concurrencia

Se revisó el orden de bloqueos consistente: grupo → invitación → membresía cuando
corresponde. Los permisos, estados y vencimiento se verifican después de esperar
los bloqueos. Se eliminó la actualización ciega de membresías por conflicto.
Índices únicos impiden duplicar personas de cuenta, membresías y hashes de tokens.

Se prepararon seis escenarios con dos conexiones PostgreSQL en
`tests/groups-concurrency.test.ts`: último administrador, token único, archivo,
retiro, revocación y pérdida de privilegios concurrentes. El runner exige una base
local nueva `tuki_phase3_test` y rechaza conexiones remotas. **No se ejecutaron**
porque no hay un servidor PostgreSQL local configurado. No se presenta la
serialización de PGlite como prueba de bloqueos entre conexiones independientes.

## 7. Compatibilidad con perfiles

La migración mantiene `public.profiles` y el trigger de Auth de la Fase 2. Agrega
su propio trigger después del INSERT del perfil, sin sustituir la función anterior
ni modificar sus políticas. El backfill y `tuki_ensure_person` usan la restricción
única de user_id; no vinculan personas a partir del nombre ni de metadatos enviados
por el usuario.

Se agregó una comprobación previa: antes de crear objetos exige `profiles` con
RLS, columnas UUID/texto esperadas y el trigger de creación de perfiles habilitado.
Un proyecto sin esa base falla explícitamente y la transacción no deja objetos
parciales. Los tests aplican ambas migraciones y prueban el alta Auth → profiles →
persons, incluyendo metadatos que intentan indicar otra persona o rol: se ignoran.

## Pruebas y límites

Se ejecutan `lint`, `typecheck`, Vitest y build. Las pruebas SQL corren sobre
PostgreSQL embebido con roles y políticas reales, junto a pruebas de UI para
identidades ocultas. El esquema Auth de pruebas es un fixture mínimo: no se
certifica la configuración remota, JWT del servicio, caché PostgREST ni una
migración aplicada en Supabase con otra definición de perfiles.

Resultado final:

| Verificación | Resultado |
| --- | --- |
| Lint | Correcto |
| Typecheck | Correcto |
| Vitest | 143 aprobadas; 6 omitidas de concurrencia entre conexiones |
| Integración SQL PostgreSQL embebido | 40 aprobadas, con ambas migraciones |
| Build de producción | Correcto |

Las pruebas opt-in de concurrencia se omiten explícitamente, no se cuentan como
aprobadas. El SQL está preparado para una primera aplicación en SQL Editor con
la base de Fase 2 y la exposición de esquemas indicadas; no implica certificar un
entorno remoto que no fue inspeccionado ni bloqueos que no se ejecutaron allí.

Fuentes: [privilegios de PostgreSQL](https://www.postgresql.org/docs/current/ddl-priv.html),
[seguridad de funciones](https://www.postgresql.org/docs/17/sql-createfunction.html),
[RLS en Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
