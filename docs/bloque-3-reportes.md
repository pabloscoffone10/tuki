# Bloque 3 — Estadísticas, exportaciones e historial financiero

## Estado y alcance

Implementado sobre Tuki existente, sin modificar migraciones 001–012 ni el motor
de gastos, asignaciones, compensación, confirmaciones o recuperación. Se prepara
una migración nueva **013**, pendiente de aplicación por el propietario. No se
ejecutó SQL remoto, no se modificaron datos reales ni se instalaron dependencias.
Se reutiliza `pdf-lib`, que ya estaba instalado. No hay servicios pagos nuevos.

La existencia de código y las pruebas locales no certifican el despliegue en
Supabase. Las 40 pruebas anteriores que necesitan PostgreSQL real siguen pendientes.

## Diagnóstico anterior

- Resumen y Saldos ya tenían obligaciones, compensación por par y un ledger
  propio del grupo; faltaban período, categorías, evolución y reportes descargables.
- `ExpenseFilters` buscaba descripción/grupo, estado, categoría y fechas sobre
  toda la lista recibida de `tuki_list_expenses`. No había paginación ni búsqueda
  por pagador, participante, moneda o importe en servidor.
- Actividad usaba `tuki_finance_activity`: hasta 100 eventos de gastos, sin unir
  pagos. El detalle del gasto ya conservaba versiones; cada pago ya tenía auditoría.
- Inicio cargaba listas de obligaciones y gastos para mostrar pequeños resúmenes.
  No se reconstruyeron ni duplicaron esos eventos o el ledger financiero.

## Pantallas y navegación

**Grupo → Resumen:** conserva los controles de deudas del Bloque 2 y agrega
«Entender los gastos». Incluye período, cuatro indicadores, tarjetas por persona,
barras comparativas, distribución por categorías y evolución mensual plegable.
Debajo se descargan CSV y PDF del mismo período. No se reemplazaron las pestañas.
No se obtuvieron capturas; esta es la descripción de la interfaz implementada.

**Grupo → Gastos y `/gastos`:** filtros en servidor, opciones secundarias plegables,
chips de filtros activos y enlaces Anterior/Siguiente. Se conservan los enlaces
al detalle y las reglas para crear gastos en grupos no archivados.

**Actividad y Grupo → Ajustes e historial:** historial financiero paginado con
gastos y pagos autorizados. El historial administrativo existente permanece
separado para membresías, invitaciones y cambios del grupo.

**Inicio:** mantiene las tarjetas de balance y suma «Tu consumo, adelantos y
liquidaciones» plegable. Los últimos gastos están limitados a cinco, con acceso
a la búsqueda completa. El resumen personal se reutiliza dentro de la misma
petición mediante `React.cache`; no es una caché compartida entre usuarios.

## Definición de los indicadores

| Indicador | Significado y período |
| --- | --- |
| Gastos originales | Suma UYU de versiones actuales de gastos activos cuyo origen es el grupo, filtrados por fecha del gasto |
| Adelantó | Total que pagó inicialmente esa persona como pagador de esos gastos; no equivale a su consumo |
| Consumió | Suma de las partes asignadas a esa persona en los gastos seleccionados |
| Liquidado confirmado | Asignaciones confirmadas y no revertidas sobre obligaciones de esos gastos, al consultar |
| Pendiente bruto | Resto de esas obligaciones, antes de compensar deudas inversas de un mismo par |
| Balance del conjunto | Adelantado − consumido + liquidado por la persona − liquidaciones recibidas |
| Solicitudes pendientes | Pagos pendientes visibles para la cuenta, con contexto explícito en este grupo y fecha declarada del pago dentro del período |

Los pagos de liquidación **no aumentan el gasto original**. Liquidado y pendiente
son una fotografía actual de los gastos seleccionados, no un cierre histórico al
último día del período. Un pago posterior al viaje puede liquidar un gasto del viaje.
Una solicitud global sin asignaciones no tiene origen demostrable y no se atribuye
arbitrariamente a un grupo para contar sus pendientes.

El saldo bruto del reporte no reemplaza el neto entre dos personas de Saldos/Pagos.
Las proyecciones de deudas de Piria visibles en Juana no se suman al gasto de Juana.
Las versiones anuladas no se suman; su anulación permanece en el historial.

### Ejemplo ilustrativo, sin datos de demostración insertados

Pablo adelanta $ 1.000 UYU en una cena y el consumo se reparte $ 500 por persona
entre Pablo y Mati. Mati paga y se confirma $ 200:

- Gasto original: $ 1.000, nunca $ 1.200.
- Pablo: adelantó $ 1.000, consumió $ 500, recibió liquidaciones $ 200.
- Mati: adelantó $ 0, consumió $ 500, liquidó $ 200.
- Obligación bruta restante: $ 300; balances del conjunto +$ 300 y −$ 300.

Si existe una deuda inversa, su compensación se consulta en Saldos; no se oculta
dentro del indicador bruto. Si la misma deuda aparece en otro grupo compartido,
continúa existiendo una sola obligación.

## Monedas, gráficos y exactitud

Todos los cálculos SQL usan `numeric` entero en centésimos y los importes viajan
como cadenas. TypeScript usa `BigInt` para importes y validaciones. Cada gasto usa
su cotización guardada; no se consultan tasas actuales ni se mezclan subtotales
originales. El CSV incluye moneda original, importe, cotización y total UYU.

Las barras muestran importes con etiquetas legibles y alternativas textuales;
su ancho visual se deriva de una razón entera. No se usa coma flotante para sumar
dinero. La evolución se agrupa por mes de la fecha del gasto. Las categorías son
las registradas, sin inferirlas con IA. Los períodos vacíos muestran mensajes,
no distribuciones inventadas. No se agregó una biblioteca de gráficos.

## Filtros e historial

- Descripción literal, Desde/Hasta, pagador, participante, moneda original,
  categoría, importe mínimo/máximo convertido a UYU, activo/anulado/todos y orden
  por fecha o importe. Se aceptan coma o punto decimal en los importes de filtro.
- Los filtros se conservan en la URL al paginar y al volver con el navegador.
  Cambiar filtros empieza desde la primera página; Limpiar vuelve al estado inicial
  de gastos activos. Las opciones de personas son autorizadas y limitadas a 500;
  no se descubren identidades globales por una búsqueda fuera del grupo.
- Cada página muestra hasta 25 registros; SQL admite como máximo 100 por llamada.
  Los empates tienen un orden estable por ID. La paginación por desplazamiento
  puede cambiar si se agregan registros mientras se navega; no pretende ser un
  snapshot entre peticiones independientes.
- Actividad filtra por fecha de registro del evento en `America/Montevideo` y
  muestra aparte la fecha declarada del gasto/pago. Se diferencian solicitud,
  confirmación, rechazo y anulación/reversión; los estados corresponden al evento.
  El enlace permite consultar el detalle autorizado y la auditoría existente.
- El historial de pagos del grupo incluye el contexto explícito del pago;
  un pago global sin ese contexto no se reasigna a un grupo por conveniencia visual.

## Exportaciones privadas bajo demanda

Ruta: `/grupos/[groupId]/exportar?format=csv|pdf&from=AAAA-MM-DD&to=AAAA-MM-DD`.
Solo admite esos parámetros, sin repeticiones. Autentica la cuenta por cookies y
llama a una RPC que vuelve a comprobar membresía activa. Los filtros nunca conceden
autorización. Un retirado no gana acceso a estadísticas/exportaciones del grupo;
un miembro activo conserva el acceso de lectura si el grupo está archivado.

La RPC obtiene estadísticas y gastos en un único snapshot de lectura. Límite:
**1.000 gastos activos por exportación**, con páginas internas de 100; si se
supera, responde con un error para acotar el período, sin truncar silenciosamente.
La validación del documento también limita a 1.000 personas en el resumen y en
cada reparto; conjuntos mayores no generan un archivo parcial y requieren acotar
el período. No se incluyen notas privadas, comprobantes, tickets ni bytes de Storage.

**CSV:** UTF-8 con BOM para Excel, punto y coma, celdas entre comillas, escapes de
comillas/saltos de línea y coma decimal. Protege prefijos de fórmulas (`=`, `+`,
`-`, `@`) incluidos los precedidos por espacios o controles. Incluye datos de
gastos, personas y reparto, subtotales por moneda y resumen de liquidación.

**PDF:** documento real con marca Tuki, grupo, período, fecha de generación,
indicadores, adelantos/consumo/liquidaciones por persona y monedas. Pagina sin un
servicio externo. La fuente estándar admite español; caracteres no disponibles,
como algunos emojis, se sustituyen por `?` y se advierte en el documento. El CSV
conserva los nombres Unicode completos. No es un PDF etiquetado para accesibilidad.

Las respuestas son adjuntos con `private, no-store`, `nosniff` y política sandbox.
No se almacenan exportaciones ni se generan URLs públicas. Descargar un archivo
permite al usuario compartirlo fuera de Tuki: la aplicación no controla esas copias.

## Estadísticas personales

Consumo y adelantos incluyen solo gastos activos de grupos a los que la cuenta
todavía tiene acceso y en los que pagó o tuvo una parte. Los pagos confirmados
propios incluyen también los históricos autorizados: por eso la interfaz aclara
que son conjuntos distintos. Las obligaciones personales netas se agregan una vez
por contraparte sobre las obligaciones globales, sin iterar y sumar proyecciones
de cada grupo. Los grupos recientes son hasta cinco grupos autorizados con gastos
en los que participó, ordenados por registro del gasto.

No se revelan títulos o detalles privados de grupos inaccesibles para explicar
un saldo personal. Las identidades retiradas se enmascaran si la política existente
`can_view_person` no permite leer su nombre; no se asume que sean invitados.

## Seguridad y rendimiento

La migración 013 crea cinco RPC públicas de lectura, una vista y un guard privado,
y tres índices. Las RPC son `STABLE`, `SECURITY DEFINER` con `search_path=''` y
acceso exclusivamente de `authenticated`; cada consulta aplica su alcance explícito.
La vista y el guard privados no tienen permisos directos para el cliente. Se exige
cuenta con correo confirmado. No se modifica RLS, el esquema expuesto ni el bloqueo
financiero global. Los informes funcionan dentro de una transacción de solo lectura.

Agregaciones, filtros y paginación se ejecutan en PostgreSQL. El cliente no recibe
toda la lista de gastos para buscar. Inicio recibe cinco gastos y agregados
personales en lugar de listas completas para calcular sus tarjetas. No hay una
consulta de detalle por gasto (N+1) ni por evento. Los índices apoyan origen/fecha,
revisión de obligación y tiempo de eventos; el plan real depende del volumen.

No se midió latencia de producción ni se afirma una mejora porcentual. Las vistas
operativas anteriores de pagos y detalle financiero conservan sus listas actuales:
no se alteraron para reemplazar a ciegas el protocolo financiero. El historial
administrativo mantiene su límite anterior de 30 eventos.

## Archivos del bloque

Nuevos:

- `supabase/migrations/202611020013_reporting.sql`.
- `features/reports/{types.ts,data.ts,statistics.tsx,browser-query.ts,expense-browser.tsx,history.tsx,export.ts}`.
- `app/(private)/grupos/[groupId]/exportar/route.ts`.
- `tests/{reporting-sql.test.ts,report-exports.test.ts,report-browser-query.test.ts,report-browsers.test.tsx,report-statistics-ui.test.tsx,report-data.test.ts}`.
- Este informe.

Modificados:

- `features/groups/components/group-detail.tsx`.
- `features/finance/components/views.tsx`.
- `features/overview/components/overview.tsx`.
- `app/(private)/gastos/page.tsx` y `app/(private)/actividad/page.tsx`.
- `tests/groups-privacy-ui.test.tsx` y `tests/overview-onboarding.test.tsx`:
  aislamiento de componentes de reportes ajenos al objetivo de esas pruebas.
- `README.md`.

## Aplicación manual de 013

1. Confirmar proyecto y respaldo, y que 001–012 estén aplicadas.
2. Revisar el archivo completo `202611020013_reporting.sql`.
3. Ejecutarlo **una sola vez**, completo, como propietario en Supabase SQL Editor.
   No volver a aplicar 001–012 ni ejecutar fragmentos.
4. Recargar Tuki y comprobar Resumen, Gastos, Actividad y las dos descargas.

No hay nuevas variables de entorno. Si falta 013, la interfaz muestra el requisito
de migración y no inventa totales en cero. La migración no actualiza ni borra filas
financieras. Sus índices pueden requerir una ventana acorde al volumen real.

## Pruebas y verificación manual

Las pruebas nuevas cubren totales/ledger, parcialidades y reversión, pendientes,
monedas y período, filtros/paginación, exportación completa, límite de tamaño,
CSV Formula Injection, PDF multipágina, autenticación y respuestas sin secretos.
También verifican Juana/Piria/Facu, exportación de grupo ajeno, retirados, archivo,
enmascarado de nombres, permisos internos y uso en transacción de solo lectura.
SQL se ejecuta localmente en PGlite aplicando 001–013. El documento producido por
la RPC real se valida contra el esquema de exportación.

Lint, typecheck y build finalizaron correctamente. La ejecución completa final
`npm test -- --reporter=dot` aprobó **446 pruebas**, con **0 fallidas y 40 omitidas**
(68 archivos aprobados y 7 omitidos), incluida la regresión de error de red en
exportaciones. Las omitidas requieren PostgreSQL real. Permanece una advertencia
conocida de React sobre una etiqueta script en el test del tema con jsdom. Un
primer run completo tuvo un timeout al preparar una prueba existente de conciliación
mientras compilaba el build; la repetición aislada pasó. No se cuenta ese run como
una ejecución completa aprobada.

Antes de usar en beta, probar con dos cuentas, un invitado y Juana/Piria:

1. Crear gastos distintos en cada origen; comprobar que la deuda puede proyectarse
   pero el gasto de Piria no aparece en estadísticas ni CSV/PDF de Juana.
2. Iniciar como Facu sin membresía en Juana e intentar sus URLs directas y RPC.
3. Confirmar pago parcial, revisar totales y luego revertirlo con autorización.
4. Cambiar moneda original, período y filtros; comprobar cotización fijada y
   diferencia entre fecha del gasto y fecha del evento.
5. Retirar a un miembro y revisar acceso; archivar el grupo y revisar lectura.
6. Descargar CSV en Excel/Sheets y PDF en un visor, incluidos acentos, emojis,
   nombres largos y fórmulas como descripción. Probar exportación sin datos.
7. Revisar paginación con más de 25 registros y límite con más de 1.000.
8. Recorrer móvil, teclado y lector de pantalla. No se probó en dispositivos físicos.

## Pendientes y recomendaciones para Bloque 4

Ejecutar las 40 pruebas de concurrencia con PostgreSQL real y la comprobación del
despliegue antes de declarar lista la beta. Medir planes con `EXPLAIN ANALYZE` y
datos representativos antes de modificar índices o el bloqueo financiero.
Evaluar paginación por cursor para volúmenes mayores, cola privada para reportes
muy extensos y fuente Unicode/PDF accesible si los usuarios lo requieren. Revisar
la paginación de las vistas operativas antiguas como un cambio independiente con
pruebas del protocolo de recuperación. Ninguna de estas propuestas ni el Bloque 4
se implementó en este trabajo.
