# Tuki

Compartir, sin vueltas.

Aplicación para organizar gastos compartidos entre amigos. Proyecto existente
con Next.js 16 App Router, React 19, TypeScript estricto y Tailwind CSS 4.

## Estado: Bloque 5 — validación de beta · NO-GO hasta aprobar controles reales

Implementado: sistema visual con tokens, componentes shadcn/ui adaptados sobre
Radix UI, iconos Lucide, navegación responsive, temas claro/oscuro/sistema con
preferencia local, estados vacíos, carga, error y página 404. Incluye Vitest,
React Testing Library y Zod. La Fase 2 incorpora acceso real con Supabase:
registro con confirmación de correo, login/logout, Google OAuth, recuperación y
cambio de contraseña, cookies SSR/PKCE y protección del dashboard en servidor.

La Fase 3 incorpora grupos permanentes/temporales, edición, archivo reversible,
participantes con o sin cuenta, identidad global `persons`, roles, retiros,
reutilización autorizada de invitados e invitaciones revocables de un solo uso.
Requiere aplicar la nueva migración siguiendo [la guía de la Fase 3](docs/fase-3-grupos.md).
Para duplicados creados antes de cargar gastos, está disponible una
[corrección local de invitados](docs/corregir-invitados-duplicados.md), con su
migración incremental independiente. No fusiona identidades globales.

La Fase 4 incorpora gastos reales, cuatro repartos exactos, cotización manual,
versiones inmutables, comprobantes privados y anulación. Las obligaciones globales
se proyectan entre miembros activos sin duplicarse ni triangularse. Los balances
propios de cada grupo se distinguen de las deudas compartidas. También incorpora
eliminaciones transaccionales y retiro lógico cuando hay historial.
Aplicá las migraciones nuevas siguiendo [la guía de la Fase 4](docs/fase-4-finanzas.md).
No hay datos de demostración. Los pagos se registran como operaciones externas;
Tuki no realiza transferencias bancarias.
Los perfiles de cuenta se guardan en Supabase después de aplicar la migración.
El Bloque 4 incorpora PWA y recuperación pública sin conexión. Los datos y
operaciones financieras requieren Internet; no hay pagos offline.

La Fase 4.5 agrega **Cuenta inteligente** desde Nuevo gasto: productos,
consumidores, cantidades, descuentos, propina, cargos y conciliación exacta.
La carga manual no requiere IA. El escaneo opcional usa un adaptador OpenAI
en servidor, con consentimiento y cuotas; los tickets se guardan en Storage
privado. El desglose y el gasto se versionan en una misma transacción, usando
las obligaciones existentes. Ver [configuración y pruebas de Fase 4.5](docs/fase-45-cuenta-inteligente.md).

La Fase 5 agrega pagos parciales/completos, confirmación por contraparte,
atestación administrativa para invitados (revisada por 009), rechazo y anulación
con reversión. Las asignaciones FIFO o manuales conservan las obligaciones de
origen y actualizan todas sus proyecciones una sola vez. Incluye Saldar deudas,
historial, comprobantes privados y protección de gastos afectados por pagos
confirmados. Aplicá únicamente la migración nueva 007 siguiendo
[la guía de pagos de Fase 5](docs/fase-5-pagos.md).

La Fase 6 incorpora diálogos de pago completo/parcial desde las deudas, cobro
atómico declarado por el receptor, campana y centro de notificaciones con
outbox, preferencias y recordatorios con límites. Los automáticos quedan
desactivados hasta configurar y autorizar un programador externo. Requiere
solo la migración nueva 008. Ver [la guía de Fase 6](docs/fase-6-notificaciones.md).

La revisión de pagos posterior a Fase 6 requiere la migración **009**: entre
cuentas registradas confirma solamente el receptor; con invitados puede confirmar
un administrador del origen con motivo, sin exigir otro administrador. Incluye
acciones en notificaciones y filtros de deudas. Ver [reglas, aplicación y pruebas](docs/admin-payment-confirmation.md).

El **Bloque 1** agrega operaciones de pago recuperables en servidor, estados
financieros verificables, escaneo recuperable, auditoría de permisos y herramientas
de conciliación/concurrencia. Requiere las migraciones nuevas **010 y 011** en orden.
Ver [informe y aplicación](docs/bloque-1-beta.md) y
[respaldo, restauración y PostgreSQL local](docs/bloque-1-operaciones.md).
Las pruebas reales de concurrencia, restauración y verificación del despliegue
siguen pendientes antes de declarar lista la beta.

El **Bloque 2** reorganiza grupos por secciones, simplifica gastos e invitados,
agrega asignación conjunta de productos y mejora pagos, onboarding y navegación
móvil. El motivo administrativo adicional opcional requiere la migración nueva
**012**; sin ella se mantiene el requisito anterior.
Ver [cambios, archivos, recorridos y validación](docs/bloque-2-ux.md) y
[aplicación y compatibilidad de 012](docs/bloque-2-motivo-administrativo.md).

El **Bloque 3** agrega estadísticas por grupo y período, filtros de gastos en
servidor, historial financiero paginado, resumen personal y exportaciones privadas
CSV/PDF. Requiere aplicar únicamente la migración nueva **013**, después de 012.
No incluye deudas proyectadas en el total de gastos de otro grupo.
Ver [indicadores, seguridad, archivos y aplicación](docs/bloque-3-reportes.md).

El **Bloque 4** agrega manifest, iconos instalables, worker limitado a recursos
públicos, instalación voluntaria y guardas de desconexión/recuperación. No requiere
SQL nuevo ni instala dependencias. La beta queda condicionada a concurrencia real,
restauración aislada y verificación en staging y dispositivos.
Ver [PWA, configuración y checklist de beta](docs/bloque-4-pwa-beta.md) y
[PostgreSQL, auditoría de paquetes y backups](docs/bloque-4-operaciones.md).

El **Bloque 5** restringe operaciones nuevas a **UYU** conservando historia
multimoneda, agrega guardas de entorno y amplía la conciliación. Requiere revisar y
aplicar manualmente la migración nueva **014**, después de 013. No se ejecutó SQL
remoto ni despliegue. Concurrencia real, restore y dispositivos siguen pendientes:
la decisión es **NO-GO**. Ver [informe de release y pasos manuales](docs/bloque-5-beta-release.md)
y [escenarios funcionales y móviles](docs/beta-manual-testing.md).

## Requisitos e inicio local

- Node.js 26, utilizado en esta fase, y npm 11.
- `package-lock.json` fija las versiones resueltas: usar `npm ci` para reproducirlas.
- Se requieren las variables públicas de Supabase configuradas en `.env.local`.
- Leé [la guía de autenticación](docs/fase-2-autenticacion.md) antes de probar.

```powershell
npm ci
npm run dev
```

Abrir http://localhost:3000 (o el puerto que informe Next.js).

```powershell
npm run lint
npm run typecheck
npm test
npm run test:watch
npm run build
npm start
```

`typecheck` genera primero los tipos de rutas con `next typegen` y luego ejecuta
TypeScript. `test` corre una sola vez; `test:watch` queda observando cambios.
`start` requiere un build previo. La instalación necesita acceso al registro
npm; la tipografía y el build de esta fase no requieren Google Fonts.

## Estructura

```text
app/
  (private)/            Dashboard y secciones con layout protegido (URLs iguales)
  auth/callback/        Intercambio del código PKCE
  login/                Inicio de sesión
  registro/             Registro con confirmación
  recuperar-contrasena/ Solicitud de recuperación
components/
  layout/               Marca, shell, navegación móvil y selector de tema
  providers/            Proveedor de apariencia
  shared/               Estados vacíos y aviso de próximos pasos
  ui/                   Primitivas shadcn/ui adaptadas (Radix)
features/
  auth/                 Acciones, validaciones, sesión y formularios de acceso
  groups/               Grupos, identidades, participantes e invitaciones
  finance/              Dominio exacto, acciones, consultas y pantallas financieras
  smart-bills/          Productos, conciliación, escaneo opcional y tickets privados
  payments/             Pagos externos, confirmaciones, liquidación y auditoría
  overview/             Primera interfaz de resumen
  workspace/            Estructura visual de secciones pendientes
hooks/                  Espacio para hooks reutilizables de interfaz
lib/
  env.ts                Validación diferida con Zod
  navigation.ts         Definición de navegación
  supabase/             Clientes de lectura/escritura y refresco de cookies
  utils.ts              Composición de clases
proxy.ts                Verificación y renovación de sesión antes de las rutas
supabase/migrations/    Migraciones incrementales con RLS, de aplicación manual
tests/                  Pruebas unitarias, de componentes y de protección
```

`components.json` configura shadcn/ui para Tailwind 4, alias `@/*`, variables
CSS y Lucide. Los componentes viven en el repositorio y se pueden adaptar.
La integración CSS existente con `@tailwindcss/turbopack` se conserva: no hace
falta sumar PostCSS. No usar `--webpack` sin revisar antes esa integración.

Se conservaron Cache Components y Partial Prefetching de la plantilla.
Los accesos a cookies/sesión son por petición y fuera de `use cache`, bajo
límites Suspense. El proxy consulta `getUser`; el layout privado vuelve a
verificar al usuario. Las futuras acciones/datos privados también deberán
verificar autorización dentro de cada operación, además de RLS.

## Configurar Supabase

La migración se prepara localmente; no se ejecuta sobre tu proyecto desde aquí.

1. Crear o seleccionar un proyecto Supabase propio.
2. Obtener su Project URL y **publishable key** en la configuración del proyecto.
3. Completar los valores en `.env.local`, conservando los que ya configuraste.
   Usar `.env.example` como referencia, sin sobrescribir tu archivo existente.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
TUKI_SITE_URL=http://localhost:3000
```

No subir `.env.local` al repositorio. `.env.example` contiene solo nombres y
valores vacíos. Las variables `NEXT_PUBLIC_` son públicas: nunca colocar allí
`service_role`, `sb_secret_...`, contraseñas ni claves privadas. No hace falta
compartir ningún secreto en el chat.

`TUKI_SITE_URL` es el origen de esta instalación: localhost en desarrollo y tu
dominio HTTPS en producción. Es obligatorio en producción para construir enlaces
de email y OAuth; no se toma el host enviado por el visitante. Reiniciar Next.js
después de cambiar variables. Si cambiás el puerto, ajustá el origen y las URLs
permitidas en Supabase.

Aplicá la migración de perfiles y configurá confirmación de email, URLs, SMTP y
Google siguiendo los pasos exactos de [Fase 2](docs/fase-2-autenticacion.md).
Después, aplicá `202611020002_groups_persons.sql` siguiendo
[Fase 3](docs/fase-3-grupos.md). No se necesitan claves secretas en el navegador.
Después aplicá 003, 004 y 005 siguiendo la guía de la Fase 4. Storage y Realtime
no son necesarios en esta fase: los comprobantes pequeños se protegen con RLS en PostgreSQL.
Reclamar invitados y fusionar personas están bloqueados; una invitación de grupo
no verifica la identidad de un invitado ni permite apropiársela por nombre.

## Reglas que deberán conservar las próximas fases

- Identidad global `persons`, con `user_id` opcional y fusiones auditadas.
- Balances y pagos exclusivamente UYU; conversiones manuales históricas fijas.
- Dinero con aritmética exacta y redondeos deterministas, nunca floats.
- Una obligación única, con grupo de origen, proyectada solo en grupos donde
  deudor y acreedor sean miembros activos. Los detalles del gasto se autorizan
  por separado según el grupo de origen.
- Separar balance contable del grupo y obligaciones compartidas proyectadas.
- Sin triangulación entre grupos. Pagos pendientes no reducen obligaciones.
- Las deudas de grupos archivados siguen siendo pagables.
- Dominio financiero puro, separado de React y de la infraestructura Supabase.
- Operaciones financieras transaccionales, idempotentes y auditadas.

La Fase 4 implementa el dominio de gastos y obligaciones. Pagos y liquidaciones
siguen pendientes; deberán conservar estas reglas.

## Revisión visual y funcional

- Resumen y navegación en escritorio y móvil (320, 390, 768 y 1440 px).
- Menú móvil: apertura, cierre, Escape y navegación a otra página.
- Temas claro/oscuro/sistema; persistencia al recargar.
- Diálogo «Cómo empezar»: contenido, cierre y retorno del foco.
- Navegación por teclado y enlace «Saltar al contenido».
- Estados sin datos y acciones futuras claramente señaladas.
- Páginas de grupos, balances, pagos, actividad, configuración, ayuda y 404.
- Registro, confirmación de email, login, logout y recuperación en el mismo navegador.
- Google OAuth después de configurar el proveedor; perfil propio y acceso privado.

La validación automática no sustituye la aprobación visual. El despliegue en
Vercel requiere un despliegue autorizado; la PWA está configurada en el Bloque 4,
con verificación real de instalación todavía pendiente. No se publica automáticamente.

El detalle de archivos, comandos, resultados y limitaciones está en
[el informe histórico de la Fase 1](docs/fase-1.md) y en
[la guía de la Fase 2](docs/fase-2-autenticacion.md).
La configuración de grupos, migraciones, pruebas SQL y límites de vinculación
de identidades están en [la guía de la Fase 3](docs/fase-3-grupos.md).

Si aparece un error de autenticación, consultá
[el diagnóstico de URL y mensajes seguros](docs/diagnostico-auth.md).
Para enlaces de confirmación y plantillas de Supabase, consultá
[confirmación de email y cookies de sesión](docs/confirmacion-email.md).

## Documentación de referencia

- Next.js: leer primero `node_modules/next/dist/docs/` de la versión instalada.
- [Instalación manual de shadcn/ui](https://ui.shadcn.com/docs/installation/manual)
- [Clientes SSR de Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Vitest](https://vitest.dev/guide/)
