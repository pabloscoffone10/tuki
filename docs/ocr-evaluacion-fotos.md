# Evaluación OCR local con fotografías — 2026-11-04

Tesseract.js 7, spa+eng, `SINGLE_COLUMN`, `rotateAuto`, texto y geometría reales. Comparación antes/después del parser usando exactamente la misma salida del motor, sin Gemini. Se inspeccionaron visualmente las cinco imágenes y se compararon con README. No se corrigieron caracteres ilegibles usando los valores esperados.

| Foto | Antes: filas / suma | Después: filas / suma | Total OCR después | Esperado visual |
|---|---|---|---|---|
| Guaviare | 7 / 1360 | 5 / 1190 | No reconocido | UYU 1190 |
| Cafetería | 2 / 2180, filas incorrectas | 4 / 2180 | No reconocido | 2180, moneda desconocida |
| Piriápolis | 8 / 10960 | 6 / 5320 | 320, incorrecto; advertencia por diferencia 5000 | UYU 5320 |
| Bacar | 5 / 2116 | 3 / 1525 | 1525 | UYU 1525 |
| Es Pins | 8 / 971370601.20, incluye teléfono | 7 / 60.20 | No reconocido | EUR 72.70 |

Que la suma coincida no demuestra que nombres o cantidades sean correctos.

- Guaviare: cantidades/precios recuperados en cubiertos (2×60) y P. natural (1×110). Vacío, riñón y limonada conservan importes 420/220/320 pero faltan cantidades/precios o nombres legibles.
- Cafetería: recuperadas las cuatro filas completas, cantidades 1/1/1/2, unitarios 180/250/250/750 e importes 180/250/250/1500. No asumir UYU. Subtotal 1786.89 + IVA 393.11 ya están en los productos: no sumar IVA ni comparar el neto como subtotal bruto.
- Piriápolis: recuperados cubierto 6×70, napolitana 3×680, a caballo 3×520 y refresco 2×300. Las líneas de 450 y 250 no imprimen cantidad/unitario: permanecen desconocidos en extracción; el borrador permite corregir su cantidad. No se sustituyó el total OCR erróneo por la suma ni por el pago con tarjeta. La moneda tampoco aparece inequívocamente en el texto OCR.
- Bacar: tres importes correctos. En la primera pasada solo sobrevive el detalle 1×587; faltan 2×134 y 1×670. La alternativa ampliada recupera 2×134, pero también introduce errores; no se usa como verdad.
- Es Pins: referencia fuera del alcance Uruguay. Se elimina el NIF/teléfono como producto. Quedan precios mal reconocidos, un producto perdido y total/moneda sin reconocer.

## Cambios

Parser: columnas cantidad/precio/importe/nombre; detalle uruguayo `cantidad UN X precio` unido a la fila previa; total en `16 Artículos TOTAL`; espacios antes del separador decimal; ruido antes de etiquetas IVA/subtotal; exclusión de encabezados anteriores a MONEDA y datos fiscales; distinción subtotal neto/IVA incluido.

Editor: filas agrupadas con cantidad editable e importe total, sin cambiar cantidad a 1 al editar el precio; chips inicialmente vacíos y reparto igualitario. Servicio importado como producto. Propinas visibles junto a productos con los mismos chips, conservando internamente el cargo para distinguir propina incluida de la agregada después. Diferencias visibles antes de asignar consumidores; edición disponible y sin ajustes inventados. Se mantiene la validación financiera al guardar.

## Reproducción y pruebas

- `npm test`: suite normal, incluye regresiones de parser, importación, editor y proveedor simulado.
- PowerShell: `$env:TUKI_RECEIPT_OCR='1'; npx vitest run tests/smart-bill-photo-ocr.test.ts` ejecuta las cinco fotografías originales con Tesseract real. Requiere los modelos públicos gratuitos spa/eng, cacheados en `tmp/receipt-eval`. Escribe `tmp/receipt-eval/live-report.json`. No envía fotos ni llama proveedores pagos. La prueba verifica ejecución y seguridad básica; el informe registra diferencias, no afirma exactitud completa.
- `tests/fixtures/receipts/ocr-captures.json`: fragmentos de salidas reales con geometría/confianza, sin identificadores fiscales, fechas ni contactos; regresión determinista separada de las transcripciones visuales esperadas.
- `npm run typecheck` y ESLint sobre archivos modificados.

## Límites

La ejecución real usa Tesseract en Node sobre las fotos originales. También se exploraron ampliación/contraste y segmentaciones alternativas; no se cambiaron los filtros Canvas ni el ranking del navegador porque las alternativas introdujeron regresiones. No es una prueba visual integral del navegador. Sus filtros, límites de tamaño y elección de variantes pueden producir otra lectura. Los tests existentes del flujo de navegador usan mocks; Gemini se verifica con respuestas simuladas, sin llamadas reales. Los OCR parciales requieren corrección manual y confirmación de moneda. Las fotografías originales siguen sujetas a la revisión de privacidad/licencias indicada en README; no se publicaron.
