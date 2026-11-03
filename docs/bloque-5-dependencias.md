# Bloque 5 — Auditoría actualizada de dependencias

Fecha: 2026-11-03. Se consultó el registro npm y la documentación del mantenedor.
No se modificaron `package.json`, `package-lock.json` ni paquetes instalados.
No se utilizó `npm audit fix --force` ni se degradó ESLint/Next para ocultar avisos.

## Resultado ejecutado

| Comando | Salida | Resultado |
| --- | ---: | --- |
| `npm audit --json` | 1 | 16 entradas moderadas; 0 bajas, altas o críticas |
| `npm audit --omit=dev --json --fetch-retries=0 --fetch-timeout=15000` | 0 | 0 avisos en dependencias de producción |
| `npm ls minimatch eslint @typescript-eslint/typescript-estree --all` | 0 | Árbol revisado, sin paquetes inválidos |
| `npm view ...` de versiones/dependencias | 0 | Versiones publicadas y rangos de consumidores comprobados |

La primera consulta dentro del sandbox falló por acceso al endpoint de auditoría.
Se repitió con acceso autorizado al registro; la tabla corresponde a las consultas
que sí finalizaron. Una consulta fallida no se contó como auditoría sin hallazgos.

Las 16 entradas son la propagación de un aviso de `minimatch` a consumidores y
dependientes del tooling; **no representan 16 vulnerabilidades independientes**.
La auditoría de producción excluye estas dependencias de desarrollo, pero no
certifica por sí sola la seguridad de la aplicación ni la de su entorno de build.

## Causa y árbol afectado

El aviso [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
describe amplificación de patrones glob y agotamiento de recursos. npm clasifica
como afectadas las versiones anteriores a 11.0.1. La dependencia está en estas
ramas instaladas:

- `eslint@9.39.5` y sus utilidades → `minimatch@3.1.5`.
- `eslint-config-next@16.4.4` → plugins import, React y accesibilidad → la misma rama 3.
- `typescript-eslint@8.72.1` → `@typescript-eslint/typescript-estree@8.72.1`
  → `minimatch@10.2.6`.

La descripción específica del mantenedor se centra en el preprocesamiento de
patrones con optimización de nivel 2 o superior. **No se descarta el resultado de
npm para la rama 3** ni se afirma que el aviso haya desaparecido porque esa rama
tenga una implementación diferente.

## Actualización compatible evaluada

Consultas oficiales a npm confirmaron:

| Paquete o rama | Instalado / versión consultada | Rango o límite relevante |
| --- | --- | --- |
| ESLint 9 | 9.39.5 | Última versión publicada consultada dentro de la rama 9 |
| minimatch 3 | 3.1.5 | Último parche publicado consultado de la rama 3 |
| minimatch 10 | 10.2.6 | Último parche publicado consultado de la rama 10 |
| typescript-eslint | 8.72.1 | Parser exige `minimatch ^10.2.2` |
| eslint-plugin-import | 2.32.0 | Última consultada; exige `^3.1.2` |
| eslint-plugin-jsx-a11y | 6.10.2 | Última consultada; exige `^3.1.2` |
| eslint-plugin-react | 7.37.5 | Última consultada; exige `^3.1.2` |

No había un parche publicado que corrigiera este aviso manteniendo los rangos
de los consumidores actuales. El [README del mantenedor en 11.0.1](https://github.com/isaacs/minimatch/blob/v11.0.1/README.md)
explica que el nuevo motor no será llevado a las versiones anteriores por la
profundidad del cambio.

Se descartaron estas alternativas:

1. **Override global a 11.0.1:** la rama 3 se consume con una API CommonJS invocable,
   mientras que la rama 11 exporta funciones nombradas y cambia el motor. También
   cambia superficies como `makeRe`. Forzarlo podría romper ESLint y sus plugins.
2. **Override limitado al parser de TypeScript:** su uso observado es la función
   nombrada con la opción `dot`, pero sería fuera del rango soportado `^10`.
   No elimina los avisos de la rama 3 y no constituye una actualización compatible
   publicada por el parser. No se impuso como si el riesgo estuviera resuelto.
3. **Sugerencias de `audit fix` con cambios mayores:** npm proponía, entre otros,
   ESLint 4.0.0 y eslint-config-next 12.0.4. Esas degradaciones no son una reparación
   compatible de un proyecto Next 16 con configuración moderna.
4. **Quitar plugins o reemplazar toda la configuración de lint:** reduciría controles
   existentes y excedería una corrección mínima sin justificación.

Por ello no se cambió el lockfile para aparentar una remediación. Las **16 entradas
moderadas permanecen abiertas**, aunque la auditoría de producción siga en cero.

## Exposición y tratamiento propuesto

Clasificación propuesta: **P2 de tooling**, con revisión del responsable de seguridad
antes del lanzamiento. No se ha demostrado una ruta desde las entradas financieras
de usuarios hasta este matcher de ESLint; el tooling se ejecuta al desarrollar o
construir el proyecto. Esto reduce su exposición en la aplicación publicada, pero
no elimina el riesgo en CI o al procesar repositorios/configuraciones no confiables.

Controles pendientes que debe verificar el propietario:

- No ejecutar builds de contribuciones no confiables con secretos o permisos de producción.
- Mantener la instalación reproducible desde el lockfile aprobado y revisar cambios de scripts/paquetes.
- Limitar permisos y tiempo/recursos de jobs de lint; investigar consumo anormal.
- Repetir `npm audit` antes de publicar y comprobar si los consumidores incorporaron
  una versión corregida soportada. Aplicar esa actualización y volver a ejecutar
  lint, typecheck, suite completa y build.
- Si se decide migrar el tooling a otra versión mayor, hacerlo como cambio explícito
  con pruebas de reglas, alcance de archivos y compatibilidad de plugins; no como
  override silencioso.

Estos son controles propuestos, no cambios remotos ni una certificación de CI.
El resultado de este apartado no resuelve los gates críticos de concurrencia,
restauración y privacidad real exigidos para decidir GO/NO-GO.
