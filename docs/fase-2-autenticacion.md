# Tuki — Fase 2: autenticación

## Alcance implementado

- `/registro`: nombre, email, contraseña y confirmación; validación Zod en servidor.
- `/login`: email/contraseña, enlace de recuperación y Google OAuth.
- `/recuperar-contrasena`: solicitud de enlace, con respuesta que no confirma si existe la cuenta.
- `/auth/callback`: intercambia un código de un solo uso por sesión con PKCE.
- `/actualizar-contrasena`: formulario privado que verifica al usuario antes de actualizar la contraseña.
- Cierre de la sesión de este navegador desde el icono de salida del encabezado.
- `/configuracion`: email verificado por Auth, nombre del perfil y cambio de contraseña.
- Dashboard y secciones privadas protegidas desde servidor. No hay grupos ni invitados implementados.

## Variables locales

El archivo `.env.local` existente no fue leído ni modificado durante esta implementación.
Next.js lo carga normalmente para ejecutar y compilar. No copies sus valores al chat.

Conservá las dos variables públicas de Supabase ya configuradas y agregá, si falta:

```dotenv
TUKI_SITE_URL=http://localhost:3000
```

En producción usá el origen HTTPS de la aplicación, sin rutas ni parámetros.
Es obligatorio para crear enlaces seguros; no se confía en encabezados Host u Origin
para elegir el destino de un correo. Si el servidor usa otro puerto, actualizá esta
variable y las URLs permitidas en Supabase. Reiniciá Next.js al cambiar variables.
La clave usada por la app es exclusivamente la publishable key, nunca service_role
ni claves secretas. Google Client Secret se carga únicamente en Supabase.

## Configurar email y URLs en Supabase

1. Abrí el proyecto correcto en Supabase Dashboard.
2. En Authentication → Sign In / Providers → Email, habilitá email/contraseña,
   permití nuevos registros y **activá Confirm email**. Configurá longitud mínima
   de contraseña de 10 caracteres (la app exige entre 10 y 128). Si configurás reglas
   adicionales, Supabase las aplicará y la interfaz mostrará un error seguro.
3. En Authentication → URL Configuration, usá `http://localhost:3000` como Site URL
   para desarrollo. Para producción, cambiá Site URL al mismo origen de `TUKI_SITE_URL`.
4. Agregá estas Redirect URLs para desarrollo (y sus equivalentes HTTPS en producción):

```text
http://localhost:3000/auth/callback
http://localhost:3000/auth/callback?next=/actualizar-contrasena
http://localhost:3000/auth/callback?next=%2Fconfiguracion
http://localhost:3000/auth/callback?next=%2F
```

Para las pruebas locales también podés permitir `http://localhost:3000/auth/callback**`.
En producción preferí los destinos exactos anteriores; las pantallas de acceso
solo generan retorno al resumen, configuración o las secciones privadas conocidas.
Si agregás otros destinos de Google en el futuro, agregá sus callbacks exactos.

5. En Authentication → Email Templates, se recomienda el formato SSR de token
   hash, ahora soportado en `/auth/confirm`. **Confirm signup**:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Confirmar mi email en Tuki</a>
```

Para **Reset password** usá el mismo destino con `type=recovery`. El servidor
verifica el hash de un solo uso con Supabase y guarda la sesión en cookies.
También se admite `{{ .ConfirmationURL }}` con el callback PKCE original; ese
formato sí necesita las cookies del navegador y origen donde se inició el flujo.
No pegues tokens manualmente ni mezcles ambos métodos para el mismo token.
Agregá `/auth/confirm` a las URLs de la instalación. Las plantillas, patrones de
retorno y pruebas están detallados en [confirmación de email](confirmacion-email.md).
Si tu cuenta ya quedó verificada, podés iniciar sesión con email y contraseña.

6. Configurá Custom SMTP para probar con destinatarios reales. El envío integrado
   tiene restricciones de destinatarios y límites; no reemplaza un SMTP propio.
   Verificá remitente, dominio, spam y los límites de Auth si no llega un correo.

La confirmación de email es una política del proyecto Supabase, no una simulación
de UI. Si se desactiva, Supabase confirma automáticamente las nuevas cuentas.
El registro de Tuki evita dejar una sesión automática en ese caso, pero eso no
sustituye mantener **Confirm email** activado en el servicio.

## Configurar Google Cloud y Supabase

1. En Google Cloud Console creá o seleccioná un proyecto.
2. Configurá Google Auth Platform (o APIs & Services → OAuth consent screen): nombre
   Tuki, email de soporte, audiencia y dominios autorizados de la aplicación.
   Mientras esté en modo Testing, agregá las cuentas de Google que probarán el acceso.
3. Creá un OAuth Client ID de tipo **Web application**.
4. En Authorized JavaScript origins agregá `http://localhost:3000` y, cuando exista,
   el origen HTTPS de Tuki.
5. En Supabase, abrí Authentication → Sign In / Providers → Google. Copiá su
   **Callback URL**, normalmente `https://<project-ref>.supabase.co/auth/v1/callback`.
   Agregala exactamente a **Authorized redirect URIs** del cliente de Google.
   Si usás un dominio personalizado de Supabase, copiá la URL que muestre el panel.
   No confundas este callback de Supabase con `/auth/callback` de Tuki.
6. Guardá Client ID y Client Secret de Google en el proveedor Google de Supabase
   y habilitalo. No agregues esos secretos a variables `NEXT_PUBLIC_`.
7. Verificá las Redirect URLs de Tuki del apartado anterior. Probá «Google» desde
   `/login` o `/registro`. Al finalizar, deberías llegar al resumen autenticado.
8. Antes de abrirlo al público, completá la publicación/verificación que exija
   Google para tu audiencia y dominios.

No se crearon clientes Google ni se modificó la configuración externa desde aquí.

## Aplicar la migración del perfil

Archivo: `supabase/migrations/202611020001_account_profiles.sql`.

1. Revisá el SQL y confirmá que estás en el proyecto Supabase de Tuki.
2. En SQL Editor creá una consulta nueva, pegá el contenido completo del archivo
   y ejecutalo **una sola vez**. No uses un comando de reset.
3. La migración usa una transacción: crea `public.profiles`, RLS, permisos mínimos,
   dos políticas de acceso propio y un trigger de alta en `auth.users`.
4. Completa perfiles de cuentas existentes, sin borrar ni modificar usuarios.
   Si ya hay una tabla `profiles` o función/trigger con el mismo nombre, el SQL
   falla: no borres la tabla ni uses DROP para forzarlo. Revisá el esquema existente
   antes de adaptar la migración.
5. Confirmá que no hubo errores y conservá este archivo como historial. Si usás
   Supabase CLI para otras migraciones, registrá esta aplicación manual en su
   historial antes de un futuro `db push`, para no intentar aplicarla dos veces.

Comprobación de solo lectura en SQL Editor:

```sql
select relrowsecurity
from pg_class where oid = 'public.profiles'::regclass;

select policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'profiles';

select trigger_name from information_schema.triggers
where event_object_schema = 'auth' and event_object_table = 'users'
  and trigger_name = 'tuki_auth_user_created';
```

Debe aparecer RLS activa, políticas SELECT/UPDATE para `authenticated` y el trigger.
El rol `anon` no tiene acceso. `authenticated` solo puede leer su propio perfil y
actualizar su `display_name`; no puede insertar, borrar ni cambiar `user_id`.
El trigger con `search_path` vacío crea los perfiles sin conceder esos privilegios
al navegador. El nombre es texto de presentación, nunca un rol o permiso.

`profiles.user_id` referencia a `auth.users.id`. Se prepara exclusivamente el
perfil de cuenta. La futura identidad global `persons` tendrá su propio ID y
`user_id` opcional; no se usará el perfil como identidad de invitados, ni se
vincularán personas por coincidencia de email. No hay fusiones ni membresías aquí.
La autenticación puede funcionar antes de aplicar este SQL; en configuración
aparecerá un aviso de perfil pendiente. Un fallo en un trigger de Auth sí puede
bloquear altas nuevas, por eso aplicá el SQL completo y revisá los logs del servicio
si un registro devuelve error de base de datos.

## Arquitectura y seguridad

- `@supabase/ssr` conserva sesión y verificador PKCE en cookies. No se implementa
  un almacén paralelo de tokens en localStorage.
- Cookies con `SameSite=Lax`, ruta raíz y `Secure` en producción. Se conserva
  acceso desde JavaScript para que los clientes de `@supabase/ssr` puedan operar;
  la autorización siempre se vuelve a validar en servidor.
- `lib/supabase/server.ts` distingue lectura en Server Components de escritura
  en Server Actions/Route Handlers. Un cliente por request, no un singleton servidor.
- `proxy.ts` propaga las cookies renovadas tanto al request como a la respuesta,
  conserva cookies al redirigir y marca respuestas privadas como `no-store`.
- `getUser()` valida contra Auth, en lugar de confiar en un objeto `getSession()`
  leído de cookies. El layout privado vuelve a verificar la identidad.
- La acción de cambio de contraseña verifica su propio usuario. Los futuros
  servicios de grupos/gastos también deberán verificar identidad y autorización
  dentro de cada acceso; el layout y el proxy no reemplazan esa comprobación ni RLS.
- Server Actions usa la protección de origen de Next.js. No se agregan endpoints
  GET que muten una contraseña o cierren la sesión. El callback GET solo consume
  un código PKCE de un solo uso vinculado al navegador iniciador.
- Los retornos de navegación aceptan solo rutas internas conocidas. Los mensajes
  del proveedor y los tokens no se incluyen en errores mostrados al usuario.
- Cookies/sesión/perfil quedan fuera de `use cache` y bajo Suspense, conservando
  Cache Components y Partial Prefetching de Next.js 16.

## Cómo probar

1. Aplicá el SQL, configurá email/URLs/SMTP y reiniciá con `npm run dev`.
2. En una ventana privada visitá `/`, `/grupos` o `/configuracion`: debe enviarte
   a `/login`, sin mostrar contenido privado. `/login` y `/registro` son públicos.
3. Registrá una cuenta de prueba propia desde `/registro`. Verificá el mensaje,
   recibí el email y abrí el enlace en ese mismo navegador. Debe iniciar sesión y
   mostrar el resumen. En Supabase → Authentication → Users, verificá confirmación.
4. Abrí `/configuracion`: debe mostrar únicamente el perfil y email de esa cuenta.
5. Recargá y navegá: la sesión debe mantenerse. Cerrá y reabrí el navegador si
   querés probar persistencia. Un navegador distinto no debería compartirla.
6. Cerrá sesión con el icono del encabezado. Visitá directamente una ruta privada
   de nuevo y comprobá la redirección. El cierre afecta este navegador, no todos
   los dispositivos.
7. Probá email o contraseña incorrectos, campos inválidos y confirmación distinta.
   Un usuario sin confirmar no debe poder entrar cuando Confirm email está activo.
8. Desde `/recuperar-contrasena`, solicitá un enlace. Abrilo en el mismo navegador,
   cambiá la contraseña, cerrá sesión e iniciá con la nueva. La anterior debe fallar.
9. Probá enlaces vencidos/reutilizados y Google cancelado: deben volver al login
   con un error seguro. Pedí un enlace nuevo para reintentar.
10. Configurá Google y probá el botón de acceso. Verificá la sesión y el perfil.
11. Con dos cuentas propias, verificá que cada cliente con su sesión solo pueda
    leer su fila de `profiles`. Una consulta a `profiles` sin filtro, desde un
    cliente autenticado con publishable key, debe devolver solo su perfil.
    No pruebes RLS con el SQL Editor como postgres, porque ese rol la omite.

Los envíos de correo, redirecciones de Google y políticas RLS remotas requieren
esta prueba manual contra el proyecto configurado. No se crearon usuarios, no se
enviaron correos ni se aplicó SQL remoto automáticamente durante el desarrollo.

## Validación local

Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
Las pruebas cubren validaciones, traducción segura de errores, acciones de Auth,
sesión requerida, redirects, callback PKCE, cookies del proxy y formulario de login.
Los servicios Supabase se simulan en pruebas; no equivalen a una prueba de extremo
a extremo con correo y Google reales. No se modificaron las dependencias.

Resultado de la verificación local de esta entrega:

| Comprobación | Resultado |
| --- | --- |
| Lint | Correcto |
| Typecheck | Correcto |
| Vitest | 13 archivos, 63 pruebas aprobadas |
| Build | Producción compilada con Proxy y Cache Components |
| HTTP anónimo | 307 hacia login en las ocho rutas privadas verificadas |
| Pantallas públicas | 200 en login, registro y recuperación |
| Callback sin código | 307 al login con error seguro |
| Cache-Control | `no-store` en todas esas respuestas |

Se usó temporalmente el puerto 3107 para los chequeos HTTP y se detuvo el servidor
al terminar. No se leyó ni imprimió el contenido de `.env.local`. La migración y
los flujos completos con email y Google quedan para aplicación/prueba manual.

Archivos principales: nuevo `proxy.ts`, adaptadores en `lib/supabase/`,
`lib/site-url.ts`, módulo `features/auth/`, rutas públicas de acceso y callback,
layout privado y pantalla de cambio de contraseña, migración SQL y pruebas
`tests/auth-*.test.*`/`tests/site-url.test.ts`. Las siete páginas originales se
movieron a `app/(private)/`, sin cambiar sus URLs. Se actualizaron configuración,
el encabezado de sesión, los avisos de próximos pasos, `.env.example` y README.

## Referencias oficiales

- Next.js 16: guías de Proxy, cookies y Cache Components instaladas en `node_modules/next/dist/docs/`.
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Email y contraseñas](https://supabase.com/docs/guides/auth/passwords)
- [Google OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
- [Perfiles y triggers](https://supabase.com/docs/guides/auth/managing-user-data)
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
