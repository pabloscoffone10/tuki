# Tuki — Fase 1: Fundación y sistema visual

Informe histórico. La autenticación y la protección de rutas se implementaron
posteriormente en la [Fase 2](fase-2-autenticacion.md). Las rutas de aplicación
ahora viven bajo `app/(private)/`, conservando sus URLs públicas.

Fecha de validación: 2 de noviembre de 2026.

## Resultado

Se trabajó sobre el proyecto existente, conservando Next.js 16.4.4, React 19.3.0,
TypeScript estricto, Tailwind CSS 4 y la integración Turbopack. Se revisó el
contenido de los archivos existentes antes de reemplazarlos.

Interfaz en español uruguayo con marca propia, acento verde, superficies cálidas,
modo oscuro, navegación de escritorio y menú móvil accesible basado en Radix.
La apariencia se conserva en el navegador; no hay otros datos persistidos.
Los saldos se muestran como no disponibles, sin importes ni personas ficticias.

## Archivos creados

| Ubicación | Contenido |
| --- | --- |
| `components.json` | Configuración manual de shadcn/ui, Tailwind 4 y Lucide |
| `components/ui/` | `button.tsx`, `card.tsx`, `badge.tsx`, `dialog.tsx`, `skeleton.tsx`; componentes adaptados al sistema visual |
| `components/layout/` | `brand.tsx`, `app-shell.tsx`, `theme-switcher.tsx` |
| `components/providers/theme-provider.tsx` | Temas claro, oscuro y sistema |
| `components/shared/` | `empty-state.tsx`, `phase-notice.tsx` |
| `features/overview/components/overview.tsx` | Resumen visual inicial |
| `features/workspace/components/section-page.tsx` | Secciones futuras, señaladas como pendientes |
| `features/README.md`, `hooks/README.md` | Límites y organización modular |
| `app/{grupos,balances,pagos,actividad,configuracion,ayuda}/page.tsx` | Rutas de navegación |
| `app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx` | Estados de carga, error y 404 |
| `app/icon.svg` | Icono propio de Tuki |
| `lib/utils.ts`, `lib/navigation.ts` | Utilidades CSS y navegación |
| `lib/env.ts`, `lib/supabase/{client,server}.ts` | Validación diferida y clientes preparados |
| `.env.example` | Variables públicas vacías, sin credenciales |
| `vitest.config.mts`, `tests/setup.ts` | Configuración de pruebas |
| `tests/{env,navigation}.test.ts` | Entorno y selección de rutas |
| `tests/{phase-notice,theme-switcher,app-shell}.test.tsx` | Diálogo, temas y menú móvil |
| `docs/fase-1.md` | Este informe |

Archivos modificados: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`,
`package.json`, `package-lock.json`, `.gitignore` y `README.md`.
Next.js también regenera tipos dentro de `.next/` y puede actualizar
`next-env.d.ts`; TypeScript genera su caché ignorada. Se conservaron los recursos
originales de `public/` y el favicon anterior, con el icono nuevo configurado en
los metadatos. No se cambió `next.config.ts`.

## Dependencias y comandos

Se instalaron:

```text
npm install @supabase/supabase-js @supabase/ssr zod next-themes lucide-react radix-ui class-variance-authority clsx tailwind-merge tw-animate-css server-only
npm install -D @types/node@^26 vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event
```

El primer intento con acceso de red restringido no progresó y se detuvo.
Se reintentó con permisos de red. La instalación inicial de herramientas de
prueba encontró una incompatibilidad de Vitest 5 con `@types/node@20`;
se resolvió alineando los tipos con Node 26 del entorno, sin `--force` ni
`--legacy-peer-deps`. `npm ls --depth=0` terminó sin conflictos.

La integración shadcn/ui se realizó manualmente mediante su configuración,
utilidad `cn`, tokens y componentes locales adaptados sobre Radix, siguiendo
su documentación. No se ejecutó un inicializador que reemplazara el proyecto.

## Validación ejecutada

| Comando o chequeo | Resultado |
| --- | --- |
| `npm run lint` | Sin errores ni avisos |
| `npm run typecheck` | Generación de tipos de rutas y TypeScript sin errores |
| `npm test` | 5 archivos y 8 pruebas aprobados |
| `npm run build` | Build de producción exitoso con Turbopack |
| `npm start -- --port 3107` | Servidor de producción iniciado y luego detenido |
| HTTP local | 200 en `/`, `/grupos`, `/balances`, `/pagos`, `/actividad`, `/configuracion`, `/ayuda` y `/icon.svg` |
| Ruta `/no-existe` | 404 |
| `npm audit --json` | 16 avisos moderados en la cadena de herramientas ESLint por `minimatch`; sin avisos altos ni críticos |

Las pruebas verifican configuración ausente/inválida/válida, coincidencia de
rutas, apertura y cierre del diálogo con Escape y retorno de foco, cambio de
tema y preferencia local, y selección/cierre de navegación en el menú móvil.
La primera ejecución encontró un error en la validación de URL vacía; se
corrigió y la ejecución final completa pasó.

El informe de auditoría propone retroceder ESLint y su configuración de Next a
versiones incompatibles. No se aplicó esa corrección forzada ni se impuso una
versión mayor de `minimatch` sobre dependencias con otra API. Este aviso de
herramientas de desarrollo queda pendiente de una actualización compatible.
Una consulta offline de auditoría devolvió cero hallazgos por falta de datos;
el resultado válido documentado es el de la consulta online.

## Límites y revisión pendiente

No hay sesión, tablas, RLS, grupos persistidos, gastos, pagos, dominio financiero,
estadísticas ni PWA. Las vistas respectivas son estados de futura disponibilidad.
No se ha creado un servicio Supabase ni probado una conexión externa.
No se publicó en Vercel ni en Sites.

No se dispuso de una herramienta de navegador visual para inspección automática.
Los tests con jsdom y los chequeos HTTP no prueban espaciado, contraste visual
completo ni ausencia de desbordes en dispositivos reales. Antes de aprobar la
Fase 2, revisar con `npm run dev`:

1. Resumen y tarjetas a 320, 390, 768 y 1440 px de ancho.
2. Navegación completa y menú móvil; cierre con enlace, botón, fondo y Escape.
3. Temas claro, oscuro y sistema; persistencia tras recargar.
4. Diálogo «Cómo empezar», foco de teclado y enlace para saltar al contenido.
5. Estados vacíos, guiones en balances y acciones futuras deshabilitadas.
6. Configuración, ayuda y ruta inexistente.

Para la Fase 2 se necesitará un proyecto Supabase y completar `.env.local` con
Project URL y publishable key. El README explica dónde configurarlos. No
compartir claves privadas ni service_role en el chat. Los proveedores de
autenticación, URLs de redirección y refresco seguro de sesión se implementarán
en esa fase, después de la aprobación de esta base visual.
