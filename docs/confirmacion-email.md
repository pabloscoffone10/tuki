# Confirmación de email y sesión de Tuki

Verificar el correo y abrir una sesión son pasos diferentes. Con el enlace
estándar, Supabase puede verificar el correo antes de que Tuki intercambie el
código PKCE. Si falla ese intercambio, la cuenta sigue verificada: podés entrar
con email y contraseña sin volver a crearla.

## Problemas encontrados y cambios

- El callback anterior solo aceptaba `code`. No admitía los enlaces con
  `token_hash` de las plantillas SSR de Supabase. Ahora `/auth/confirm` y
  `/auth/callback` aceptan esa verificación con `verifyOtp` para `email`, `signup`
  y `recovery`; otros tipos se rechazan. No se implementan invitaciones.
- El SDK instalado admite `sb_flow_id` opcional para los flujos PKCE. El callback
  anterior lo ignoraba. Ahora lo valida y lo pasa a `exchangeCodeForSession`
  cuando viene presente. Su agregado automático es una opción experimental,
  desactivada por defecto; no se activó para este cambio. Se conserva el flujo
  habitual sin ese parámetro y no se atribuye el fallo reportado a su ausencia.
- El cliente de Route Handlers escribe las cookies y sus fragmentos directamente
  en la respuesta de redirección. Conserva eliminaciones y atributos, con
  `Cache-Control: private, no-store` y `Referrer-Policy: no-referrer`.
- El proxy deja que los endpoints de confirmación hagan el intercambio sin
  renovar primero una sesión anterior. Las rutas privadas siguen verificadas.
- Ya no se trata un resultado sin sesión como acceso exitoso. Los errores
  distinguen enlace incompleto, formato inválido, PKCE ausente y enlace vencido.
  En producción se muestran solo explicaciones predefinidas, nunca tokens o
  textos arbitrarios recibidos del proveedor.

Los logs locales disponibles no permitieron identificar qué parámetro o cookie
faltó en el enlace real reportado. Las incompatibilidades anteriores sí se
comprobaron en el código y se cubren con pruebas. No se modificó la configuración
remota ni se consumió un enlace real de confirmación para investigar.

## Plantillas recomendadas en Supabase

En Authentication → Email Templates, guardá los siguientes enlaces. Conservá el
diseño del correo si ya lo personalizaste: basta reemplazar el destino del enlace.
Esta variante sigue el patrón SSR de la guía oficial y permite verificar el
correo y emitir las cookies de sesión desde Tuki sin depender de una cookie
PKCE anterior en el navegador que abre el correo.

**Confirm signup**:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Confirmar mi email en Tuki</a>
```

**Reset password**:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Cambiar mi contraseña en Tuki</a>
```

El tipo `recovery` siempre conduce a `/actualizar-contrasena`. El token es de un
solo uso y Supabase lo verifica antes de crear una sesión. No se acepta un email
o un estado de verificación declarado por el navegador. No copiar tokens en
logs, capturas, chats ni URLs de ejemplo con valores reales.

Estos cambios afectan correos nuevos; los enlaces ya enviados no cambian. No
desactives Confirm email ni RLS. Si el correo ya está verificado, probá login
directamente. Para probar la nueva plantilla usá otro registro de prueba propio
o un nuevo correo de recuperación.

## Site URL y Redirect URLs

En Authentication → URL Configuration:

1. **Site URL** debe ser el origen real donde corre Tuki, sin ruta final:
   `http://localhost:3000` en desarrollo o tu dominio HTTPS en producción.
2. Debe coincidir con `TUKI_SITE_URL`. No alternes entre `localhost` y `127.0.0.1`
   ni entre puertos: las cookies pertenecen al origen donde se inició el flujo.
3. Permití estos retornos para desarrollo:

```text
http://localhost:3000/auth/callback**
http://localhost:3000/auth/confirm**
```

En producción agregá las equivalentes con el dominio HTTPS concreto de Tuki.
El patrón queda limitado a esos endpoints; no hace falta permitir otros dominios
ni todos los caminos de la aplicación. El callback aplica además su propia lista
de destinos internos permitidos. El sufijo admite los parámetros de retorno,
incluido `sb_flow_id` si un iniciador del flujo lo agrega. Para retornos sin ese
parámetro también se pueden conservar las URLs exactas usadas por la aplicación.

## Compatibilidad con la plantilla anterior

También se conserva soporte para:

```html
<a href="{{ .ConfirmationURL }}">Confirmar mi email</a>
```

En ese flujo, Supabase confirma primero y vuelve a `/auth/callback?code=...`.
El navegador necesita las cookies PKCE creadas durante el registro y el retorno
debe conservar `sb_flow_id` si está presente. Abrí el enlace en el mismo navegador
y origen. No edites ni reconstruyas manualmente la URL generada por Supabase.
Si Redirect URLs rechaza el destino, el servicio puede usar Site URL y el código
no llegará al callback esperado. Si se recibe un fragmento `#access_token`, es
un enlace de flujo implícito: el servidor no recibe fragmentos de URL. Usá la
plantilla SSR recomendada para correos nuevos, en lugar de copiar ese token.

No mezcles un enlace a `{{ .ConfirmationURL }}` (que ya consume el token) con un
segundo `verifyOtp` del mismo token. Los dos formatos se procesan por separado.
Los enlaces que contienen credenciales de ambos formatos se rechazan.

## Prueba manual

1. Reiniciá `npm run dev` después de guardar las plantillas y URLs.
2. Para tu cuenta ya verificada, probá login con email y contraseña.
3. Con un registro nuevo propio, verificá que el correo nuevo apunte a
   `/auth/confirm` con los nombres `token_hash` y `type`, sin compartir sus valores.
4. Abrí el enlace. Debe redirigir al resumen con cookies de sesión y permitir
   recargar o visitar `/configuracion` sin volver a pedir acceso.
5. Reutilizar el enlace debe dar un error seguro; no debe cambiar el estado de
   verificación de la cuenta ni conceder una nueva sesión.
6. Probá recuperación: el enlace debe abrir el formulario de nueva contraseña.
7. Si conservás ConfirmationURL, probá en el mismo navegador con `sb_flow_id` y,
   por separado, sin sus cookies: el segundo caso debe explicar la falta de PKCE.

No se ejecutan SQL, cambios de RLS o cambios de confirmación para estos pasos.

Referencias oficiales:
- [Guía Next.js y verifyOtp](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)
- [Plantillas de email](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
