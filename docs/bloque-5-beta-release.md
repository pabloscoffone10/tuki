# Bloque 5 — Validación final y decisión de lanzamiento

Fecha: 2026-11-03. **Decisión: NO-GO para abrir la beta.** Hay correcciones y
pruebas locales verificadas; continúan sin verificar controles críticos en
PostgreSQL real, restauración aislada, infraestructura y dispositivos. Este informe
no autoriza ni representa un despliegue.

## Resumen ejecutivo y alcance

Se implementó la única adaptación funcional pedida: **nuevas operaciones UYU**,
conservando el motor y el historial multimoneda. Se preparó la migración 014, sin
editar 001–013 ni ejecutar SQL remoto. No se crearon cuentas/proyectos externos,
no se desplegó, no se modificaron DNS/secretos ni se copiaron datos personales.

Se corrigieron validaciones de claves públicas y separación Preview/Production,
se retiró limpieza especulativa de comprobantes y se amplió la conciliación de
solo lectura. Las dependencias siguen con 0 avisos de producción y 16 entradas
moderadas de tooling: no hay una actualización publicada compatible que elimine
todo el árbol afectado sin forzar cambios de API.

## Auditoría y hallazgos

Se revisaron rutas y guard privado, sesiones/callbacks, formularios simples y de
productos, acciones de pago, recuperación idempotente, RLS/RPC, migraciones,
descargas/Storage, reportes, worker, configuración de entorno y harness local.
Las guías anteriores siguen siendo antecedentes; los estados de esta entrega
requieren su propia evidencia.

| Hallazgo | Prioridad | Causa y corrección mínima | Evidencia / límite |
| --- | --- | --- | --- |
| Clave legacy privilegiada aceptada en variable pública | P0 condicional de configuración | Se rechazaba `sb_secret_`, pero no se clasificaba el rol de JWT heredados. Se rechazan roles distintos de `anon` y JWT malformados, en lectura de configuración y antes de generar bundles | Tests sintéticos de configuración/build guard; no se observó ni se afirma una filtración de una clave real |
| Preview podía recibir URL de producción por error | P1 | Allowlist obligatoria de orígenes aprobados en Vercel; Preview debe coincidir con staging y diferir de producción | `tests/deployment.test.ts`; cuentas reales todavía no revisadas |
| Altas multimoneda seguían disponibles | P1 / requisito de beta | Interfaz sin selectores, validación en servidor y wrappers SQL 014 para UYU/tasa 1 | Tests UI/acciones/SQL en PGlite; aplicación remota de 014 pendiente |
| Limpieza de ticket tras rechazo o respuesta perdida | P1 de recuperación | Un upload determinista puede reutilizar el archivo de un intento previo. Se elimina el intento automático de borrarlo desde el catch/error del guardado | Dos regresiones reproducen rechazo y transporte incierto. RLS/FK ya protegen referencias; no se afirma que se haya perdido un archivo productivo |
| Diagnóstico omitía algunas corrupciones de una restauración sin constraints | P2 | Nuevos checks SELECT para obligación activa, centésimos/no finitos, referencias y eventos terminales | 12 pruebas de conciliación; no se detectaron incidentes reales porque no se consultó producción |
| Tooling con aviso minimatch | P2 residual | Consumidores actuales necesitan API 3/10; versión corregida 11 cambia API. No se fuerza override global ni downgrade | Auditoría npm real: 16 moderadas en desarrollo/CI, 0 altas/críticas; producción 0 |
| Concurrencia y restore real sin ejecutar | Gate crítico | No hay Docker ni PostgreSQL local; no se usó producción como sustituto | BLOCKED, 40 pruebas omitidas |
| Sesiones/instalación móvil y configuración del despliegue | Gate crítico | Falta entorno autorizado y ensayos Android/iPhone | NOT RUN; checklist manual preparada |

El diagnóstico no encontró una nueva explotación comprobada de lectura entre
grupos en la revisión focal. Esto no certifica la base desplegada. Las pruebas
automatizadas validan reglas y fixtures locales; no una auditoría de intrusión
contra Supabase/Vercel real.

## Restricción monetaria de beta

### Interfaz y servidor

- Los grupos no tienen un selector ni una columna de moneda: la identidad y los
  balances globales ya usan UYU. El formulario explica que las operaciones nuevas
  son exclusivamente en pesos uruguayos; no se agrega otra configuración paralela.
- Los gastos normales y Cuenta inteligente nuevos parten en UYU/tasa 1 y no ofrecen
  selectores ni campos de conversión. Los importes aceptan coma decimal y se envían
  como cadenas canónicas; el cálculo conserva centésimos exactos.
- Un ticket escaneado extranjero o de moneda desconocida **no se importa como si
  sus precios fueran UYU**. Se informa el problema y se conserva el borrador.
- El servidor valida la moneda efectiva de la cuenta de productos. Para editar
  historia consulta el detalle autorizado, sin confiar en que `version > 0` pruebe
  que existe un gasto. La moneda y la tasa guardadas deben mantenerse.
- Los pagos ya eran UYU en el ledger. Se rechazan declaraciones nuevas de moneda
  extranjera o tasa no unitaria en la validación del servidor, en vez de ignorarlas.
- La presentación mantiene formato es-UY, por ejemplo `$ 1.250,50 UYU`, con etiquetas
  de moneda. No se introdujo coma flotante para operaciones monetarias.

### PostgreSQL 014 e historia

`supabase/migrations/202611020014_beta_uyu.sql` agrega wrappers a
`tuki_save_expense` y `tuki_prepare_payment`; los motores anteriores pasan a nombres
privados sin EXECUTE del cliente. Se mantienen orden de locks, autoridad, versiones,
hashes, asignaciones y recuperación. La moneda efectiva de `smartBill` tiene el
mismo significado que en el motor existente.

Altas extranjeras se rechazan incluso llamando RPC directamente. Un gasto histórico
puede corregirse si conserva moneda/tasa y cumple las reglas anteriores. Un reintento
del mismo ID histórico se delega al verificador de autor/hash; no se convierte en
un gasto nuevo ni se cambia su payload. Los pagos históricos siempre fueron UYU:
conservar un antiguo payload con campos extra ignorados no significa que se hayan
registrado divisas. La recuperación por ID mantiene ese resultado original.

No se actualiza, convierte, borra ni oculta ninguna fila histórica. Los reportes y
CSV/PDF mantienen subtotales originales separados y total UYU con cotización fijada
explícita; no consultan tasas actuales. Las regresiones extranjeras crean fixtures
**antes** de aplicar 014 y después verifican lectura, edición permitida, reintento
y exportación. No se exige crear un nuevo gasto USD bajo la política de beta.

**Aplicación manual pendiente:** verificar respaldo y proyecto correcto, revisar el
archivo completo 014 y ejecutarlo una sola vez como propietario después de 013.
No ejecutar fragmentos ni volver a aplicar migraciones anteriores. Comprobar luego
la política con los escenarios F en staging autorizado. La restricción se verificó
en capas locales; **no fue verificada de extremo a extremo en infraestructura real**.

## Pruebas funcionales y PostgreSQL

La suite nueva `tests/beta-uyu-sql.test.ts` aplica 001–013, crea historia ficticia,
aplica 014 y ejecuta 14 regresiones. Incluye un recorrido de pádel integrado en
PGlite: gasto 1.000,00 entre cuatro personas; 250,00 + 100,00 confirmados; un rechazo
y una solicitud adicional pendiente que no reducen deuda. Verifica gasto original
1.000,00, liquidado 350,00, pendiente bruto 400,00, balances con suma cero, eventos,
avisos y exportación CSV/PDF desde la respuesta real de la RPC local.

Eso es integración SQL embebida, **no PostgreSQL real con múltiples conexiones**,
HTTP hacia Supabase ni ensayo bancario. Los escenarios A–F que ejecutará el
propietario, incluido restaurante de ocho personas, están en
[beta-manual-testing.md](beta-manual-testing.md), con resultados esperados y
estados inicialmente NOT RUN.

El runner `node scripts/run-concurrency.mjs --check` devolvió **2**. Se comprobaron
PATH y ubicaciones habituales sin encontrar Docker/psql/postgres/pg_ctl. Las 40
pruebas de siete suites siguen BLOCKED: los saltos del runner no son PASS. La suite
beta más reciente aplicará también 014 cuando exista PostgreSQL local; las suites
históricas conservan sus fixtures de fase. No se ejecutó SQL en Supabase remoto.
Comandos reproducibles: [bloque-5-verificacion.md](bloque-5-verificacion.md).

## Conciliación financiera

`supabase/audits/financial_reconciliation.sql` continúa siendo una única consulta
de diagnóstico con CTE/SELECT. Agrega comprobaciones para obligaciones actuales
inactivas, importes fraccionarios/negativos/no finitos en fixtures sin constraints,
revisiones/partes huérfanas y falta de eventos terminales. Mantiene asignaciones,
sumas, estado confirmado, reversión, referencias y metadata de tickets.

No considera duplicado todo pago con igual importe/fecha: pueden ser pagos reales
distintos. Detecta incoherencias auditables y eventos duplicados; no prueba una
transferencia bancaria externa ni la existencia física de bytes de Storage.

Aplicación por el propietario, después de autorizar la consulta remota: abrir una
transacción `BEGIN TRANSACTION READ ONLY`, ejecutar el contenido completo del
diagnóstico y cerrar con `COMMIT`. No contiene un repair. Cero filas valida solo
esos checks en ese snapshot. Si hay filas, registrar ID, issue, impacto, causa
probable y propuesta/riesgo de reparación; no corregir saldos automáticamente.
No se obtuvieron resultados reales ni se inventan IDs de incidentes.

## Backup, restore y rollback

Los procedimientos preparados separan dump PostgreSQL y bytes de Storage;
incluyen configuración, migraciones, manifiesto/hash de archivos, cifrado y acceso
mínimo. Frecuencia propuesta para beta: diaria y antes de cambios, 7 copias diarias
y 4 semanales, ajustable al volumen y obligaciones. No es una afirmación de la
retención contratada en Supabase. Ver [verificación operativa](bloque-5-verificacion.md)
y [procedimiento detallado](bloque-1-operaciones.md).

No se ejecutaron backups reales ni restauración aislada. RTO medido: **desconocido**.
RPO alcanzado: **sin verificar**; con una copia diaria podrían perderse hasta las
operaciones posteriores a la última copia válida. Registrar reloj inicial/final,
errores, archivos ausentes y conciliación después de un ensayo, sin copiar datos
personales a servicios no autorizados. La comprobación de catálogo Storage no
equivale a descargar/verificar sus bytes.

Rollback preparado:

1. Detener nuevas invitaciones a beta y comunicar el incidente; preservar evidencia.
2. Suspender nuevas escrituras por un mecanismo operativo autorizado si corresponde;
   no borrar asignaciones ni corregir balances a mano.
3. Revertir el frontend al último artefacto compatible aprobado **manteniendo 014**:
   la base sigue bloqueando altas extranjeras de clientes viejos. No retirar la
   política UYU ni ejecutar migraciones inversas improvisadas.
4. Finalizar o recuperar operaciones con sus IDs originales y cerrar voluntariamente
   las ventanas para actualizar el worker. No forzar recargas de formularios.
5. Si se requiere recuperar datos, restaurar primero en un entorno aislado, validar
   DB/Storage/RLS/conciliación y medir pérdida/tiempo. Cambiar el destino productivo
   exige una autorización nueva y explícita; no se hizo en este trabajo.

## Seguridad, infraestructura y despliegue preparado

Se mantienen guard del servidor y proxy, PKCE/callbacks, RLS, permisos de invitados,
retiros/archivo, Storage privado y rutas de descarga autorizadas. El worker conserva
allowlist pública y no guarda HTML financiero, tokens, exports ni respuestas Supabase.
Los tests existentes de servidor/SQL siguen comprobando intentos cruzados y recuperación
ajena, además de controles de UI. OAuth, logout con historial/PWA y revocación en el
despliegue requieren ensayo manual.

El nuevo clasificador de clave legacy comprueba el rol declarado para decidir si
una clave puede estar en una variable pública; **no autentica ni verifica firmas**.
Supabase sigue verificando las credenciales. El build se bloquea antes de incluir
un valor secreto/privilegiado conocido en el bundle. No se inspeccionaron ni mostraron
valores de `.env.local`; no se afirma que esa instalación haya usado una clave secreta.
Si el propietario descubre una exposición previa, debe revocar/rotar en Supabase y
revisar despliegues/logs de manera autorizada; esta auditoría no confirma tal incidente.

Vercel ahora requiere allowlist de origen según entorno:

| Entorno | Configuración requerida |
| --- | --- |
| Local | Variables públicas de Supabase y origen local existentes; no se obliga a crear proyectos remotos |
| Preview/staging | `TUKI_STAGING_SUPABASE_ORIGIN` y `TUKI_PRODUCTION_SUPABASE_ORIGIN` aprobados y distintos; URL pública igual a staging; `TUKI_SITE_URL` HTTPS válido |
| Production | URL pública igual al origen productivo aprobado; origen de sitio HTTPS; staging distinto si está presente |

La allowlist es declarada por el propietario, no descubre proyectos automáticamente.
Comprobar IDs/proyectos independientes en Dashboard; dos aliases DNS diferentes no
demuestran dos bases distintas. Se actualizó `.env.example` sin claves ni secretos.
Instrucciones exactas de Vercel/Supabase y OAuth: [bloque-5-despliegue.md](bloque-5-despliegue.md).
No se configuraron proyectos, dominios, SMTP, Google, secretos ni buckets remotos.

Pasos del propietario antes de publicar:

1. Disponer de staging HTTPS y Supabase aislado; verificar orígenes, claves públicas
   y datos ficticios. Desactivar integraciones de producción.
2. Ejecutar concurrencia local aislada y ensayo de backup/restore, registrar resultados.
3. Respaldar, revisar y aplicar manualmente 014 en el entorno autorizado.
4. Configurar variables por ámbito Vercel, Site URL/Redirect URLs Supabase, OAuth
   Google y Storage privado siguiendo la guía; probar callbacks exactos sin comodines amplios.
5. Autorizar un despliegue de staging concreto. Esta entrega no lo ejecuta ni lo
   solicita automáticamente. Registrar versión/build y esquema usado.
6. Ejecutar escenarios A–F y dispositivos; inspeccionar headers/Cache Storage/logout,
   revisar logs sin payloads privados y completar la matriz con evidencia.
7. Resolver fallos y repetir controles afectados. Recién entonces decidir GO para
   un grupo pequeño, con responsable y canal para incidentes; no abrir beta pública.

## Dependencias, PWA, móviles y rendimiento

`npm audit --omit=dev` real: 0 avisos. `npm audit` completo: 16 moderados, 0
altos/críticos; son propagaciones del aviso minimatch a tooling. Se revisaron npm,
rangos de consumidores y mantenedor: los consumidores actuales requieren 3/10;
la versión corregida 11 rompe API. No se cambió paquete/lockfile para ocultar el
aviso. Exposición y alternativas: [bloque-5-dependencias.md](bloque-5-dependencias.md).

PWA, Chrome/Edge, Android e iPhone: checklist preparada, pruebas físicas **NOT RUN**.
No se asume sesión compartida entre Safari e instalación. No se realizaron pruebas
de intrusión contra terceros ni se solicitó push. No se informan resultados Lighthouse.

Rendimiento: antes del build se midió el artefacto estático previo hallado:
28 archivos JS, **1.048.611 bytes** sin comprimir, **334.506 bytes** al sumar gzip por
archivo. Es el conjunto completo de chunks en disco, **no JS inicial descargado por
una ruta**, latencia de usuario ni una medición móvil. El build final mantiene
28 archivos, **1.049.631 bytes** y **335.063 bytes** al sumar gzip por archivo:
1.020 bytes y 557 bytes más, respectivamente. No se atribuye una mejora de velocidad
sin benchmark. Consultas
con volumen real, memoria, red móvil y exportaciones extensas siguen pendientes.

## Matriz GO / NO-GO

PASS se limita al alcance de su evidencia. Una fila de pruebas locales no convierte
la fila de infraestructura/dispositivo correspondiente en PASS.

| Requisito | Estado | Evidencia | Riesgo pendiente | Responsable / siguiente acción |
| --- | --- | --- | --- | --- |
| Cálculo exacto, asignaciones, pagos/confirmaciones locales | PASS local | Suites dominio, SQL embebido y acciones | Carreras y plataforma real | Ingeniería + QA: concurrencia/staging |
| Concurrencia PostgreSQL | BLOCKED | Runner salida 2, 40 omitidas | Gate crítico sin verificar | Propietario: Docker/PostgreSQL aislado y runner |
| Recuperación idempotente local | PASS local | Protocolo, reintentos/IDs y escenarios SQL | Corte HTTP real en dispositivo | QA/propietario: escenario D |
| RLS/privacidad/Storage local | PASS local | SQL y rutas autorizadas | Configuración remota y bytes | Propietario: cuentas cruzadas + descarga real |
| Auth/OAuth/sesiones reales | NOT RUN | Implementación conservada + tests previos | SMTP, Google, instalación móvil | Propietario + QA: staging y móviles |
| Restricción UYU UI/servidor/SQL | PASS local | Formulario/acciones/schema + 014 en PGlite | 014 todavía no aplicada por esta tarea | Propietario: revisar/aplicar/probar F |
| Restricción UYU extremo a extremo desplegada | NOT RUN | Sin cambios remotos | Gate de producto sin verificar | Propietario: F en staging |
| Históricos multimoneda | PASS local | Fixtures pre-014, lectura/edición/reintento/exports después | Base real sin consultar | QA: históricos ficticios de staging |
| Reportes y exportaciones autorizadas | PASS local | RPC y archivos CSV/PDF | Visores y volumen real | QA/propietario: A–C/F |
| Conciliación de solo lectura | PASS local | 12 tests de corrupción sintética | No hay snapshot de base real | Propietario: consulta READ ONLY autorizada |
| Backup DB + Storage real | NOT RUN | Procedimiento preparado | Copias recuperables desconocidas | Propietario/SRE: copiar y verificar cifrado |
| Restauración aislada | BLOCKED | Sin PostgreSQL/entorno destino | Gate crítico; RTO/RPO desconocidos | Propietario/SRE: ejecutar ensayo cronometrado |
| Build/headers/configuración local | PASS local | Lint, typecheck, suite y build | No acredita el despliegue | Propietario: verificar despliegue autorizado |
| Separación Preview/Production | PASS local | Tests de allowlist/build | Configuración aprobada real | Propietario: configurar scopes y verificar IDs |
| PWA instalación y sesiones móviles | NOT RUN | Tests VM/jsdom previos | Gate físico sin verificar | QA/propietario: Android/iPhone |
| Desconexión/reconexión local | PASS local | Bloqueo/recovery/borrador en memoria | Discard del SO y red real | QA/propietario: escenario D y PWA |
| Dependencias producción | PASS auditoría actual | npm: 0 avisos producción | No certifica toda la aplicación | Ingeniería: repetir antes del release |
| Dependencias tooling | FAIL auditoría residual P2 | npm: 16 moderadas | Desarrollo/CI | Ingeniería: seguimiento de upstream, no force |
| Despliegue realizado | NOT RUN | No autorizado/ejecutado | Sin evidencia remota | Propietario: autorizar candidato tras gates |

**NO-GO:** concurrencia, restore, configuración efectiva y recorridos críticos en
dispositivos todavía no tienen evidencia satisfactoria. No se convierten en PASS
por un build o por documentar comandos.

## Archivos y validación final

Nuevos: `features/finance/beta-currency.ts`, `lib/public-supabase-key.ts`,
`lib/deployment.ts`, `supabase/migrations/202611020014_beta_uyu.sql`,
`tests/{beta-currency.test.ts,beta-uyu-sql.test.ts,deployment.test.ts}` y los informes
`bloque-5-{beta-release,dependencias,despliegue,verificacion}.md` y
`docs/beta-manual-testing.md`.

Modificados: formularios de gastos/Cuenta inteligente/grupo; acciones de gastos;
schemas de pagos y mensajes financieros; `lib/env.ts`, `next.config.ts`,
`.env.example`, diagnóstico de conciliación y sus pruebas; pruebas de formulario,
acciones, configuración y Cuenta inteligente; `README.md`. El motor de cálculo
multimoneda y las migraciones 001–013 se conservan.

Validación final local: **511 pruebas aprobadas, 0 fallidas y 40 omitidas**,
74 archivos aprobados y 7 omitidos. Lint, typecheck y build finalizaron correctamente.
El test de tema mantiene su advertencia conocida de React sobre una etiqueta script
en jsdom, sin fallo.

Una ejecución inicial tuvo 509 aprobadas y un fallo de inicialización: el arranque
frío de PGlite en el fixture de conciliación superó sus 10 segundos al iniciar toda
la suite. Se hizo explícito un presupuesto de 60 segundos para ese setup, igual
que en los otros fixtures SQL; no se modificaron las aserciones financieras ni se
omitió el caso. Las repeticiones completas finalizaron sin fallos.

Los tests SQL ejecutados son PGlite; **ninguna de las 40 pruebas PostgreSQL real
fue ejecutada aquí**. La recomendación final permanece NO-GO hasta completar y
aprobar los controles críticos pendientes.
