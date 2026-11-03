# Autenticación: diagnóstico y corrección de URL

Se investigó el mensaje genérico de registro/login sin mostrar valores de entorno,
emails de usuarios, contraseñas ni tokens.

## Causa confirmada

`NEXT_PUBLIC_SUPABASE_URL` contenía el endpoint REST `/rest/v1` en lugar del origen
del proyecto. El SDK agrega `/auth/v1` a esa base, por lo que las solicitudes de
autenticación terminaban en una ruta incorrecta. El gateway respondía 404 sin un
código Auth reconocido y `authError()` lo convertía en el mensaje genérico.

Se hicieron dos consultas de solo lectura a los ajustes públicos de Auth usando
la misma clave pública: con la base configurada la respuesta fue 404; con la base
del proyecto fue 200 y se reconoció la estructura de ajustes Auth. Esto confirma
el fallo de URL sin crear usuarios, enviar correos ni ejecutar SQL.

Se corrigió únicamente la asignación de URL en `.env.local`, conservando el origen
del proyecto y eliminando el sufijo REST. No se modificaron las otras variables
ni se escribieron copias de sus valores en documentación, logs o archivos nuevos.

## Configuración comprobada

- Los tres nombres esperados estaban presentes, completos y sin duplicados:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `TUKI_SITE_URL`.
- La clave tenía formato publishable, no `sb_secret_`.
- Los ajustes públicos confirmaron registro y proveedor email habilitados y
  confirmación de email activa. Google aparecía deshabilitado.
- No se desactivó RLS ni la confirmación de correo. No se modificó el proyecto remoto.

## Cambios de código

- `lib/env.ts` rechaza URLs con `/rest/v1`, `/auth/v1`, credenciales, parámetros o
  fragmentos y rechaza claves `sb_secret_` en la variable pública.
- Errores tipados de configuración, sin incluir valores, para Supabase y el origen
  de Tuki. Una URL inválida de Tuki ya no se confunde con una falla de red.
- Mensajes específicos para 404, clave rechazada, restricciones SMTP, proveedores
  deshabilitados, límites de envío, enlaces PKCE vencidos y fallas internas.
- Las Server Actions conservan la información de error del SDK para clasificarla.
  Ya no descartan sistemáticamente el estado HTTP o los fallos de configuración.
- Se verifica el resultado de cerrar una sesión automática tras el registro;
  un fallo ya no se informa como registro exitoso.
- El callback registra un diagnóstico seguro y, solo en desarrollo, transmite un
  código de una lista permitida para mostrar una explicación útil en el login.

En desarrollo, la terminal muestra `[Tuki Auth]` con **operación, código permitido
y estado HTTP**. La interfaz agrega esos mismos campos al error. Nunca se imprime
el objeto de error completo, su mensaje original, stack, URLs, cuerpos de formularios
ni valores de entorno. Códigos desconocidos se reducen a `unknown_auth_error`.
En producción se omiten esos detalles de desarrollo; siguen los mensajes seguros
específicos. Los diagnósticos del callback no admiten texto arbitrario de la URL.

## Volver a probar

1. Detené y reiniciá `npm run dev` para descartar la configuración anterior.
2. Probá `/registro` con una dirección propia y abrí el enlace en el mismo navegador.
3. Si el siguiente error indica `email_address_not_authorized`, configurá Custom
   SMTP: corregir la URL no modifica las restricciones de correo del servicio.
4. Si aparece `unexpected_failure` o `database_failure`, consultá Auth Logs y
   PostgreSQL Logs del mismo intento. No reejecutes ni borres la tabla de perfiles
   a ciegas, y no desactives RLS para resolverlo.
5. Si querés usar Google, habilitá el proveedor siguiendo
   [la guía de la Fase 2](fase-2-autenticacion.md).

La prueba con una cuenta real, entrega de correo y SQL remoto no se ejecutó
automáticamente. La causa 404 sí se verificó con respuestas del proyecto real.

Referencia: [códigos de error oficiales de Supabase](https://supabase.com/docs/guides/auth/debugging/error-codes).
