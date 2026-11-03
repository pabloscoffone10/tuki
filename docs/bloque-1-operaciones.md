# Bloque 1: pruebas reales, permisos y recuperación operativa

Fecha de preparación: 2026-11-03. No se ejecutó SQL remoto, no se leyó `.env.local`,
no se hizo un respaldo real, no se restauró producción y no se llamó a OpenAI.
Esta guía distingue procedimientos preparados de operaciones efectivamente verificadas.

## Estado verificable

- Docker Compose, `psql` y `pg_ctl` no están disponibles en PATH ni se encontró una
  instalación en las ubicaciones habituales de Program Files de este entorno.
- `node scripts/run-concurrency.mjs --check` confirmó Docker ausente. Las carreras
  PostgreSQL reales están **pendientes**, no aprobadas por PGlite.
- La base y los buckets reales, el plan contratado, la versión PostgreSQL remota,
  la configuración de backups/PITR y las políticas desplegadas **no fueron consultados**.
  No hay aquí credenciales ni conector autorizado para verificar el Dashboard.
- PGlite prueba funciones/políticas sobre fixtures locales. No simula el servicio
  Storage, OAuth, SMTP, red, la restauración de Auth o el aislamiento entre conexiones.

## PostgreSQL real reproducible

Archivos: `docker/compose.concurrency.yml`, `docker/init-concurrency.sql`,
`scripts/run-concurrency.mjs` y `tests/beta-finance-concurrency.test.ts`.

Con Docker Desktop y Compose instalados por el operador:

```powershell
node scripts/run-concurrency.mjs --check
node scripts/run-concurrency.mjs --docker
```

El runner levanta PostgreSQL 17 sobre `127.0.0.1:55439`, con credenciales públicas
**exclusivamente de prueba**, almacenamiento efímero y siete bases vacías. Ejecuta
las seis suites históricas y la nueva suite beta en serie, para evitar carreras
al crear roles compartidos del cluster. Al finalizar elimina exclusivamente su
proyecto Compose, nunca otros contenedores ni una base externa. No utiliza `.env`.
El puerto debe estar libre; un conflicto aborta el arranque.

Alternativa local: usar una instalación aislada y vacía cuyo usuario pueda crear
roles y bases. Definir `TUKI_CONCURRENCY_LOCAL_URL` con una URL localhost hacia la
base administrativa `/postgres`, y ejecutar `node scripts/run-concurrency.mjs --local`.
El runner rechaza hosts remotos, parámetros URL y bases de pruebas existentes.
No borra ni reinicializa bases locales; para repetir, preparar otra instalación
descartable. No usar túneles hacia Supabase aunque el host aparente sea localhost.

La nueva suite aplica el esquema actual y cubre: dos pagos completos; dos
confirmaciones; confirmar frente a anular; parciales que exceden juntos el saldo;
reintento con misma clave; edición durante liquidación; pérdida de rol; retiro de
miembro durante pago; distintos orígenes con identidades compartidas; reversión y
nuevo pago; y consulta de recuperación mientras se confirma la transacción. Usa dos sesiones autenticadas y otra observadora, espera un bloqueo
real en `pg_stat_activity`, y concilia después de cada caso. En la suite beta ambas transacciones se confirman cuando son válidas; los errores
se revierten. Las suites históricas conservan su aislamiento original.

Se informa el tiempo observado de espera + operación en cada carrera. Es una
espera provocada por el harness, **no un benchmark de producción**. Antes de beta,
registrar hardware, versión, p50/p95/p99 con carga representativa, esperas del
`finance_gate` y timeouts. Objetivo inicial propuesto: ninguna espera sin límite;
el umbral de servicio debe acordarse y medirse. No se cambió el bloqueo global.
Repetir además con la misma versión PostgreSQL que figure en el proyecto real.

## Auditoría de seguridad y matriz de permisos

Se revisaron migraciones 001–009, clientes SSR/PKCE, Server Actions, descargas,
notificaciones y cron. No se modificaron migraciones históricas. Las comprobaciones
de catálogo y casos negativos están en `tests/security-audit-sql.test.ts`.

| Operación | Autoridad requerida | Frontera que decide |
| --- | --- | --- |
| Perfil | Su propia cuenta; solo nombre actualizable | RLS de `profiles` |
| Crear grupo | Cuenta autenticada y correo confirmado | `tuki_ensure_person` / RPC |
| Administrar grupo, invitados y roles | Administrador activo del origen | `lock_admin`, bloqueo de grupo y chequeo posterior |
| Retirarse | Miembro activo; nunca dejar último admin activo | `tuki_set_member` |
| Leer gastos/revisiones/comprobantes | Miembro activo del origen | RLS + descarga con `getUser` |
| Ver deuda proyectada | Ambas identidades activas en el grupo consultado; proyección mínima | RPC autorizada; no acceso a tablas de origen |
| Registrar pago personal | Una de las partes; deuda y alcance válidos | RPC y plan SQL |
| Registrar pago de terceros | Administrador activo del origen | RPC, membresías y asignación restringida |
| Confirmar dos cuentas | Receptor autenticado | `tuki_transition_payment` |
| Confirmar con invitados | Administrador activo del origen, con motivo; o recepción personal autorizada | Política 009 y motor financiero |
| Revertir pago | Receptor confirmante o admin de origen según modo registrado | RPC versionada, reversión auditada |
| Preparar/consultar/reconocer intento | Creador autenticado de ese intento | RPC de 010; payload privado en servidor |
| Leer/marcar notificaciones | Cuenta destinataria | RLS y RPC con `auth.uid()` |
| Reservar/ver ticket | Miembro del origen; escritura reservada al creador y solo sin referencia histórica | `ticket_access` + RLS de Storage |
| Ejecutar recordatorio automático | Rol de servidor, flag explícito y secreto cron independiente | Endpoint + EXECUTE solo `service_role` |

Las tablas públicas de dominio usan RLS y revocan escrituras directas. Los helpers
`SECURITY DEFINER` fijan `search_path=''`. `authenticated` tiene USAGE en
`tuki_private` para predicados RLS, **no acceso a sus tablas ni a sus motores de
mutación internos**. Los helpers ejecutables por clientes quedan limitados a los
predicados de lectura autorizados. `anon` no puede ejecutar las RPC de dominio.
La clave service-role nunca debe enviarse al navegador.

No se confirmó una explotación de RLS en los fixtures revisados. Esta conclusión
no certifica los grants del proyecto desplegado. Antes de beta, comprobar en el
Dashboard que `tuki_private` no esté expuesto mediante Data API, RLS y Storage
coincidan con las migraciones, que el bucket siga privado y que cron esté desactivado
si no se configuró. Las políticas de otras aplicaciones deben auditarse por separado.

## Respaldo: qué está cubierto y qué falta comprobar

La documentación oficial indica backups diarios para planes Pro, Team y Enterprise
y recomienda exportación externa para Free; la retención y PITR dependen del plan.
**No se verificó cuál posee Tuki.** Registrar plan, última copia verificable,
retención, PITR habilitado, región, versión y permisos del responsable antes de
aceptar usuarios. [Backups oficiales](https://supabase.com/docs/guides/platform/backups).

Los backups de PostgreSQL **no contienen los bytes de Storage**. Los comprobantes
pequeños embebidos en `expense_revisions` / `payments` sí están en la base; los
tickets de `tuki-tickets` requieren otra copia. [Descarga y metadatos](https://supabase.com/docs/guides/storage/management/download-objects).

Procedimiento propuesto, a ejecutar por el propietario después de autorizar el acceso:

1. Abrir una ventana de mantenimiento autorizada y detener escrituras financieras,
   cargas de archivos y trabajos externos para alinear la copia DB y objetos.
2. Capturar roles, esquema y datos, incluyendo `public`, `tuki_private`, identidades
   Auth, historial de migraciones y metadatos Storage. Usar CLI oficial actual,
   Docker y una conexión directa o session pooler; no transaction pooler.
3. En un directorio privado fuera del repositorio, ejecutar los comandos de
   [backup/restore oficial](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore):

   ```powershell
   supabase db dump --remote="$TUKI_BACKUP_SOURCE_URL" -f roles.sql --role-only
   supabase db dump --remote="$TUKI_BACKUP_SOURCE_URL" -f schema.sql
   supabase db dump --remote="$TUKI_BACKUP_SOURCE_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
   ```

   La variable se obtiene del gestor privado de credenciales, nunca de un valor
   pegado al historial o al informe. No se ejecutaron estos comandos aquí. Revisar
   salida y alcance del dump; los componentes gestionados por Supabase requieren
   seguir la guía para la versión real, no un restore genérico sobre una plataforma vacía.
   Conservar aparte las personalizaciones de esquemas gestionados: el trigger
   `tuki_auth_user_created` sobre `auth.users` y las tres políticas `tuki_ticket_*`
   sobre `storage.objects`. Seguir la sección de personalizaciones de la guía
   oficial y comparar sus definiciones con 001/006. No asumir que el dump de
   esquema genérico las incluye ni volver a ejecutar migraciones completas
   sobre tablas ya restauradas. Guardar también el historial de migraciones
   siguiendo los dos dumps específicos de `supabase_migrations` de esa guía.
4. Copiar **todos** los objetos del bucket privado mediante el flujo oficial de
   migración de Storage o un cliente S3 configurado explícitamente para el origen.
   Para una beta pequeña puede usarse descarga individual desde Dashboard; para
   volumen, la guía enlaza scripts y herramientas compatibles. No ejecutar `sync --delete`.
5. Crear un manifiesto privado por ruta con tamaño y SHA-256 de los bytes descargados,
   además de fecha UTC, bucket, versión de esquema, conteos de tablas e informe de
   conciliación. Comparar cada ticket referenciado con un archivo del manifiesto.
6. Cifrar copias y manifiestos; guardar fuera de la cuenta/proyecto principal y
   restringir acceso. Dumps de Auth contienen información sensible. Conservar
   generaciones inmutables; nunca sobrescribir la única copia válida.
7. Reanudar escrituras solo tras verificar la copia. Si no puede detenerse la
   escritura, documentar la ventana de inconsistencia entre DB y objetos y reconciliarla.

RPO inicial **propuesto**: hasta 24 horas con copia diaria verificada; archivos y
DB deben cumplir ambos ese límite. PITR podría reducir el RPO de DB, no reconstruye
archivos borrados. RTO de planificación **propuesto**: reservar 2–4 horas para el
primer ensayo de beta pequeña; no es una medición ni garantía. RPO/RTO reales
siguen pendientes hasta restaurar el volumen real y medir descarga, importación,
objetos, pruebas y DNS/configuración.

## Restauración aislada

1. Declarar incidente y preservar evidencia sin claves, tokens, tickets o notas en
   logs públicos. No corregir saldos a mano ni ejecutar un restore sobre producción.
2. Elegir copia consistente y verificar sus hashes. Crear un proyecto Supabase de
   ensayo expresamente autorizado o una instalación local equivalente. Un Postgres
   simple no reproduce Auth/Storage: el Compose de concurrencia **no** es un destino
   completo para restaurar un proyecto Supabase real.
3. Desactivar cron/webhooks/correos y cualquier integración que pueda ejecutar
   efectos externos en el destino. Establecer extensiones y versiones compatibles.
4. Revisar roles y esquema antes de importar. Restaurar roles, esquema y datos en
   orden, con `ON_ERROR_STOP`, siguiendo las excepciones de esquemas gestionados,
   claves de cifrado y contraseñas de roles de la guía oficial. No ignorar errores
   de importación masivamente. Un fallo deja el ensayo rechazado.
5. Restaurar objetos con las mismas rutas, MIME y buckets privados; comparar SHA-256
   con el manifiesto. Restaurar solo metadatos puede dejar enlaces a archivos inexistentes.
6. Verificar conteos, restricciones y migraciones; ejecutar conciliación de solo
   lectura; probar usuarios distintos, permisos negativos, PKCE y descargas del
   destino sin reutilizar URLs de producción. Reconfigurar OAuth/SMTP solo con aprobación.
7. Documentar tiempos, datos recuperados, faltantes y ventana perdida. Aprobar o
   rechazar el ensayo. El cambio de producción requiere aprobación independiente.

Supabase ofrece restauración a otro proyecto según sus condiciones; no se habilitó
ni contrató aquí. [Restauración a otro proyecto](https://supabase.com/docs/guides/platform/clone-project).

## Conciliación financiera y alerta

`supabase/audits/financial_reconciliation.sql` es un SELECT, no una migración ni
RPC pública. Ejecutarlo como propietario únicamente dentro de una transacción
`READ ONLY`, para no generar un falso informe por RLS parcial. En SQL Editor:

```sql
begin transaction read only;
-- Pegar aquí financial_reconciliation.sql completo.
commit;
```

Reporta IDs técnicos y códigos, no nombres, notas, recibos ni credenciales. Comprueba
sumas de asignaciones por pago y obligación, estados pendientes/rechazados/void,
reversiones, partes y origen, obligaciones activas y versión actual, conservación
de shares, referencias, eventos duplicados/faltantes y metadatos de tickets.
No considera duplicado a dos pagos distintos con igual importe/fecha/nombre.
No interpreta deudas inversas legítimas como sobrepago ni crea triangulaciones.

Cero filas significa que **esas invariantes** no tienen violaciones en ese snapshot;
no demuestra que un pago declarado ocurrió en un banco, que no existe una operación
humana duplicada con otro ID o que los bytes Storage están accesibles. Contrastar
estos últimos con manifiesto y descargas autenticadas. Los fixtures de corrupción
en `tests/financial-reconciliation.test.ts` validan detecciones; no son datos reales.

Antes de beta: ejecutar manualmente después de cada migración, restore e incidente.
Durante beta: responsable diario y reporte fechado restringido; cualquier fila o
error de consulta es una alerta a investigar. No se instaló un servicio pago ni
un programador que acceda remotamente. Automatizar reportes más adelante requiere
credencial de mínimo privilegio, canal privado y aprobación del operador.

## Respuesta a incidentes

| Incidente | Procedimiento seguro |
| --- | --- |
| Migración falla | Conservar error e ID/versiones, comprobar rollback y catálogo; no pegar fragmentos ni rerun a ciegas. Ensayar la corrección en copia aislada. |
| Supabase no responde | Suspender reenvíos financieros nuevos, mantener ID original y marcar resultado desconocido; consultar al recuperar conexión. No asumir rechazo. |
| Respuesta perdida | Recuperar la operación autenticada por ID/current; reconocer resultado antes de crear un segundo pago legítimo. |
| Pago humano duplicado | Identificar ambos IDs con las partes; usar anulación autorizada con motivo, nunca borrar pagos/asignaciones. |
| Saldo incorrecto | Conciliar origen, revisiones, pagos y reversiones; preservar reporte. No editar cantidades directamente. |
| Comprobante faltante | Comparar metadatos/manifiesto y restaurar bytes de la generación correcta; no inventar otro recibo ni hacer público el bucket. |

Las restauraciones reales, el plan de backups y las pruebas reales de concurrencia
siguen siendo condiciones operativas pendientes para declarar lista la beta.
