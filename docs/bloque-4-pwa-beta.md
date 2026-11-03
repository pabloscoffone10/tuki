# Bloque 4 — PWA, móvil y preparación de beta

Fecha: 2026-11-03. **Implementado y probado localmente en los alcances indicados;
Tuki todavía no está declarada lista para beta.** Faltan concurrencia PostgreSQL,
restauración aislada, configuración remota y ensayos reales Android/iPhone.

## 1. Diagnóstico inicial

Ya existían autenticación Supabase SSR/PKCE, proxy de Next 16, guard servidor del
layout privado, cookies `SameSite=Lax` y `Secure` en producción, navegación inferior,
diálogos desplazables, pagos idempotentes recuperables, notificaciones internas y
exportaciones privadas. El proxy marca respuestas privadas `private, no-store`.
Las cookies SSR son accesibles al cliente Supabase cuando lo necesita: no se afirma
que sean HttpOnly. No se cambiaron esas reglas para compartir sesiones entre apps.

No había manifest, iconos PNG de instalación, worker ni fallback offline. Los
formularios no bloqueaban explícitamente los envíos cuando `navigator.onLine`
indicaba desconexión. También faltaba capturar rechazos de transporte en el cliente
antes de que una Server Action pudiera responder.

## 2. Implementación y configuración PWA

`app/manifest.ts` genera `/manifest.webmanifest`: Tuki/Tuki, descripción y idioma
es-UY, identidad `/`, inicio y alcance `/`, modo standalone y colores existentes.
Se rasterizó el SVG de marca existente mediante `sharp` ya instalado, sin crear
otra identidad: PNG 192/512, maskable 512 con margen seguro y Apple touch 180.
El layout declara manifest, metadatos Apple y viewport con safe areas y zoom permitido.

`PwaStatus` registra `/sw.js` exclusivamente en producción y contexto seguro,
con alcance `/` y `updateViaCache: 'none'`. En desarrollo no registra un worker.
Para probarlo localmente: `npm run build` y `npm run start`; para ensayos de
sesiones/instalación usar preferentemente staging HTTPS con configuración propia.

Configuración ofrece instalación voluntaria. El evento `beforeinstallprompt` se
captura globalmente y se retiene solo en memoria hasta visitar esa sección; el
prompt se invoca únicamente al tocar el botón. No se simula un prompt inexistente,
no se pide permiso de push y no se agregan recordatorios emergentes invasivos.

## 3. Android, iOS y escritorio

- En Chrome/Android y otros navegadores compatibles, el botón aparece cuando el
  navegador emite su evento de instalación. Sin evento, la interfaz indica usar
  el menú del navegador. El criterio concreto y la promoción dependen del navegador.
- En iPhone/iPad se indican Safari → Compartir → Agregar a pantalla de inicio.
  La ubicación exacta puede variar; abrir fuera de navegadores embebidos si hace falta.
- En escritorio se utiliza la instalación del navegador compatible. No se promete
  instalación en todos los navegadores ni se construyó una aplicación nativa.
- Una PWA instalada, Safari y otro navegador pueden tener sesiones diferentes.
  Volver a iniciar sesión es el camino correcto; no se copian tokens entre contextos.

Estas son capacidades de plataforma documentadas, **no resultados de pruebas
físicas de Tuki**. Referencias: [MDN instalación](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable),
[Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps).

## 4. Caché segura

El worker usa un único espacio propio versionado: `tuki-public-v1`. Su allowlist
incluye la pantalla estática pública offline, cuatro iconos y recursos del build
`/_next/static/` JS/CSS/fuentes con política explícita pública e immutable.
No se cachea una respuesta `private`, `no-store`, `no-cache`, opaca, redirigida o
con variación por Cookie/Authorization. Se comprueba tipo de contenido.

Los iconos no versionados se revalidan por red; si la red falla pueden usar su copia
pública. Los assets del build inmutables pueden usar caché primero. Esta estrategia
no se aplica a información financiera.

HTML privado va siempre a red y nunca se inserta en Cache Storage. Se excluyen
mutaciones, Authorization, RSC, precargas de App Router, acciones, Supabase,
callbacks OAuth, API, exportaciones, tickets y comprobantes. La navegación HTML
completa fallida puede mostrar la pantalla pública offline, incluso con filtros
ordinarios; una petición RSC nunca recibe HTML de fallback. Errores HTTP reales
no se ocultan como desconexión. No hay cola, sincronización en segundo plano ni
reenvío automático de una operación financiera.

La navegación principal desactiva precargas especulativas. No se intenta convertir
la caché transitoria de navegación de React/Next en almacenamiento offline.
Los documentos privados conservan sus headers propios. Cache Storage no guarda
cookies, respuestas de Auth ni datos financieros al cerrar sesión.

## 5. Actualizaciones

No se usa `skipWaiting`, mensajes de activación forzada ni recarga en
`controllerchange`. Una versión que espera muestra instrucciones: terminar o
recuperar operaciones y cerrar **todas** las pestañas y ventanas instaladas de Tuki.
Luego se abre la versión nueva. Esto evita interrumpir un formulario a la fuerza;
no garantiza que nadie conserve una pestaña antigua indefinidamente.

En una nueva publicación de assets/política del worker, incrementar `PUBLIC_CACHE`
en `public/sw.js` y verificar su instalación en staging. La activación borra solo
cachés antiguas con prefijo `tuki-public-`, sin borrar almacenamiento de otras apps.
El script se entrega con `no-cache, no-store, must-revalidate`. Mantener compatibilidad
de API/migraciones durante la coexistencia de ventanas antiguas; no introducir
cambios incompatibles suponiendo que un worker puede cerrar formularios ajenos.

## 6. Desconexión y recuperación

La ventana abierta muestra un aviso que aclara que sus importes pueden estar
desactualizados; el encabezado privado conserva el indicador «Sin conexión» al
desplazarse. Formularios generales, pagos rápidos/manuales, confirmaciones,
recuperación y escaneo bloquean envíos cuando el navegador detecta desconexión.
Se vuelve a comprobar justo antes de enviar; un submit sintético tampoco lo evita.
Los campos siguen editables y permanecen en memoria, sin persistir un borrador sensible.

Un error de transporte en `PaymentOperationForm` pasa a resultado desconocido y
consulta del intento original. No crea un ID nuevo ni afirma que el pago se guardó.
`ActionForm` captura errores de red y evita el reset automático del borrador en
errores. La recuperación ya existente en servidor conserva su idempotencia.
Los controles de navegación lanzados por Next se vuelven a propagar mediante su
API documentada `unstable_rethrow`: una redirección exitosa no se muestra como
un supuesto error de conexión. Hay una prueba de regresión específica.

Volver a conectarse no reenvía pagos ni dispara su confirmación. El usuario puede
tocar «Consultar datos actuales» o consultar el intento original. `navigator.onLine`
es solo una señal negativa útil: puede indicar conectado aunque Supabase no sea
alcanzable. Las respuestas/error reales del servidor siguen decidiendo el resultado.
Recargar, cerrar la app o un descarte del sistema puede perder un borrador en
memoria; no se promete persistencia. El servidor conserva los intentos de pago que
llegaron a prepararse; no todo intento iniciado en el navegador necesariamente llegó.

## 7. Mejoras móviles

Se conservan Inicio/Grupos/Pagos en la barra inferior, campana y menú de cuenta.
Configuración contiene la instalación opcional, sin duplicar la barra principal.
Viewport admite notch/gestos; se agrega espacio inferior al contenido y padding
superior del encabezado. Los campos móviles usan 16 px para reducir zoom involuntario
de Safari; no se desactiva pinch zoom. Campos/botones tienen margen de scroll.
Los controles de 44 px y diálogos con altura dinámica ya existentes se reutilizan.

No se introdujo una dependencia de gráficos ni una animación pesada. Hay que revisar
teclado virtual, safe areas, orientación, zoom y diálogos en dispositivos reales:
CSS y jsdom no certifican ausencia de solapamientos en todos los teléfonos.

## 8. Autenticación y enlaces

Se conserva email, Google OAuth, confirmación, recuperación de contraseña,
callbacks/token hash y PKCE con cookies de `@supabase/ssr`. Los recursos públicos
PWA se excluyen del proxy; ninguna ruta de datos privada gana esa excepción.
El inicio de la PWA `/` pasa por el mismo guard privado. Logout sigue invalidando
la sesión local en servidor y revalidando el layout; su botón requiere conexión.
Sin Internet no se afirma haber cerrado una sesión del servidor.

Pruebas pendientes en staging: login de navegador y app instalada por separado,
Google que abre otra ventana, confirmación de correo en otro contexto, expiración,
logout, volver atrás, reabrir desde icono y enlace de invitación. No se fuerza
compartir cookies ni se mueve un token al worker. `no-store` y el worker no son
garantía de borrar capturas del sistema operativo, memoria de otra pestaña o archivos
que alguien descargó; validar también historial del navegador y cierre de sesión real.

## 9. Notificaciones y push

Se mantienen campana, no leídos, estados de carga/error, enlaces permitidos y
actualización después de confirmar. La confirmación desde avisos ahora también
respeta desconexión y conserva el consentimiento mientras la ventana sigue abierta.

No se implementó Web Push. Android/navegadores compatibles necesitan HTTPS, worker,
permiso solicitado tras una acción y suscripciones. iOS/iPadOS admite Web Push en
apps añadidas a inicio desde 16.4, con permiso mediante interacción del usuario:
[WebKit](https://webkit.org/blog/13878/),
[Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

Una etapa futura requiere claves VAPID en servidor, tabla privada de suscripciones
por cuenta/dispositivo, endpoint autenticado, consentimiento/revocación, dispatcher,
caducidad, cuotas y limpieza de endpoints. Usar texto genérico fuera de Tuki, sin
importe/nombre financiero por defecto. No exige necesariamente un proveedor pago,
pero tiene costos de cómputo, almacenamiento, tráfico y operación que dependen del
volumen. No se solicitaron permisos ni se agregó infraestructura para esto.

## 10. Seguridad y dependencias

No se cambió RLS, SECURITY DEFINER, GRANT/REVOKE, Storage, cálculos ni migraciones
001–013. No hay SQL nuevo. Los tests previos siguen cubriendo permisos por grupo,
retirados, IDs manipulados, exportación/comprobante ajeno, confirmación indebida,
duplicación de pagos y recuperación ajena; son evidencia local, no del despliegue.

Se agregan `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` y
Permissions-Policy para capacidades no usadas. La pantalla pública offline tiene
CSP restrictiva sin scripts. No se impuso una CSP global incompatible con los scripts
de Next; una política con nonces requiere validación específica. Las Server Actions
conservan la comprobación de origen de Next y Zod. No se agregaron logs de datos privados.
Los límites de Auth deben verificarse en Supabase; los de recordatorios/escaneo
ya existentes no equivalen a un firewall distribuido para toda la aplicación.

Auditoría npm ejecutada: **0 avisos de producción**; auditoría completa:
**16 entradas moderadas de tooling**, 0 altas/críticas. No se aplicó un `audit fix`
que propusiera cambiar versiones mayores incompatibles. Ver evidencia y remediación
pendiente en [operaciones del Bloque 4](bloque-4-operaciones.md).

## 11. Rendimiento

Sin dependencias nuevas. Iconos derivados pequeños, gráficos existentes de servidor,
paginación del Bloque 3 intacta y worker limitado a recursos públicos. No se incorporó
prefetch de datos privados para acelerar la PWA ni se alteró el bloqueo financiero.
No se obtuvieron puntuaciones Lighthouse, mediciones de bundle antes/después ni
latencias móviles reales; no se atribuyen mejoras porcentuales.

## 12. PostgreSQL y recuperación operativa

`node scripts/run-concurrency.mjs --check` devolvió salida 2: Docker Compose no
disponible. Tampoco hay instalación local PostgreSQL/psql/pg_ctl en las ubicaciones
revisadas. Las **40 pruebas reales permanecen omitidas**, nunca se cuentan como
aprobadas. No se conectó el harness a Supabase ni a datos de producción.

Los comandos reproducibles y las siete suites están documentados en
[bloque-4-operaciones.md](bloque-4-operaciones.md), reutilizando el runner local
existente. No instalar infraestructura ni ejecutar nada contra producción por copiar
una URL en las variables del harness.

Backups: base y **bytes de Storage son copias diferentes**. Usar respaldo cifrado,
manifiesto de objetos con tamaños/hashes, acceso mínimo y retención propuesta. La
guía operativa detalla restauración en proyecto aislado y conciliación financiera,
incluida detección de referencias/archivos ausentes. No se respaldó información real
ni se probó una restauración. No se declara RTO/RPO alcanzado sin ese ensayo.

## 13. Vercel y entornos

- Local, preview/staging y producción deben usar proyectos Supabase y credenciales
  correspondientes. No usar secretos ni datos productivos en tests automáticos.
- Configurar por entorno `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `TUKI_SITE_URL` (origen HTTPS exacto).
  Nunca colocar service-role, secretos cron o IA bajo `NEXT_PUBLIC_`.
- Escaneo y cron siguen opcionales/deshabilitados hasta configurar sus variables
  de servidor. No se necesitan variables nuevas para PWA.
- En Supabase configurar Site URL/Redirect URLs del entorno y los callbacks de
  Google Cloud/Supabase según la guía de autenticación existente. No mezclar callbacks
  de preview con producción ni autorizar comodines amplios sin revisar su alcance.
- Publicar mediante el flujo autorizado de Vercel después de los gates. Comprobar
  HTTPS, manifest/worker, no redirección del worker a login, tipos MIME y headers.
  En staging inspeccionar Cache Storage después de login/logout y uso de reportes:
  solo recursos públicos permitidos. No usar reglas CDN que cacheen HTML autenticado.
- Despliegue nuevo: incrementar versión de caché cuando corresponda, probar ventana
  antigua/worker en espera y coordinar cierre voluntario de ventanas. Migraciones
  existentes se revisan/aplican aparte; este bloque no necesita ninguna nueva.

No se ejecutó un despliegue ni se cambiaron dominios/configuraciones remotas.

## 14. Archivos

Nuevos: `app/manifest.ts`; `public/sw.js`, `public/offline.html`,
`public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png`;
`components/pwa/{connectivity.ts,install-events.ts,install-control.tsx,pwa-status.tsx}`;
`tests/{pwa-worker.test.ts,pwa-client.test.tsx,pwa-config.test.ts}`;
este informe y `docs/bloque-4-operaciones.md`.

Modificados: `app/layout.tsx`, `app/globals.css`, `next.config.ts`, `proxy.ts`,
`components/layout/app-shell.tsx`, `app/(private)/configuracion/page.tsx`,
`features/auth/components/sign-out-button.tsx`,
`features/groups/components/action-form.tsx`,
`features/payments/components/{operation-recovery.tsx,quick-debt-actions.tsx}`,
`features/notifications/payment-actions.tsx`,
`features/smart-bills/components/smart-bill-form.tsx`, `README.md`.

No se instalaron paquetes, no se modificó el lockfile y **no hay migración 014**.

## 15. Evidencia y checklist de beta privada

«Automático» significa pruebas locales; no equivale a validación real con Supabase,
un navegador instalado o un dispositivo físico. Completar fecha, responsable y
resultado de staging antes de cambiar los estados pendientes.

| Elemento | Estado / cómo se verificó | Resultado local | Riesgo pendiente |
| --- | --- | --- | --- |
| Registro/login y confirmación | Automático, suites Auth existentes | Incluidas en suite | Proveedor y emails remotos |
| Google OAuth | Código y validaciones locales | Flujo conservado | Ensayo navegador/app instalada |
| Crear grupo | Automático SQL/acciones/UI | Incluido | Recorrido staging |
| Agregar invitados | Automático identidad/permisos | Incluido | Personas reales/homónimos |
| Gasto simple | Automático dominio/SQL/formulario | Incluido | Uso físico y teclado |
| Cuenta inteligente | Automático dominio/UI/SQL | Incluido | Captura real/red/IA opcional |
| Multimoneda | Automático exactitud/reportes | Incluido | Cotización correcta del usuario |
| Registrar pago | Automático idempotencia/SQL/UI | Incluido | Concurrencia real |
| Confirmar/revertir | Automático permisos/SQL/UI | Incluido | Staging dos cuentas |
| Recuperar operación | Automático protocolo/errores | Incluido | Cortar red en dispositivo |
| Estadísticas/filtros | Automático origen/período/páginas | Incluido | Rendimiento volumen real |
| CSV/PDF | Automático generación/privacidad | Incluido | Visores/descarga instalada |
| Notificaciones internas | Automático componentes/SQL | Incluido | Sesiones y avisos reales |
| Manifest/iconos/headers | Automático + HTTP build local | Recursos públicos 200 | Instalabilidad real |
| Worker/caché | VM ejecuta handlers con Cache API simulada | Exclusiones/fallback/update | Cache API del navegador real |
| Instalación voluntaria | jsdom eventos simulados | Sin prompt automático | Chrome/Safari reales |
| Android instalado | Pendiente físico | No probado | Navegación/login/red/actualización |
| iPhone instalado | Pendiente físico | No probado | Aislamiento de sesión/teclado |
| Reconexión y borrador | Automático UI | Sin reenvío, conserva memoria | Descarte del sistema operativo |
| Privacidad entre grupos | Automático SQL + guards | Incluida | Staging con cuentas distintas |
| Logout instalado/offline | Guard de conexión y código revisado | Offline no finge logout | Volver atrás/cerrar/reabrir real |
| Concurrencia PostgreSQL | Infraestructura ausente | 40 omitidas | Gate crítico sin aprobar |
| Backup DB + Storage | Procedimiento | No ejecutado | Copias cifradas verificadas |
| Restauración/conciliación | Herramientas + fixtures | Sin ensayo de restore | Gate crítico sin aprobar |

## 16. Validación final y recomendación

Validación final: lint, typecheck y build correctos; **470 pruebas aprobadas,
0 fallidas y 40 omitidas**, en 71 archivos aprobados y 7 omitidos. Las 40 omitidas
siguen requiriendo PostgreSQL real. El test de tema conserva una advertencia de
React sobre una etiqueta script en jsdom, sin fallo. Se ejecutaron pruebas VM del worker, pruebas jsdom de instalación,
desconexión, actualización, borrador y resultado desconocido, y validación de PNG.
La prueba HTTP del build local obtuvo 200 para manifest, worker, fallback y cuatro
iconos con MIME y caché esperados; `/grupos` anónimo devolvió 307 a login con
`private, no-store`. Esto no ejecuta un navegador ni certifica una instalación.

No se hizo Lighthouse ni prueba responsive en motor de navegador/telefono físico.
Faltan remediación compatible del tooling, concurrencia PostgreSQL, restore aislado,
permisos del despliegue y recorridos Android/iOS. **No abrir beta hasta verificar
esos controles críticos.** El próximo trabajo dentro de este alcance es ejecutar
la checklist en staging y registrar evidencias, no agregar pagos offline ni nuevas
funcionalidades financieras.
