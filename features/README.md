# Módulos

- `overview/`: resumen visual sin datos financieros ni persistencia.
- `workspace/`: estados de las secciones aún no implementadas.
- `auth/`: acceso de cuenta, callbacks PKCE, validaciones y perfil propio.
- `groups/`: grupos, identidades globales, invitados e invitaciones persistidos
  en Supabase, con autorización y transacciones en PostgreSQL.

Las fases siguientes incorporarán el dominio financiero, gastos y
pagos. El dominio financiero puro tendrá su propio módulo independiente de
React y Supabase en la Fase 4. No crear lógica monetaria en los componentes.
