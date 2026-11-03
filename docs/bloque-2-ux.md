# Bloque 2 — UX, navegación y simplificación

## Alcance y diagnóstico

Implementación sobre el proyecto existente. El detalle del grupo reunía personas,
gastos, saldos y administración en una pantalla larga. Los formularios mostraban
opciones secundarias junto con decisiones esenciales; la selección implícita de
participantes podía pasar inadvertida. Reutilizar invitados requería reconocer
identidades en un selector. Las asignaciones por producto repetían muchas acciones.
Los pagos tenían recuperación segura, pero su presentación mezclaba acciones
pendientes e historial y exigía texto adicional para toda confirmación administrativa.

Se conserva la marca, la paleta, la autenticación y el motor financiero. No se
ejecutó SQL remoto, no se instalaron dependencias, no se hicieron llamadas de IA
pagas ni se implementó el Bloque 3. No se editaron las migraciones 001–011.

## Cambios implementados

- **Navegación:** Resumen, Gastos, Saldos y Personas en cada grupo; Ajustes e
  historial separados. La ruta antigua `/grupos/[id]/finanzas` redirige a Saldos.
  Cada sección carga sus datos necesarios. Resumen evita las consultas de
  invitados reutilizables, invitaciones e historial: las consultas de tablas de
  `getGroup` para un administrador pasan de cinco a dos; conserva la RPC financiera.
  Esto es una comparación del código, no una medición de latencia en producción.
- **Gastos:** pagador inicial correspondiente a la cuenta actual, cuando es un
  participante activo; participantes explícitos, seleccionar todos/limpiar,
  resumen de reparto y confirmación de revisión. Fecha, categoría, moneda,
  cotización y notas quedan en opciones secundarias. Editar conserva la selección
  anterior. Se aceptan coma o punto decimal y se envían cadenas canónicas al motor
  existente, sin convertir importes a coma flotante.
- **Invitados:** búsqueda local entre candidatos autorizados, advertencias por
  nombres similares y elección explícita de identidad existente o persona nueva.
  Los homónimos requieren confirmación. No hay unión por nombre ni descubrimiento
  de personas de otros usuarios. El único administrador activo no recibe controles
  para retirarse o perder su rol sin designar otro; el servidor sigue validándolo.
- **Cuenta inteligente:** productos plegables con subtotal, duplicación explícita,
  asignación conjunta a productos y consumidores seleccionados y resumen individual
  con nombres de productos. Los duplicados escaneados requieren revisión. El
  cálculo, orden de cargos y reglas de revisión siguen en el dominio existente.
- **Pagos:** saldos tomados de estados explícitos del servidor; los desconocidos
  se muestran como «Por verificar». Pendientes accionables antes del historial;
  enlaces al historial abren el contenedor plegado. Se ocultan acciones que el
  usuario no puede realizar. Se conserva la confirmación y recuperación por ID.
  Cambiar datos financieros invalida la revisión anterior. El motivo adicional
  administrativo puede ser opcional después de aplicar 012; rechazos y anulaciones
  conservan su motivo obligatorio.
- **Inicio y estados vacíos:** primeros pasos breves solo cuando no hay grupos
  visibles, sin ocultar saldos históricos. La lista de grupos se obtiene una vez.
  Se distingue una búsqueda sin resultados de una lista todavía vacía y se ofrecen
  acciones concretas para crear el primer gasto o limpiar filtros.
- **Pantallas pequeñas y accesibilidad:** navegación inferior Inicio/Grupos/Pagos,
  controles frecuentes de 44 px, diálogos con desplazamiento, foco visible y foco
  en errores de formulario. Saldos usa tarjetas en móvil/tablet y tabla en escritorio.
  Se mantienen los temas y la paleta; se añadieron comprobaciones de contraste de
  texto sólido. Esto no equivale a una auditoría completa de accesibilidad.

## Recorridos antes y después

Estimaciones leyendo los componentes, no sesiones cronometradas ni pruebas en
dispositivos físicos. Una interacción es un clic o cambio de campo; se excluyen
teclas, desplazamiento, latencia y autenticación. Las cifras dependen del escenario.

| Escenario | Antes | Ahora | Consecuencia |
| --- | --- | --- | --- |
| Gasto simple, pagador actual y todos participan | 4 | 6 | Seleccionar todos y revisar reemplazan la inclusión implícita; menos campos secundarios visibles, sin prometer menos clics |
| Crear invitado nuevo desde Personas | 2 | 3 | Elección explícita de nueva identidad; un homónimo suma una confirmación |
| Reutilizar invitado autorizado | 3 | 3 | Buscar, elegir candidato, agregar; mejor contexto de identidad |
| Asignar 8 productos a las mismas 8 personas | 64 casillas | 18 acciones | Abrir asignación conjunta, seleccionar 8 productos y 8 personas, aplicar; excluye ingreso y revisión de productos |
| Repetir producto con 8 consumidores | 11 | 1 | Duplicar copia los datos explícitos; la revisión sigue siendo necesaria |
| Pago administrativo rápido, datos ya completos | 4 | 3 con 012 | Abrir, confirmar revisión y enviar; texto adicional opcional |
| Cambiar sección del grupo | Desplazamiento variable | 1 enlace | Contenido principal acotado a la sección elegida |

Las confirmaciones personales y las barreras contra duplicar pagos no se acortaron
eliminando verificaciones. Consultar el resultado de un envío incierto sigue siendo
necesario antes de iniciar otra operación.

## Archivos de la implementación

- Navegación y datos: `app/(private)/grupos/[groupId]/page.tsx`,
  `app/(private)/grupos/[groupId]/finanzas/page.tsx`,
  `app/(private)/grupos/[groupId]/gastos/nuevo/page.tsx`,
  `features/groups/data.ts`, `features/groups/components/group-detail.tsx`,
  `group-navigation.tsx`, `group-people.tsx`, `group-settings.tsx`,
  `add-participant-form.tsx`, `groups-preview.tsx` en ese directorio de componentes.
- Formularios y finanzas: `lib/decimal-input.ts`,
  `features/finance/components/expense-form.tsx`, `expense-filters.tsx`, `views.tsx`,
  `features/groups/components/fields.tsx`,
  `features/smart-bills/components/expense-composer.tsx`, `smart-bill-form.tsx`,
  `features/smart-bills/ui-input.ts`.
- Pagos: `features/payments/types.ts`, `schemas.ts`, `operation-server.ts` y
  componentes `payment-form.tsx`, `quick-debt-actions.tsx`, `workspace.tsx`,
  `debt-board.tsx`; notificaciones: `features/notifications/types.ts`,
  `features/notifications/components.tsx`, `features/notifications/payment-actions.tsx`.
- Presentación: `features/overview/components/overview.tsx`,
  `components/layout/app-shell.tsx`, `components/ui/button.tsx`, `dialog.tsx`,
  `app/globals.css`, `features/groups/components/fields.tsx` y `action-form.tsx`.
- SQL y documentación: migración 012, `docs/bloque-2-motivo-administrativo.md`,
  este informe y `README.md`.
- Regresiones: pruebas de navegación, alcance de consultas, invitados, último
  administrador, estados vacíos, formularios financieros, decimales, cuenta
  inteligente, pagos rápidos/manuales, notificaciones, onboarding, contraste y SQL
  del motivo opcional en `tests/`.

## Migración pendiente

Aplicar **una sola vez**, después de 001–011, el archivo completo
`supabase/migrations/202611020012_optional_admin_reason.sql` en el SQL Editor del
proyecto correcto como propietario, después de revisarlo. No volver a ejecutar
migraciones anteriores. No hay nuevas variables de entorno.

La [guía de 012](bloque-2-motivo-administrativo.md) detalla los adaptadores,
compatibilidad e idempotencia. Sin 012 la aplicación conserva el requisito antiguo
del motivo. La migración agrega una constancia de auditoría cuando no hay texto
adicional; no reescribe pagos, saldos ni asignaciones existentes.

## Evidencia y límites

Las pruebas automatizadas comprueban componentes, acciones y migraciones en un
entorno local. No certifican la configuración del proyecto Supabase desplegado,
la existencia física de archivos ni el comportamiento en un teléfono real.
Validación final local: `npm run lint`, `npm run typecheck` y `npm run build`
terminaron correctamente. `npm test -- --reporter=dot`: **406 pruebas aprobadas,
40 omitidas**, 62 archivos aprobados y 7 omitidos. Las omitidas requieren
PostgreSQL real; las pruebas SQL ejecutadas utilizan PGlite. El test del tema
emite una advertencia de React sobre una etiqueta script en jsdom y pasa.

No se implementó guardado persistente de borradores: faltaría definir retención,
permisos y recuperación de datos sensibles. Cambiar entre modos del compositor
mantiene ambos formularios montados; la cuenta inteligente advierte al abandonar
la página mediante `beforeunload`. Esa advertencia no cubre toda navegación interna
de Next.js y no está garantizada por todos los navegadores móviles.

La búsqueda de invitados respeta el conjunto autorizado existente, que permite
reutilizar los creados por la cuenta actual. No amplía permisos por coincidencia
de nombre. Las pruebas de concurrencia que requieren PostgreSQL real permanecen
pendientes cuando no existe ese servicio local configurado.

## Pruebas manuales antes de beta

1. Con dos cuentas y un invitado, recorrer grupo, personas, gasto simple, cuenta
   por productos y saldos; comprobar identidad global compartida sin duplicar deuda.
2. Probar coma decimal, reparto personalizado, cambio de pagador y revisión
   invalidada tras cambiar importes. Editar un gasto anterior y revisar sus partes.
3. Buscar un homónimo, elegir identidad existente y crear deliberadamente una
   persona distinta; comprobar que otro grupo no cambia.
4. Aplicada 012, confirmar un pago administrativo con motivo vacío y breve;
   entre dos cuentas, comprobar que confirma el receptor. Rechazar/anular con motivo.
5. Simular respuesta perdida, recuperar el mismo ID y comprobar historial y saldo
   antes de registrar un segundo pago legítimo.
6. Abrir avisos y pendientes con distintas cuentas; verificar permisos, enlaces
   y saldos parciales, saldados y no verificables.
7. Revisar 320, 360, 768 y escritorio, temas claro/oscuro, zoom, teclado virtual,
   teclado físico, lector de pantalla, diálogos y nombres largos. No se hizo esta
   validación en dispositivos físicos durante el desarrollo.
8. Archivar/restaurar, abandonar como miembro y comprobar la protección del último
   administrador y del borrado de grupos con historial financiero.

## Próximas etapas propuestas, sin implementar

Para el Bloque 3: validar primero con usuarios reales estos recorridos y medir
abandono/errores sin registrar datos financieros privados; ejecutar concurrencia
en PostgreSQL y revisión manual de accesibilidad; definir borradores seguros y
sus permisos antes de persistirlos. Evaluar paginación con volumen real antes de
agregar consultas. La instalación PWA, offline, push y aplicación nativa requieren
otra etapa y decisiones de seguridad; no forman parte de este bloque.
