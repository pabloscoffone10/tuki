# Bloque 4 — Evidencia operativa, concurrencia y recuperación

Fecha de revisión: 2026-11-03. Este complemento actualiza la evidencia del
[procedimiento del Bloque 1](bloque-1-operaciones.md), que sigue siendo la guía
detallada de respaldo, restauración y conciliación. No se ejecutó SQL remoto,
despliegue, respaldo de datos reales ni restauración. No se leyó `.env.local`.

## PostgreSQL real: estado comprobado

Se revisaron el runner, Compose, bootstrap y las siete suites. `docker`, `psql`,
`postgres` y `pg_ctl` no están en PATH; tampoco se encontró instalación en las
ubicaciones habituales de Program Files consultadas. No se instaló infraestructura.

Comando ejecutado:

```powershell
node scripts/run-concurrency.mjs --check
```

Resultado: código de salida **2**, «Docker Compose no disponible. Pruebas reales
pendientes; no se ejecutó SQL.» No se ejecutaron las carreras y **no están aprobadas**.

| Suite real | Casos pendientes | Variable exclusiva del harness |
| --- | ---: | --- |
| `groups-concurrency.test.ts` | 7 | `TUKI_TEST_DATABASE_URL` |
| `finance-concurrency.test.ts` | 7 | `TUKI_FINANCE_TEST_DATABASE_URL` |
| `smart-bill-concurrency.test.ts` | 4 | `TUKI_SMART_TEST_DATABASE_URL` |
| `payments-concurrency.test.ts` | 5 | `TUKI_PAYMENTS_TEST_DATABASE_URL` |
| `notifications-concurrency.test.ts` | 3 | `TUKI_NOTIFICATIONS_TEST_DATABASE_URL` |
| `admin-payment-concurrency.test.ts` | 3 | `TUKI_ADMIN_PAYMENTS_TEST_DATABASE_URL` |
| `beta-finance-concurrency.test.ts` | 11 | `TUKI_BETA_TEST_DATABASE_URL` |
| **Total** | **40** | No usar credenciales de producción |

La suite beta aplica todas las migraciones presentes. Las suites históricas
conservan sus versiones de referencia. PGlite no reemplaza estas carreras con
conexiones PostgreSQL distintas y bloqueos observables.

### Ejecución reproducible pendiente

El operador debe disponer de Docker Desktop con Compose funcionando y el puerto
local 55439 libre. Desde la carpeta del proyecto:

```powershell
node scripts/run-concurrency.mjs --check
node scripts/run-concurrency.mjs --docker
```

El runner existente usa `docker/compose.concurrency.yml`, PostgreSQL 17,
`127.0.0.1:55439`, almacenamiento temporal y siete bases vacías. Las credenciales
del Compose son públicas y solo de prueba. No usa un volumen persistente ni lee
archivos `.env`. Ejecuta suites en serie y elimina únicamente su proyecto Compose
al finalizar. No apuntar un túnel localhost a una base remota.

Alternativa: instalación PostgreSQL local **nueva y desechable**, con usuario capaz
de crear roles y bases; configurar `TUKI_CONCURRENCY_LOCAL_URL` mediante un gestor
local y ejecutar:

```powershell
node scripts/run-concurrency.mjs --local
```

Debe apuntar a `/postgres` en localhost, sin parámetros URL ni fragmentos. El runner
rechaza bases de ensayo existentes y no las borra; para repetir esa alternativa
se necesita otro cluster vacío. No hay motivo para usar las variables de Supabase.

Guardar como evidencia restringida: fecha, versión de Node/PostgreSQL/Docker,
salida completa sin URLs con credenciales, resultados por suite y conciliación.
Repetir con la versión mayor usada por el proyecto real antes de beta. Las esperas
inducidas por el harness no son un benchmark de carga de producción.

## Auditoría de dependencias

Se ejecutó `npm audit --omit=dev --json` contra el registro público. El primer
intento estuvo bloqueado por la red del sandbox; la repetición de lectura con
acceso de red autorizado terminó con código **0** y **0 avisos conocidos** en
dependencias de producción. Los metadatos indicaron 124 dependencias de producción.
No se ejecutó `audit fix`, instalación, actualización ni cambio de lockfile.

También se ejecutó `npm audit --json`, incluyendo herramientas de desarrollo:
código **1**, **16 entradas moderadas**, **0 altas y 0 críticas**. El aviso raíz
reportado es `minimatch` y su amplificación de globparts
([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)); npm propaga
su impacto por la cadena ESLint/TypeScript-ESLint/`eslint-config-next`. No son 16
fallas financieras independientes ni 16 avisos de producción. Las rutas reportadas
incluyen `node_modules/minimatch` y la copia bajo `@typescript-eslint/typescript-estree`.

La propuesta automática de npm incluye versiones mayores incompatibles e incluso
retrocesos de ESLint/configuración Next. **No aplicar `npm audit fix --force` a
ciegas**. La remediación de tooling requiere revisar una actualización compatible,
reproducir lint/typecheck/tests/build y volver a auditar antes de aceptar el cambio.
Hasta entonces el aviso de desarrollo queda **pendiente**, sin ocultarlo con el
resultado limpio de producción.

Esto es una consulta de avisos publicados al momento de ejecutarla. No demuestra
ausencia de vulnerabilidades desconocidas, seguridad de RLS ni de la configuración
remota. Repetir después de cambios de dependencias y antes del despliegue beta.

## Respaldo y restauración: prueba requerida antes de beta

Supabase diferencia backups de PostgreSQL de los objetos de Storage. El respaldo
de base guarda metadatos de objetos, no sus bytes; incluso restaurar a otro proyecto
requiere tratar Storage aparte. La guía oficial también exige conservar aparte
personalizaciones de `auth`/`storage` e historial de migraciones en un restore lógico.
[Backups](https://supabase.com/docs/guides/platform/backups),
[restauración con CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[descarga de objetos](https://supabase.com/docs/guides/storage/management/download-objects).

El plan real, retención contratada, PITR, región y última copia exitosa de Tuki
**no se consultaron**. Debe registrarlos el propietario en Dashboard; no se infieren
del código ni de la disponibilidad de un botón.

### Política propuesta para una beta pequeña, todavía sin ejecutar

- Responsable nominal y segundo custodio; permisos de mínimo alcance y MFA.
- Copia diaria de base y archivos, más una copia antes de migraciones/cambios de
  configuración. Retención propuesta: 7 diarias y 4 semanales; ajustar según datos,
  costo y obligaciones aplicables. No es la retención contratada de Supabase.
- Almacenamiento cifrado fuera del proyecto principal y fuera del repositorio.
  Claves de cifrado en gestor separado; no junto al backup. Las copias de Auth y
  los manifiestos también son sensibles. Registrar acceso y eliminación autorizada.
- Manifiesto privado: generación, fecha UTC, versión de esquema, conteos, bucket,
  rutas, tamaño y SHA-256 de cada archivo. No publicar nombres ni tickets.
- Alinear DB y Storage durante una ventana de escrituras pausadas; si no es viable,
  documentar la inconsistencia temporal y conciliarla antes de aceptar la copia.
- RPO propuesto de 24 horas para ambos conjuntos. El RTO solo se puede fijar después
  de medir un ensayo completo; no se promete un tiempo de recuperación sin evidencia.

### Ensayo de recuperación aislado

Seguir la guía del Bloque 1 y la documentación oficial para la versión real; no
copiar a ciegas dumps de esquemas gestionados ni reaplicar migraciones sobre tablas
restauradas. Preparar un destino Supabase aislado o un entorno equivalente
autorizado. El Compose de concurrencia no reproduce un proyecto Auth/Storage entero.

1. Verificar hashes, integridad, versión, extensiones y alcance de la generación.
2. Desactivar correo, cron, webhooks y efectos externos del destino antes de importar.
3. Restaurar roles/esquema/datos según el procedimiento oficial, con error fatal
   ante cualquier importación fallida; revisar triggers de Auth y políticas Storage.
4. Restaurar los bytes con las mismas rutas y buckets privados. Comparar el
   manifiesto completo; un `storage.objects` correcto no demuestra que exista el archivo.
5. Ejecutar como propietario el diagnóstico `supabase/audits/financial_reconciliation.sql`
   dentro de una transacción `READ ONLY`. Cualquier fila o error rechaza el ensayo.
6. Probar con cuentas de ensayo el acceso autorizado y denegado, descargas privadas,
   confirmaciones y recuperación de operación. Desactivar integraciones de producción.
7. Registrar tiempos, faltantes, ventana perdida y resultado firmado. Mantener
   producción intacta; un cambio de destino necesita autorización independiente.

La conciliación no comprueba una transferencia bancaria real ni los bytes de
Storage. Se deben validar ambos aspectos por separado. No cambiar saldos a mano,
no borrar asignaciones y no hacer público un bucket para resolver un fallo.

## Matriz operativa previa a beta

| Control | Estado en este trabajo | Evidencia / criterio de aceptación | Riesgo pendiente |
| --- | --- | --- | --- |
| Infraestructura PostgreSQL desechable | Bloqueado por infraestructura | `--check` salida 2 | 40 carreras sin ejecutar |
| Runner aislado | Revisado, ya existente | Solo hosts locales, bases vacías y Compose propio | Falta ejecutar con Docker disponible |
| Auditoría npm de producción | Ejecutada | Salida 0; sin avisos conocidos | No es una certificación de seguridad |
| Auditoría npm completa | Ejecutada, requiere remediación | Salida 1; 16 entradas moderadas de tooling, 0 altas/críticas | Cadena minimatch/ESLint pendiente; no se forzaron cambios |
| Backup PostgreSQL real | Procedimiento preparado | Copia cifrada y generación identificada | No se accedió al proyecto real |
| Backup Storage real | Procedimiento preparado | Manifiesto de bytes, tamaños y hashes | No se descargaron objetos reales |
| Restore aislado | Pendiente | Importación completa y prueba funcional | No se ensayó; RTO desconocido |
| Conciliación después de restore | Herramienta y fixtures existentes | SELECT de propietario sin violaciones | No ejecutada sobre una copia real |
| Separación local/staging/producción | Requisito documentado | Proyectos, secretos y URLs distintos | Configuración remota sin verificar |
| Recuperación tras fallo de red | Protocolo existente | Recuperar mismo ID antes de otro envío | Falta ensayo real con dispositivos y red |

**No declarar lista la beta** hasta ejecutar concurrencia, restauración, privacidad
en el despliegue y escenarios de desconexión/cierre de sesión en dispositivos reales.
