# Bloque 5 — Evidencia de concurrencia, conciliación y recuperación

Fecha: 2026-11-03. Documento complementario de la decisión de lanzamiento; no
sustituye [el informe de release](bloque-5-beta-release.md) ni las
[pruebas manuales pendientes](beta-manual-testing.md).

## Infraestructura comprobada

Se volvió a consultar PATH y ubicaciones habituales: no se encontraron Docker,
`psql`, `postgres` ni `pg_ctl`. No se instaló infraestructura, no se abrió una
conexión PostgreSQL real y no se conectó a Supabase remoto.

Ejecutado:

```powershell
node scripts/run-concurrency.mjs --check
```

Salida: «Docker Compose no disponible. Pruebas reales pendientes; no se ejecutó
SQL.» Se capturó `$LASTEXITCODE`: **2**. El estado de las 40 pruebas es **BLOCKED**
por infraestructura, no PASS. PGlite no verifica carreras entre conexiones distintas.

| Archivo | Casos reales pendientes |
| --- | ---: |
| `tests/groups-concurrency.test.ts` | 7 |
| `tests/finance-concurrency.test.ts` | 7 |
| `tests/smart-bill-concurrency.test.ts` | 4 |
| `tests/payments-concurrency.test.ts` | 5 |
| `tests/notifications-concurrency.test.ts` | 3 |
| `tests/admin-payment-concurrency.test.ts` | 3 |
| `tests/beta-finance-concurrency.test.ts` | 11 |
| Total | **40** |

El harness existente se revisó: solo localhost, rechaza parámetros URL y bases
preexistentes, no lee `.env.local`; usa PostgreSQL 17 efímero y siete bases vacías.
Las suites históricas fijan sus esquemas; la suite beta aplica el esquema actual.
No se cambió el bloqueo financiero global para agilizar pruebas.

### Ejecución reproducible por el operador

1. Instalar Docker Desktop con Compose según las instrucciones oficiales para el
   sistema y verificar que el motor esté iniciado. Usar un equipo de ensayo, sin
   túneles localhost hacia producción. Alternativa: cluster PostgreSQL local vacío
   dedicado a pruebas, no un proyecto real con datos.
2. Confirmar puerto local 55439 libre, Node/npm de la versión del proyecto y
   dependencias del lockfile. Desde la raíz del repositorio:

   ```powershell
   node scripts/run-concurrency.mjs --check
   node scripts/run-concurrency.mjs --docker
   ```

3. Guardar salida completa privada, versión PostgreSQL/Docker/Node, fecha, commit
   o identificación del código, migraciones y conteos PASS/FAIL. El runner elimina
   únicamente su proyecto Compose al terminar. No copiar comandos de eliminación
   de volúmenes o bases de otros proyectos para «limpiar» el entorno.
4. Si se usa cluster local en lugar de Docker, definir la variable exclusiva
   `TUKI_CONCURRENCY_LOCAL_URL` mediante gestor seguro hacia `/postgres` en localhost
   y ejecutar `node scripts/run-concurrency.mjs --local`. El runner crea siete bases
   sin sobrescribirlas; repetir exige un cluster de ensayo nuevo/vacío.
5. Repetir con la versión mayor del PostgreSQL del proyecto real antes del GO.
   Una espera de lock provocada por la suite no es una medición de latencia de beta.

Las carreras cubren pagos y confirmaciones simultáneos, parcialidades que exceden
juntas la deuda, reversión, claves repetidas/distintas, edición o retiro durante
pago y recuperación mientras confirma la transacción. El operador debe registrar
el resultado real de cada una; la mera presencia del caso no lo aprueba.

## Conciliación: revisión y correcciones del diagnóstico

`supabase/audits/financial_reconciliation.sql` sigue siendo una consulta `WITH …
SELECT` de propietario; no es una migración, RPC ni reparación. No actualiza saldos,
asignaciones o registros reales. Se ejecutó sobre fixtures locales deliberadamente
sin restricciones para representar una restauración corrupta/incompleta.

Se corrigieron huecos reproducibles de **detección**, no incidentes encontrados
en producción:

| Hallazgo | Causa anterior | Corrección y evidencia |
| --- | --- | --- |
| Obligación actual mal desactivada | La comprobación solo exigía que existiera una obligación de esa parte, aunque inactiva | Comprueba obligación activa de la versión actual de un gasto activo |
| Fracciones de centésimo coherentes entre tablas | Sumas idénticas podían coincidir aun con unidades inválidas en un restore sin constraints | Comprueba enteros, signo, nulos y valores no finitos en importes financieros |
| Estado terminal sin evento | Solo se exigían eventos de creación/confirmación | Exige evento de rechazo o anulación para esos estados |
| Revisiones/partes huérfanas sin deuda | Si no había obligación, sus joins no recorrían ciertas referencias | Verifica directamente gasto/grupo/pagador de revisión y revisión/persona de parte |

`tests/financial-reconciliation.test.ts`: **12 pruebas aprobadas**, incluyendo
ejecución dentro de `BEGIN TRANSACTION READ ONLY`, cantidades parciales correctas,
referencias, eventos, tickets, casos anteriores y no confundir pagos legítimos con
igual importe/partes pero IDs distintos. No se deduplica por nombre, fecha o importe.

### Aplicación en SQL Editor por el propietario, pendiente de autorización

1. Elegir el proyecto correcto y registrar entorno/versión. El rol debe poder leer
   todas las tablas; ejecutar como usuario restringido por RLS puede dar un falso cero.
2. Abrir SQL Editor y ejecutar como una única operación:

   ```sql
   begin transaction read only;
   -- Pegar aquí TODO supabase/audits/financial_reconciliation.sql.
   commit;
   ```

3. Guardar solo el informe técnico restringido: `issue`, `entity_id`, `details`,
   hora/snapshot, versión y responsable. Si hay error, cerrar/revertir la transacción
   de lectura y no tratarlo como «cero discrepancias».
4. Cualquier fila impide aceptar la conciliación hasta investigar. Para cada hallazgo
   registrar ID, naturaleza, impacto, causa probable, corrección propuesta, riesgo
   y responsable. No arreglar a mano ni borrar asignaciones para silenciarlo.
5. Repetir después de cambios de esquema, restore e incidente; usar una frecuencia
   diaria durante beta como propuesta operativa, no como tarea ya desplegada.

Cero filas prueba únicamente estas invariantes en ese snapshot. No prueba que
hubo una transferencia bancaria, que no se registró dos veces una entrega humana
con IDs distintos, ni que existen físicamente los bytes de Storage. Tampoco
recalcula un estado histórico a una fecha anterior. Los balances se derivan del
ledger; conciliación no sustituye validar proyecciones y permisos con cuentas distintas.

## Seguridad: alcance observado

Se revisaron guard servidor/proxy, redirecciones permitidas, PKCE, operaciones
recuperables, descargas y worker. No se confirmó una explotación P0 nueva en esa
revisión focal. Esa observación **no certifica** RLS/Storage/Auth desplegados.

- Descargas de gastos/pagos verifican `getUser` y consultan mediante cliente
  autenticado sujeto a RLS; no usan service-role en el navegador.
- El ticket exige revisión autorizada y descarga privada; la política de Storage
  depende de membresía y reserva, no de un bucket público.
- Las operaciones de recuperación validan UUID y dueño desde RPC, no solo en UI.
- El proxy marca documentos privados `private, no-store`; el worker no guarda
  HTML privado, RSC, Supabase, comprobantes ni exportaciones.
- Los logs de operación limitan referencia técnica y código; no imprimen payload,
  nombres, importes ni tokens. No se leyó `.env.local` para esta verificación.

Falta probar el logout con historial/bfcache y PWA real, las configuraciones de
OAuth/correo, los permisos de la instalación remota y los casos negativos entre
usuarios en staging. El ocultamiento de un botón nunca es evidencia suficiente.

## Backups y restauración: procedimiento preparado, ensayo NOT RUN

La [guía previa](bloque-1-operaciones.md) conserva los comandos y excepciones de
roles, esquemas gestionados, triggers de Auth y políticas Storage. Se contrastó con
la [guía oficial actual de backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
La base y los bytes de Storage deben respaldarse por separado; restaurar metadatos
no recupera objetos borrados. [Backups oficiales](https://supabase.com/docs/guides/platform/backups).

Ensayo reproducible pendiente:

1. Responsable y custodio revisan autorización de origen/destino, plan/PITR/retención
   contratada y ruta privada cifrada fuera del repositorio. Inventariar versión,
   migraciones, configuraciones sin secretos y último backup comprobado.
2. En ventana autorizada, pausar escrituras/cargas e integraciones externas para
   alinear generación DB/Storage. Capturar dump de roles, esquema, datos e historial
   de migraciones según guía oficial, además de personalizaciones gestionadas.
3. Descargar todos los objetos privados por Dashboard/CLI/S3 autorizado, sin hacer
   público el bucket ni usar sincronización que borre. Crear manifiesto privado de
   ruta/tamaño/MIME/SHA-256. [Descarga oficial](https://supabase.com/docs/guides/storage/management/download-objects).
4. Cifrar dump, objetos y manifiesto; la clave se guarda aparte. Verificar hashes y
   conteos antes de reanudar. Propuesta: copia diaria y antes de migración, 7 diarias
   y 4 semanales. No es la retención del plan real ni un RPO logrado.
5. Crear destino aislado expresamente autorizado, desactivar correo/cron/webhooks,
   comprobar versiones/extensiones y restaurar con error fatal ante importación
   fallida. No reaplicar migraciones completas sobre tablas ya restauradas.
6. Restaurar objetos en buckets privados con rutas originales; comparar **cada**
   hash y tamaño. El Compose de concurrencia no reproduce Auth/Storage completo.
7. Comparar referencias/restricciones, conteos y permisos; ejecutar conciliación
   de solo lectura y probar descargas permitidas/denegadas, login y operaciones
   recuperables con cuentas de ensayo. No reutilizar callbacks productivos.
8. Registrar inicio/fin de descarga, importación DB, importación objetos, validación
   y vuelta al servicio; registrar copia elegida y ventana de escrituras perdida.
   Firmar PASS/FAIL con evidencias, sin cambiar producción.

No se realizó backup real ni restore aislado. **RTO real desconocido**; el tiempo
de una prueba local no se extrapola. Con copia diaria, RPO propuesto de hasta 24 h
solo se sostiene si DB y Storage de esa generación se verifican. PITR de base no
garantiza recuperar un archivo externo eliminado. No hacer rollback de datos
restaurando producción por un fallo de frontend; revertir despliegue requiere
compatibilidad con el esquema vigente y autorización separada.

## Decisión operativa

**NO-GO** mientras concurrencia, restore, conciliación real y privacidad/sesiones
de staging no tengan evidencia propia. Los procedimientos preparados son útiles,
pero no convierten BLOCKED/NOT RUN en PASS.
