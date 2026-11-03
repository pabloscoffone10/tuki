# Beta privada — pruebas manuales y evidencias

Estas pruebas están **NOT RUN** hasta que el operador registre su ejecución. No
se usan resultados de jsdom, PGlite ni emulación para marcar un teléfono probado.
Usar staging autorizado y cuentas/datos de ensayo; nunca producción como entorno
destructivo. Ejecutar después de revisar/aplicar manualmente las migraciones nuevas
indicadas en el informe del Bloque 5 y desplegar con autorización independiente.

## Registro por caso

Guardar en un lugar privado: fecha/hora, responsable, URL/entorno, versión del
despliegue, migración vigente, dispositivo/SO/navegador, estado PASS/FAIL/BLOCKED/NOT RUN,
pasos, resultado observado, IDs de ensayo necesarios y riesgo. No adjuntar contraseñas,
tokens, cookies, tickets de personas reales ni backups. Un fallo se registra aunque
el siguiente intento funcione. Las capturas deben usar datos ficticios.

## Precondiciones

- Staging HTTPS con Supabase separado, SMTP/OAuth configurados para ese entorno,
  cron e integraciones externas desactivados si no están en prueba.
- Dos cuentas verificadas como mínimo y una tercera cuenta sin acceso; para pagos
  del escenario A conviene cuatro cuentas. Invitados para escenario E.
- Un grupo vacío por escenario y confirmación de UYU como única moneda para altas.
- Acceso del propietario al diagnóstico de conciliación y a un entorno de restore
  aislado; no ejecutar SQL remoto sin la autorización correspondiente.

## A — Pádel: gasto, consumo y liquidaciones diferentes

1. Crear «Pádel beta» con Pablo, Mati, Guille y Facu; seleccionar identidades
   explícitamente, sin duplicarlas por nombre.
2. Pablo adelanta **$ 1.000,00 UYU**, reparto igual entre las cuatro personas.
   Cada consumo es **$ 250,00**. Pablo no se debe dinero a sí mismo.
3. Mati registra $ 250,00 hacia Pablo; Pablo confirma recepción.
4. Guille registra $ 100,00 hacia Pablo; Pablo confirma recepción.
5. Facu registra $ 250,00 hacia Pablo; Pablo **rechaza** con motivo válido. No se
   reduce deuda por haber registrado ni rechazado una solicitud.
6. Comprobar historial, avisos habilitados y estadísticas:

| Persona | Adelantó | Consumió | Liquidó confirmado | Recibió liquidaciones | Balance del conjunto |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pablo | 1.000,00 | 250,00 | 0,00 | 350,00 | +400,00 |
| Mati | 0,00 | 250,00 | 250,00 | 0,00 | 0,00 |
| Guille | 0,00 | 250,00 | 100,00 | 0,00 | −150,00 |
| Facu | 0,00 | 250,00 | 0,00 | 0,00 | −250,00 |

Gastos originales: **1.000,00**, liquidado: **350,00**, pendiente bruto: **400,00**,
solicitudes pendientes después de completar los pasos: **0**. No sumar 350 al
gasto original. Los avisos dependen de preferencias/entrega: validar contenido y
estado, no exigir un número inventado de notificaciones.

**Negativos:** Mati no puede confirmar su propio pago a Pablo como receptor;
cuenta ajena no ve el grupo ni puede exportarlo; la confirmación duplicada con el
mismo ID no duplica asignaciones. No cambiar claves para simular un reintento.

## B — Restaurante: ocho consumidores y productos

Crear ocho personas, un pagador y una Cuenta inteligente manual UYU:

- Ocho productos individuales de **120,00**, uno por persona: subtotal 960,00.
- Pizza compartida **640,00** entre los ocho: 80,00 por persona.
- Ocho bebidas individuales de **45,00**, una por persona: subtotal 360,00.
- Subtotal de productos: **1.960,00**, consumo base individual 245,00.
- Descuento general fijo **160,00**, proporcional a esos consumos: 20,00 por persona.
- Propina **10 % agregada después** del descuento: 180,00, proporcional.
- Total: **1.980,00 UYU**, consumo individual final **247,50**.

Asignar todos los productos/cargos explícitamente y revisar antes de guardar.
Comprobar resumen individual, productos plegables, copia de producto, edición de
consumidores y que cambiar un importe invalida la revisión anterior. No importar
un ticket con IA salvo prueba autorizada de ese proveedor/costo; la carga manual
alcanza para este escenario.

Con pagador incluido en las ocho partes: sus obligaciones a terceros suman
**1.732,50**; consumo propio **247,50**. CSV y PDF deben mostrar total original
1.980,00, consumidores correctos y ninguna liquidación inventada. Si el orden del
descuento/propina cambia, cambia el resultado: conservar el orden indicado.

## C — Grupos compartidos y privacidad de origen

1. Pablo y Mati en «Juana beta» y «Piria beta»; Facu solo en Piria.
2. Juana: Pablo paga **100,00**, dividido solo entre Pablo/Mati: Mati debe 50,00.
3. Piria: Pablo paga **600,00**, dividido entre Pablo/Mati/Facu: cada uno consume
   200,00; Mati y Facu deben 200,00 a Pablo.
4. El par Pablo/Mati puede verse en ambos grupos compartidos, con origen y sin
   duplicarse: neto global de ese par **250,00** antes de pagos.
5. Gastos originales de Juana: **100,00**; de Piria: **600,00**. No mezclar 600 en
   estadísticas/exportación de Juana por existir proyección.
6. Con un cuarto usuario que solo pertenece a Juana, intentar abrir por URL gastos,
   estadísticas, exportación y comprobantes de Piria: denegado en servidor/PostgreSQL.
   Facu no obtiene acceso a Juana por participar con Pablo en Piria.
7. Retirar un miembro y volver a consultar: no ampliar su lectura privada. Archivar
   conserva lectura de miembros activos y bloquea modificaciones previstas.

No marcar privacidad PASS solo porque desaparece un botón: probar URLs directas
y llamadas autorizadas con la sesión del usuario de ensayo. No efectuar intrusión
contra proyectos o cuentas de terceros.

## D — Pérdida de respuesta y recuperación

1. Preparar una deuda UYU y anotar el ID del intento de pago de ensayo.
2. Desde DevTools/proxy local autorizado, cortar la respuesta después de enviar,
   sin asumir de antemano si la transacción llegó a confirmar. Un corte antes del
   envío y uno después de commit son casos diferentes; ejecutar ambos.
3. La interfaz debe indicar resultado desconocido o error, nunca confirmación ficticia.
   Cerrar/reabrir o recargar, reconectar y **consultar el intento original**.
4. Si quedó preparado, enviarlo solo tras confirmar explícitamente ese mismo intento.
   Si quedó procesado/rechazado, reconocer su resultado antes de iniciar otro pago.
5. Verificar un pago y asignación únicos por ese ID, eventos coherentes y saldo
   correcto. Dos pagos genuinos de igual importe con IDs distintos son válidos si
   el saldo y las confirmaciones lo permiten: no confundirlos con un reintento.
6. Repetir sin conexión antes de tocar enviar: botón bloqueado y campos conservados
   en memoria. Reconectar no debe enviar ni confirmar nada automáticamente.

La prueba de concurrencia automatizada con commit y conexiones distintas es
complementaria; no llamar a un corte visual de DevTools «commit verificado» sin
consultar la operación/ledger del entorno de ensayo.

## E — Invitados y autoridad administrativa

1. Agregar un invitado nuevo; buscar uno existente y reutilizar su identidad en
   otro grupo. Un homónimo debe requerir decisión explícita, no una fusión automática.
2. Crear deuda con invitado y registrar pago administrativo del grupo de origen,
   con texto adicional vacío y luego breve. Deben conservarse actor, fecha,
   importe, modo administrativo y constancia de auditoría.
3. Otro miembro sin rol y un admin de otro grupo no pueden confirmar ese pago.
4. Entre dos cuentas registradas, un administrador tercero no reemplaza la recepción
   de la contraparte. Rechazar/anular conserva el motivo obligatorio.
5. No editar, reclamar ni fusionar cuentas registradas mediante acciones de invitados.
6. Verificar protección del último administrador y de identidades con referencias.

## F — Beta UYU y compatibilidad histórica

- Alta de gasto y Cuenta inteligente: UYU predeterminado, sin selector FX/tasa.
- Entrar **1.250,50** y comprobar 125.050 centésimos exactos y visualización local.
- Repartir **10,01** entre tres personas: dos partes 3,34 y una 3,33. El desempate
  depende de IDs estables; no asumir qué nombre recibe el centésimo. Suma **10,01**.
- Intentar alta con USD/ARS o tasa distinta manipulando solicitud: rechazo en
  validación servidor y RPC PostgreSQL después de aplicar la nueva política.
- Intentar pago nuevo declarando moneda ajena: rechazo; los pagos de Tuki son UYU.
- Estadísticas/CSV/PDF nuevos deben conservar esos centésimos sin sumar pagos a gastos.
- Si ya existen datos históricos de otra moneda, elegir un registro autorizado y
  comprobar original, tasa fijada, total UYU explícito y versión. No reescribirlo,
  convertirlo otra vez ni crear una nueva operación USD para «probar compatibilidad».
  Si no existe fixture histórico autorizado, marcar esa prueba manual NOT RUN;
  usar la regresión automatizada que prepara el histórico **antes** de la restricción.
- Edición/reintento histórico debe seguir exactamente la política documentada para
  014: sin aprovechar un ID antiguo para introducir un gasto FX nuevo. No inventar
  esta aprobación sin comprobar las reglas/errores de la migración aplicada.

## Dispositivos y sesiones — repetir por plataforma

| Recorrido | Android Chrome | iPhone Safari/PWA | Escritorio Chrome/Edge |
| --- | --- | --- | --- |
| HTTPS, icono, instalación voluntaria y standalone | NOT RUN | NOT RUN | NOT RUN |
| Email/confirmación/recuperación de contraseña | NOT RUN | NOT RUN | NOT RUN |
| Google OAuth y retorno al contexto correcto | NOT RUN | NOT RUN | NOT RUN |
| Enlace de invitación y login si corresponde | NOT RUN | NOT RUN | NOT RUN |
| Escenarios A–F y descargas privadas | NOT RUN | NOT RUN | NOT RUN |
| Notch/gestos, teclado, orientación, zoom/lector | NOT RUN | NOT RUN | NOT RUN |
| Desconexión, reconexión e intento desconocido | NOT RUN | NOT RUN | NOT RUN |
| Worker en espera, cierre de todas las ventanas, nueva versión | NOT RUN | NOT RUN | NOT RUN |
| Logout, atrás, reabrir icono y URL privada | NOT RUN | NOT RUN | NOT RUN |

No exigir que Safari y la PWA compartan sesión; iniciar sesión separadamente si lo
solicita. No mover tokens entre contextos. Inspeccionar Cache Storage: solo fallback,
iconos y estáticos públicos permitidos; nunca RSC, Auth, datos, recibos, exportaciones
o respuestas de acciones. Tras logout, revisar historial y reabrir contra el servidor.
Capturas recientes del sistema operativo y archivos descargados son otro alcance.

## Cierre de aceptación

Registrar resultados separados para código, pruebas locales, PostgreSQL real,
staging remoto y dispositivos físicos. Los 40 casos de concurrencia, una restauración
aislada con DB + bytes Storage y la conciliación del destino deben tener evidencia
propia. Una checklist sin ejecutar sigue **NOT RUN**. Un control crítico BLOCKED,
NOT RUN o FAIL mantiene la decisión **NO-GO**.
