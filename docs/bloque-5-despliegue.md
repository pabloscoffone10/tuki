# Bloque 5 — Guardas de entorno antes de desplegar

Implementado localmente; no se configuraron cuentas, dominios, secretos ni proyectos
remotos. Los valores de `.env.local` no se imprimieron ni se copiaron al informe.

## Problema P1 corregido

Un Preview podía recibir por error la misma URL Supabase que producción: la separación
de entornos estaba documentada, pero el build no verificaba esa política.

`next.config.ts` ahora llama a `validateDeploymentEnvironment(process.env)` de
`lib/deployment.ts` al cargar su configuración. Para los valores de `VERCEL_ENV`
`preview` y `production`, una configuración incompleta o cruzada aborta el build/start
con mensajes que nombran variables, sin mostrar sus valores.

## Variables revisadas por el propietario

Son orígenes públicos de proyectos, no claves secretas. Se agregaron los nombres
vacíos a `.env.example`:

- `TUKI_STAGING_SUPABASE_ORIGIN`: origen HTTPS del proyecto aislado de staging.
- `TUKI_PRODUCTION_SUPABASE_ORIGIN`: origen HTTPS del proyecto productivo.

Reglas:

| Entorno de Vercel | Requisito |
| --- | --- |
| Preview | Ambos orígenes aprobados presentes y distintos; `NEXT_PUBLIC_SUPABASE_URL` debe coincidir con staging |
| Production | Origen aprobado de producción presente; `NEXT_PUBLIC_SUPABASE_URL` debe coincidir con él; si se proporciona staging, debe ser distinto |
| Local / Development | No se obliga a configurar la allowlist remota; se conserva el flujo local existente |

En Preview y Production también es obligatoria la clave pública configurada; un
valor ausente se rechaza antes del despliegue. Local conserva la validación diferida
para poder trabajar sin conectar servicios. La clave nunca se imprime en errores.

En Preview y Production también se exige `TUKI_SITE_URL` como origen HTTPS remoto,
sin ruta, query, fragmentos ni credenciales. La comprobación no deriva destinos
del header Host ni de una URL enviada por el usuario.

Esta guarda compara configuración declarada por el propietario; no puede comprobar
desde un hostname que el proyecto de staging esté vacío o que no contenga una copia
de datos reales. El propietario debe verificar la identidad del proyecto y su
contenido antes de aprobar esos orígenes. Si alguien configura deliberadamente un
proyecto real como staging, la allowlist no es una certificación independiente.
Tampoco modifica Redirect URLs de Supabase o Google ni compara automáticamente
`TUKI_SITE_URL` con sus paneles remotos.

## Clave pública antes del bundle

Antes incluso de evaluar `VERCEL_ENV`, la configuración comprueba una
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` proporcionada mediante el clasificador compartido
`lib/public-supabase-key.ts`. Rechaza claves `sb_secret_`, JWT legacy malformados y
JWT cuyo rol no sea `anon`, incluido `service_role`, antes de que Next pueda insertar
el valor en JavaScript del navegador.

Esto clasifica el tipo de clave; **no verifica la firma de un JWT ni autentica al
usuario**. La autenticación real permanece en Supabase. La misma validación se
reutiliza en el cliente de configuración de la aplicación. Si una clave privilegiada
se expuso previamente, cambiar la variable no deshace la exposición: el propietario
debe revisar/rotar o revocar la credencial en el proveedor según corresponda.

## Pasos manuales en Vercel y Supabase

1. Revisar los proyectos separados de staging y producción, sin copiar datos
   personales reales al entorno de pruebas.
2. En las variables **Preview** de Vercel, configurar la URL/clave pública de staging,
   el origen HTTPS de Tuki staging y los dos orígenes aprobados de Supabase.
3. En **Production**, configurar la URL/clave pública de producción, su origen HTTPS
   de Tuki y el origen aprobado de Supabase de producción. Mantener separados los
   secretos opcionales de IA, cron y service role; nunca usar el prefijo público.
4. Dejar `VERCEL_ENV` a cargo de Vercel. No inventar un valor para saltar la guarda.
5. Configurar manualmente Site URL y Redirect URLs de Supabase y el proveedor Google
   para cada entorno, usando los callbacks de la guía de autenticación existente.
6. Ejecutar build y pruebas. Un error de guarda exige corregir las variables del
   entorno; no quitar la validación ni apuntar el Preview a producción para continuar.
7. Después de autorización explícita para desplegar, publicar staging y realizar la
   batería de pruebas remotas, PWA, sesiones y privacidad antes de producción.

Las variables `NEXT_PUBLIC_` se insertan durante `next build`: cambiar su valor
después de construir no modifica los bundles existentes. Reconstruir para cada
entorno con su configuración aprobada; no promover a producción un artefacto
construido con valores públicos de staging ni viceversa.

## Evidencia automática

`tests/deployment.test.ts` cubre configuración local, Preview correcto y cruzado,
orígenes faltantes/duplicados, Production correcto e incorrecto, URL HTTPS inválida,
credenciales en URLs y claves públicas frente a claves secretas/roles JWT sintéticos.
Los errores se comprueban sin incluir valores sensibles. Junto con
`tests/pwa-config.test.ts`, **14 pruebas focalizadas pasaron**; ESLint de los archivos
del guard y su configuración también terminó correctamente.

No se afirma que Vercel o Supabase estén configurados correctamente: eso sigue
pendiente de verificar en los proyectos reales y con autorización para los cambios.
