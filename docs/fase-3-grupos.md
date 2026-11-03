# Tuki — Fase 3: grupos, participantes e identidad global

## Entrega y compatibilidad

Se conserva Next.js 16, la autenticación SSR/PKCE, los callbacks corregidos, el
layout, los temas y la paleta de Tuki. No se recreó el proyecto. No se leyó ni
modificó `.env.local` ni se ejecutaron migraciones o cambios en Supabase remoto.

La tabla real de la Fase 2 es **`public.profiles`**, no `account_profiles`. Se
reutiliza con su trigger y sus políticas existentes. No se renombra ni duplica.
La nueva migración agrega un trigger después de insertar un perfil y completa
una identidad para las cuentas existentes. Las nuevas cuentas siguen el alta
de Auth → profiles → persons dentro de la misma transacción.

Implementado:

- Crear/listar/ver/editar grupos permanentes o temporales; fechas, tarjetas y estados vacíos.
- Archivar y desarchivar sin borrar integrantes ni historial.
- Identidad global única para cada cuenta; invitados globales sin cuenta.
- Crear invitados o reutilizar por ID los invitados creados por el administrador actual.
- Roles de administrador/miembro, estados activo/retirado/invitado pendiente,
  reactivación y retiro propio de miembros. Debe quedar un administrador activo.
- Editar el nombre global de un invitado solo si quien lo creó administra el grupo.
- Enlaces de una incorporación, con vencimiento, revocación y confirmación explícita.
- Historial de cambios del grupo y vista de grupos reales en el resumen.
- Lecturas con RLS; escrituras por RPC transaccionales y Server Actions verificadas.

No hay gastos, cálculos de balances, deudas, pagos ni motor financiero. No se
implementó la Fase 4. Los importes futuros seguirán siendo UYU.

La corrección acotada de duplicados previa a gastos está documentada en
[corregir invitados duplicados](corregir-invitados-duplicados.md). Se habilita
con la migración incremental `202611020003_replace_duplicate_guest.sql`,
sin repetir ni modificar las migraciones base ya aplicadas.

## Aplicar la migración en Supabase

1. Confirmá el proyecto correcto y que ya aplicaste
   `202611020001_account_profiles.sql`. **No lo ejecutes de nuevo** si la Fase 2 funciona.
2. Revisá `supabase/migrations/202611020002_groups_persons.sql` completo.
3. En Supabase → SQL Editor → nueva consulta, pegá y ejecutá **solo esa nueva
   migración**, una vez. Su `begin`/`commit` hace el cambio atómico.
4. Crea `persons`, `groups`, `group_members`, `group_invitations`, `group_events`
   y el esquema interno `tuki_private`, junto con políticas, funciones y permisos.
5. Si existe alguno de esos objetos, se detiene en lugar de sobrescribirlo. No
   uses DROP ni un reset para forzarlo: revisá primero el esquema existente.
6. No agregues `tuki_private` a los esquemas expuestos en la API de Supabase.
7. Si PostgREST tarda en reconocer las funciones nuevas, podés ejecutar:

```sql
notify pgrst, 'reload schema';
```

Comprobación de solo lectura:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
and tablename in ('persons','groups','group_members','group_invitations','group_events');

select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public'
and tablename in ('persons','groups','group_members','group_invitations','group_events');

select n.nspname, p.proname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='tuki_private' or (n.nspname='public' and p.proname like 'tuki_%');
```

Las cinco tablas deben tener RLS activa. No cambies Confirm email ni las
políticas de `profiles`. Si luego usás Supabase CLI, registrá la aplicación
manual en su historial antes de un futuro `db push`, para no repetirla.

No hace falta ninguna variable nueva para la app. `TUKI_SITE_URL` debe coincidir
con su origen para que los enlaces compartidos apunten a la instalación correcta.
No hay claves administrativas en el cliente ni un backend con service_role.

## Modelo y reglas de seguridad

`persons.id` identifica a la persona, mientras `group_members(group_id,person_id)`
identifica su pertenencia. `user_id` es opcional y único; `merged_into` queda
reservado y sin operaciones de modificación disponibles a clientes. No hay
fusiones automáticas por nombre ni por email. Los nombres iguales no prueban
identidad. Los perfiles se copian como nombre inicial; no existe todavía una UI
para editar el nombre de cuenta/persona autenticada.

El usuario ve su identidad, identidades que creó o identidades de participantes
**activos** de grupos donde él está **activo**. Los administradores activos
también pueden consultar identidades retiradas o pendientes de sus grupos.
Compartir solo una participación histórica no abre la ficha global: para un
miembro normal la relación `person` puede ser nula y la UI la presenta como
«Identidad restringida». Se conservan el ID de membresía, estado y fechas para
el historial. No hay directorio global.
Un miembro retirado pierde el acceso al grupo; su fila y persona permanecen.
La reutilización de invitados se limita además a `created_by = auth.uid()`,
sin cuenta y sin fusión. Ver a un invitado en otro grupo no da derecho a copiarlo
o reclamarlo. Cambiar el nombre de un invitado cambia esa identidad en todos
sus grupos; la interfaz avisa ese alcance.

Los invitados agregados por nombre quedan activos como participantes sin cuenta.
El estado `invited` representa una participación pendiente y no concede acceso.
Los enlaces sin destinatario no crean una membresía anticipada: la crean al
aceptarse. Solo personas con cuenta pueden ser administradoras.

Todas las tablas niegan INSERT/UPDATE/DELETE a `authenticated` y `anon`. Las RPC
expuestas solo conceden EXECUTE a `authenticated`, verifican `auth.uid()` y email
confirmado, y no reciben un usuario o administrador decidido por el navegador.
Las funciones SECURITY DEFINER tienen `search_path` vacío y referencias
calificadas. Los helpers internos de escritura no conceden EXECUTE a clientes.
Los helpers de RLS solo devuelven la identidad propia o permisos de lectura.

Las mutaciones toman primero un bloqueo de fila del grupo, después verifican
permisos y bloquean invitación/membresía si corresponde. Ese orden evita que dos
administradores se demuevan simultáneamente dejando cero activos, o que un token
se consuma dos veces. El historial es de solo lectura y se inserta en la misma
transacción que la operación. No hay eliminación de grupos en la UI ni en RPCs.
Los cambios de rol/estado guardan sus valores anteriores y nuevos, actor, persona
afectada y fecha, sin perder ese historial al reactivar una participación.

Los grupos archivados siguen visibles a sus miembros activos. Conservan estados
y fechas; se bloquean cambios de integrantes, edición y aceptación de enlaces.
Se permite desarchivar y revocar enlaces. Archivar no libera ni cancela ninguna
futura obligación financiera.

## Invitaciones y reclamación de invitados

Los enlaces contienen 32 bytes aleatorios codificados en hexadecimal. En la base
solo se persiste SHA-256 del token. La función de aceptación recibe el original,
calcula su hash en PostgreSQL, verifica vencimiento/revocación/consumo y usa la
persona de la cuenta autenticada. Incluso los administradores no pueden leer la
columna `token_hash` por API. No se loguean tokens desde las acciones.

El enlace se muestra al generarlo, en la respuesta de esa operación. Después de
recargar no se puede reconstruir: hay que generar otro o revocar el anterior.
No se guarda en localStorage. Es un secreto compartible: enviarlo solo a su
destinatario. Los registros HTTP del hosting podrían incluir rutas de invitación;
configurá su retención/redacción antes de producción. Las páginas usan
`Referrer-Policy: no-referrer` y no incluyen recursos de terceros.

Un enlace concede una incorporación, no una identidad invitada concreta. Si el
receptor ya está activo, no se duplica su membresía ni consume el enlace. Si ya
lo consumió él mismo y sigue activo, reintentar es idempotente mientras el enlace
siga vigente, no esté revocado y el grupo no esté archivado. Otra persona no
puede reutilizarlo. Un retirado requiere **reactivación explícita por un
administrador**: ningún enlace genérico, viejo ni nuevo, revierte su retiro.

**Reclamar invitados está bloqueado.** No hay RPC ni botón que cambie `user_id`
de un invitado. Una futura vinculación requerirá un canal independiente confiable
que pruebe control de esa identidad, un token separado de un solo uso, auditoría
y resolución de la persona de cuenta ya existente. El token de grupo, el nombre,
el ID visible o la coincidencia de emails no cumplen esa verificación.

## Cómo probar desde el navegador

1. Aplicá la migración y ejecutá `npm run dev`; iniciá sesión con una cuenta propia.
2. Abrí **Mis grupos → Crear grupo**. Creá uno permanente y otro temporal.
   Verificá nombre, descripción, fecha, administrador inicial y persistencia al recargar.
3. En el primero, **Agregar participante → Crear invitado**. En el segundo elegí
   **Reutilizar un invitado que creé** y seleccioná el mismo ID (se muestra un sufijo).
   Verificá que el nombre global sea el mismo. Intentá agregar ese ID otra vez:
   debe rechazar duplicados, incluso si está retirado.
4. Editá el nombre del invitado desde el grupo donde sos administrador. El nombre
   debe actualizarse al visitar el otro grupo. No se fusionan homónimos.
5. Generá un enlace y abrilo con otra cuenta propia en un navegador separado.
   Si no está autenticada, pasa por login y vuelve al enlace. Al crear una cuenta
   nueva con confirmación por correo, completá el registro y **volvé a abrir el
   enlace original**; la plantilla SSR de email puede retornar al resumen.
6. Aceptá con confirmación explícita. Debe aparecer la identidad de esa cuenta,
   sin reemplazar a un invitado del mismo nombre. Probá el enlace con otra tercera
   cuenta: ya no puede incorporarse. Si no llegó a usarse, revocalo y comprobá rechazo.
7. Como miembro, comprobá que no aparecen las herramientas de administración.
   Una URL directa de otro grupo debe mostrar 404, sin su nombre ni participantes.
8. Como administrador, promovelo a administrador y cambiá roles. Intentá retirar
   al último administrador: debe impedirlo. Los invitados sin cuenta no pueden
   tener ese rol. Retirá/reactivá participantes y verificá historial conservado.
9. Archivá con el checkbox de confirmación. Comprobá que aún se ve el grupo y sus
   miembros, pero no permite nuevas incorporaciones. Desarchivalo para continuar.
10. Revisá modo claro/oscuro y anchos de celular/escritorio. No hay datos ficticios.

## Pruebas y límites de verificación

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:groups:sql
```

`groups-sql.test.ts` ejecuta ambas migraciones sobre PostgreSQL embebido (PGlite)
en memoria. Crea roles reales `authenticated`/`anon` y un esquema Auth mínimo de
fixtures para `auth.uid()`. Verifica RLS con SELECT ejecutado como esos roles,
permisos de tablas/funciones, triggers, unicidad de identidad/membresía, invitados,
aislamiento, promoción/retiro, archivo, vencimiento, revocación y token de un uso.
Esto **no son funciones simuladas**, pero tampoco comprueba tu proyecto Supabase
remoto, su JWT real, PostgREST ni las migraciones que hayas aplicado allí.

PGlite tiene una sola conexión y serializa llamadas. El test con solicitudes
paralelas comprueba unicidad e idempotencia en ese modelo, no bloqueos entre dos
sesiones PostgreSQL independientes. Por eso hay seis pruebas adicionales opt-in
en `groups-concurrency.test.ts` para PostgreSQL local real: democión simultánea,
consumo simultáneo de token, archivo/retiro/revocación concurrentes con aceptación
y pérdida de autoridad de un administrador concurrente con una escritura.

Para ejecutarlas, creá vos una base **local nueva y descartable** llamada
`tuki_phase3_test` en un servidor PostgreSQL de pruebas. El usuario debe poder
crear roles/esquemas. En una terminal de pruebas, definí `TUKI_TEST_DATABASE_URL`
con su conexión local (no en `.env.local`) y ejecutá:

```powershell
npm run test:groups:concurrency
```

El runner rechaza hosts remotos, otro nombre de base y parámetros de URL. Exige
una base nueva, no borra ni resetea tablas existentes. Inicializa los fixtures y
las migraciones; los deja en esa base de pruebas. Para repetirlo usá nuevamente
una base descartable nueva preparada por vos. **Nunca uses la conexión de
Supabase ni una base con datos reales.** Sin esa variable las seis pruebas se
omiten de forma explícita. No se instaló ni ejecutó un servidor PostgreSQL local.

Las demás pruebas cubren validación de formularios, confirmación de archivo,
acciones autenticadas, hashing de tokens, destinos seguros y permisos de UI.
La aceptación de invitaciones y la administración desde navegador contra tu
Supabase quedan pendientes de aplicar la migración y probar con cuentas reales.
No se contó con una herramienta de navegador visual automática.

Resultado final de esta entrega:

La auditoría posterior y los resultados actualizados están en
[auditoría de seguridad de la Fase 3](auditoria-fase-3.md).

| Comando | Resultado |
| --- | --- |
| `npm run lint` | Correcto |
| `npm run typecheck` | Correcto |
| `npm test` | 143 aprobadas; 6 de concurrencia real omitidas explícitamente |
| Pruebas SQL en PGlite | 40 aprobadas con ambas migraciones y roles reales |
| `npm run build` | Correcto, incluidas las nuevas rutas dinámicas |
| `npm ls --depth=0` | Dependencias instaladas sin conflictos |

No se verificó RLS en Supabase remoto ni se ejecutaron las pruebas de dos
conexiones. La instalación conserva los 16 avisos moderados de desarrollo de
la cadena ESLint ya documentados en la Fase 1; no se aplicaron correcciones forzadas.

## Archivos

- Migración: `supabase/migrations/202611020002_groups_persons.sql`.
- Dominio/interfaz: `features/groups/{types,schemas,permissions,errors,format,data,actions}.ts`
  y `components/{action-form,fields,group-form,groups-list,groups-preview,group-detail}.tsx`.
- Rutas: `app/(private)/grupos/page.tsx`, `grupos/nuevo/page.tsx`,
  `grupos/[groupId]/page.tsx`, `invitaciones/[token]/page.tsx`.
- Integración: resumen, aviso de próximos pasos, ayuda, links entre login/registro
  y retorno seguro de invitaciones, README y documentación modular.
- Pruebas: `groups-sql`, `groups-concurrency`, `groups-actions`, `groups-validation`,
  `groups-form`; actualización del test del aviso de próximos pasos.
- Dependencias de desarrollo: PGlite y cliente `pg` con tipos, fijados en lockfile.
  No se cambiaron versiones de Next.js, React ni de las dependencias de Auth.

Archivos existentes modificados: `app/(private)/grupos/page.tsx`,
`app/(private)/ayuda/page.tsx`, `features/overview/components/overview.tsx`,
`components/shared/phase-notice.tsx`, `features/auth/redirects.ts`,
`features/auth/components/auth-form.tsx`, `tests/phase-notice.test.tsx`,
`package.json`, `package-lock.json`, `README.md` y `features/README.md`.

Referencias de seguridad: [funciones PostgreSQL en Supabase](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[bloqueos de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).
