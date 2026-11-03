# Fase 4.5 — Cuenta inteligente

Extensión de los gastos de Fase 4. No implementa pagos ni liquidaciones. La
carga manual funciona sin contratar ni configurar IA. No se ejecutó SQL remoto,
no se leyó `.env.local` y no se hicieron llamadas pagas de escaneo para probar.

## Instalación

1. Verificá que 001–005 ya estén aplicadas en el proyecto Supabase correcto.
2. En **SQL Editor → New query**, pegá completo
   `supabase/migrations/202611020006_smart_bills.sql` y ejecutalo una sola vez
   como propietario del proyecto. Incluye `begin` / `commit` y recarga de
   PostgREST. No repitas ni edites 001–005. No necesita borrar datos existentes.
3. En Storage verificá que se creó **tuki-tickets**, **privado**, con límite de
   2 MiB y MIME JPG, PNG, WEBP y PDF. Revisá que no haya políticas generales de
   tu proyecto que concedan acceso a este bucket por fuera de las tres políticas
   `tuki_ticket_*`. Mantené `tuki_private` fuera de los esquemas expuestos por la API.
4. Reiniciá `npm run dev`. La carga manual ya debería estar disponible.

La migración crea `smart_bill_revisions`, `ticket_uploads` y
`receipt_scan_requests`. Mueve el motor existente a un auxiliar privado sin
EXECUTE para clientes y conserva la firma pública `tuki_save_expense`. El wrapper
recalcula el desglose en PostgreSQL y delega en ese mismo motor: no hay un segundo
sistema de balances u obligaciones. El detalle antiguo de gastos sigue funcionando.

También amplía la lista explícita del guard de eliminaciones de 005 para conocer
estas tablas. Los grupos sin finanzas siguen siendo eliminables; cualquier
gasto inteligente histórico mantiene la prohibición de borrado definitivo.

## Configurar IA opcional

Adaptador implementado: **OpenAI Responses API**, entradas de imagen/PDF y
Structured Outputs, con validación Zod adicional. El contrato `ReceiptProvider`
permite reemplazar el proveedor sin tocar el cálculo ni el editor. No hace falta
un SDK OpenAI: usa `fetch` en un módulo `server-only` y un endpoint fijo.

En `.env.local` agregá los siguientes nombres y completá sus valores localmente:

```dotenv
TUKI_AI_PROVIDER=openai
OPENAI_API_KEY=
TUKI_AI_MODEL=gpt-4.1-mini
```

La clave debe pertenecer a un proyecto API con facturación y acceso al modelo.
No es una clave de Supabase ni una suscripción de ChatGPT. `gpt-4.1-mini` es un
ejemplo configurable con entrada de imagen y salida estructurada; no se impone
un modelo por defecto. Si elegís otro, verificá compatibilidad con imagen, PDF,
Responses y JSON Schema estricto. No uses prefijos `NEXT_PUBLIC_` en estas claves.

Si falta proveedor, clave o modelo, la pantalla muestra **Escaneo con IA no
disponible**. No afecta la carga manual. Antes de enviar, el usuario debe aceptar
expresamente que el archivo se enviará a OpenAI y que puede contener información
personal. Adjuntar un archivo manualmente no lo envía al proveedor.

La petición lleva `store:false`, no usa herramientas, no crea archivos persistidos
en la API y no habilita reintentos automáticos. Esto no equivale a una garantía de
retención cero del proveedor: revisá sus condiciones de tratamiento de datos para
tu cuenta antes de habilitar el servicio. No se registran imágenes, texto del
ticket, tokens, claves ni cuerpos de respuesta en logs de la aplicación.

## Límites y costos

- Archivos de hasta **2 MiB**; PDFs legibles sin contraseña, **hasta 3 páginas**,
  con dimensiones de hasta 3.000 puntos por lado. JPG/PNG/WEBP estáticos, hasta
  **16 megapíxeles**. Se verifica firma, MIME y estructura con `pdf-lib` / `sharp`.
- Máximo **80 productos**, **12 ajustes** y **100 consumidores por gasto**.
- Respuesta de IA de hasta **4.000 tokens**, espera de **45 segundos** y límite
  adicional de tamaño de respuesta. Tickets extensos pueden quedar incompletos:
  se informa el error, no se fabrica un resultado para guardar.
- Cuotas en PostgreSQL: **2 solicitudes/minuto y 10/24 h por usuario**, y
  **200/24 h para toda la aplicación**. Se reservan bajo bloqueo antes de llamar
  al proveedor. Intentos fallidos también consumen cuota. No se permite volver
  a escanear el mismo hash de archivo por el mismo usuario durante 24 h.
- Hasta **10 reservas de comprobantes por usuario en 24 h**, incluso sin IA.

El proveedor cobra por tokens de entrada (incluidas imágenes/PDF) y salida;
no hay un precio fijo por foto. Como referencia consultada el 2/11/2026,
GPT-4.1 mini publica USD 0,40 por millón de tokens de entrada y USD 1,60 por
millón de salida. Una solicitud hipotética de 5.000 tokens de entrada y 2.000
de salida costaría USD 0,0052, **no una medición de este escáner**. El tamaño
visual, páginas y salida cambian el costo. Las cuotas de solicitudes no son
un tope monetario; configurá presupuesto/alertas en tu cuenta y revisá precios.
También hay consumo de Storage y transferencia en Supabase.

Referencias oficiales: [modelo y precios](https://developers.openai.com/api/docs/models/gpt-4.1-mini),
[archivos PDF](https://developers.openai.com/api/docs/guides/file-inputs),
[salida estructurada](https://developers.openai.com/api/docs/guides/structured-outputs),
[privacidad de buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Uso manual

1. Abrí un grupo activo → **Nuevo gasto → Cuenta inteligente**.
2. Agregá un producto: Milanesa, cantidad **3**, precio por unidad **630**.
   Elegí reparto por cantidades y asigná **1** a Pablo, **1** a Mati y **1** a
   Guille. Las cantidades asignadas deben sumar exactamente 3.
3. Agregá Whisky, cantidad 1, subtotal **1.600** (en el campo, escribí `1600`).
   Elegí reparto igual y seleccioná sus consumidores. No tienen que ser todo
   el grupo ni incluir a quien pagó.
4. Agregá propina fija o porcentual. Elegí consumidores y reparto igual,
   proporcional a su consumo acumulado o personalizado. Si la propina ya
   figura en el total impreso, marcá **incluida**; si se agrega después, no.
5. Ingresá el total impreso. La diferencia debe ser cero. Si no hay ticket o
   el total es ilegible, dejalo vacío y explicá el motivo (mínimo 8 caracteres).
   No se permite ignorar una diferencia numérica conocida; corregí los datos
   o agregá un redondeo explícito y revisable.
6. Pasá a **Resumen individual**, elegí quién pagó y confirmá la revisión.
   Cambiar productos, cargos o pagador vuelve a pedir confirmación. Guardar
   genera un gasto normal de Tuki con sus repartos personalizados.

Usá punto decimal en los campos, sin separadores de miles. Importes y descuentos:
2 decimales; cantidades y porcentajes: hasta 4; cotización: hasta 6. Los importes
del editor se ingresan en la moneda del ticket. Los personalizados de cada cargo
también están en esa moneda; el resumen final y las obligaciones son UYU.

## Reglas de cálculo

Cantidad × precio unitario redondea medio centésimo hacia arriba. Si se elige
subtotal, el precio ya representa toda la línea y no vuelve a multiplicarse.
El descuento del producto se resta de su precio bruto antes de repartirlo.
No ingreses simultáneamente un subtotal ya descontado y el mismo descuento otra vez.

Los ajustes generales se aplican **en el orden mostrado**. Cada porcentaje toma
el subtotal vigente luego de los ajustes anteriores; el botón Subir permite
modificar ese orden. El reparto proporcional usa el consumo acumulado de los
consumidores seleccionados. Un descuento no puede dejar negativo a ningún
consumidor: si un reparto igual lo hiciera, elegí proporcional o personalizado.

La propina se suma una sola vez. Marcarla incluida significa que se compara con
el total impreso; una propina agregada después se excluye de esa comparación.
El redondeo es una línea explícita, positiva o negativa. No se inventan productos
ni ajustes para cerrar diferencias. Los restos se reparten por mayor resto y
UUID ascendente, igual que en Fase 4.

Para moneda extranjera se obtiene el total original y sus consumos exactos,
se convierte el total una vez a UYU con la cotización fija y se distribuyen los
centésimos UYU proporcionalmente a esos consumos. La suma coincide exactamente
con el gasto. Todo usa enteros `bigint` / `numeric`, sin operaciones financieras
con floats de JavaScript. PostgreSQL recalcula y reemplaza cualquier total o
reparto enviado por el navegador.

## Probar con foto/PDF

1. Configurá el proveedor y reiniciá el servidor.
2. Elegí Cuenta inteligente y subí un JPG/PNG/WEBP o PDF de prueba, sin datos
   personales innecesarios. Aceptá el envío a OpenAI y pulsá Escanear.
3. Revisá las advertencias antes de **Reemplazar borrador con datos detectados**.
   La importación reemplaza el borrador solo al pulsar ese botón; no guarda gastos.
   Los campos ilegibles quedan vacíos. Todos los productos/cargos importados
   requieren revisión expresa, aunque el modelo diga que está seguro.
4. Corregí productos, cantidades, precios brutos, descuentos y si la propina ya
   estaba incluida. Asigná consumidores y conciliá el total. No se deduplica por
   nombre: pueden existir dos compras reales del mismo producto.
5. Guardá después de revisar. El mismo archivo seleccionado se adjunta al gasto
   en Storage privado. El escaneo por sí solo no lo guarda en Storage ni crea gasto.
6. Probá un ticket borroso, uno incompleto, un PDF de varias páginas y volver a
   enviar el mismo archivo. Debe informar problemas o duplicado y dejar disponible
   la carga manual. Para retomar una extracción anterior, conservá la pestaña:
   no se almacenan respuestas de IA ni borradores automáticamente en el servidor.

## Seguridad, historial y tickets

El gasto y su desglose se guardan en una misma transacción. Se conserva el control
de versión de Fase 4: una edición desactualizada falla. No se puede editar una
cuenta inteligente omitiendo su documento. Las versiones anteriores conservan
productos, asignaciones y cargos; se pueden consultar desde Historial inmutable.
La anulación es la existente: desactiva obligaciones y conserva el historial.

Solo miembros activos del origen consultan el desglose o descargan el archivo.
En otro grupo compartido solo se ve la obligación y el grupo de origen. La
descarga autenticada pasa por RLS en cada petición, sin URLs públicas o firmadas
que sigan válidas al retirarse. El Route Handler entrega un adjunto `no-store`
con `nosniff` y sandbox. La clave OpenAI nunca se envía al navegador.

Los archivos vinculados a una revisión son inmutables: sin UPDATE, sin borrado
por clientes y con FK al objeto de Storage para impedir una carrera de borrado
pendiente contra el guardado financiero. Los reintentos del mismo archivo y
versión reutilizan una reserva estable. Al reemplazar o quitar un ticket de la
nueva versión, la anterior lo conserva. Los comprobantes normales antiguos de
Fase 4 continúan con su mecanismo previo; no se migran ni se sobrescriben.

Storage no comparte transacción con PostgreSQL. Se sube primero, se vincula en
la transacción financiera y se intenta limpiar si falla el guardado. Un corte
de red/proceso puede dejar archivos pendientes privados; no deja un gasto sin
desglose. Hace falta un mantenimiento controlado de objetos pendientes sin
referencias usando la **API de Storage**, nunca DELETE manual de su metadata.
No se implementó una tarea remota de limpieza automática. Un grupo borrado sin
gastos puede dejar reservas con `group_id=null`; sus objetos quedan inaccesibles
para clientes y requieren esa limpieza. Los tickets vinculados son historia
financiera: no se deben purgar como pendientes.

## Pruebas y pendientes

Resultado local: **225 pruebas aprobadas y 18 omitidas**; estas últimas son los
escenarios que requieren PostgreSQL local con varias conexiones (4 nuevos en
esta fase y 14 anteriores). La suite nueva incluye 13 pruebas SQL reales, además
de las 68 SQL de fases anteriores. Lint, typecheck y build se ejecutan junto
con la suite completa; los resultados de escaneo siguen siendo simulados.

Las pruebas puras cubren productos individuales/compartidos, unidades fraccionadas,
precios/subtotales, descuentos, cargos, propina igual/proporcional/personalizada,
redondeos, FX, conciliación, campos dudosos y confirmación. Hay pruebas de
archivos reales generados localmente y del proveedor con `fetch` simulado.

Las pruebas SQL aplican 001–006 en PGlite con roles y RLS. Simulan únicamente el
esquema de metadata de Storage para probar políticas y FK: **no equivalen a una
prueba del servicio Supabase Storage**. Verifican integración, versiones,
anulación, deuda compartida, privacidad, cuotas, compatibilidad normal y
atomicidad. Las suites de Fase 4 se mantienen contra 001–005 como regresión;
la suite nueva comprueba la convivencia después de 006.

**El escaneo real y la integración real de Storage quedan pendientes de probar
con tu configuración.** Las respuestas de extracción probadas fueron simuladas;
no se afirma calidad OCR ni compatibilidad de una cuenta API no configurada.
También queda pendiente la revisión visual en dispositivos reales.

Para concurrencia, hay cuatro escenarios nuevos con dos conexiones PostgreSQL
reales: ediciones simultáneas, anular contra editar, creación contra borrado de
grupo y vinculación de archivo contra borrado en Storage. Requieren una base
local nueva, descartable y exclusivamente de prueba:

```powershell
$env:TUKI_SMART_TEST_DATABASE_URL = 'postgresql://USUARIO:CLAVE@127.0.0.1:5432/tuki_phase45_test'
npx vitest run tests/smart-bill-concurrency.test.ts
Remove-Item Env:TUKI_SMART_TEST_DATABASE_URL
```

No admite conexiones remotas ni reinicia bases existentes. Si falta la variable,
se omiten; no se consideran aprobados. En este entorno no hay servidor PostgreSQL
local disponible para ejecutarlos. La cuota global serializa solo la reserva,
no mantiene bloqueos mientras espera al proveedor.

Límites pendientes: no hay OCR local ni garantía de exactitud de lectura, guardado
automático de borradores, limpieza programada de pendientes, antivirus ni
optimización para tickets extensos. PDFs protegidos o imágenes animadas se
rechazan. El hash detecta archivos idénticos, no fotos distintas del mismo ticket.
El importe final exige revisión humana; los límites del motor de Fase 4 siguen
vigentes. La actualización añadió `pdf-lib` y declaró `sharp` como dependencia
directa; no se cambiaron versiones de Next.js ni Supabase.
