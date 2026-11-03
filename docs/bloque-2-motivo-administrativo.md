# Bloque 2: motivo administrativo adicional opcional

La interfaz por sí sola no podía volver opcional este campo: la política 009
exigía al menos ocho caracteres y una restricción conserva ese requisito para la
constancia de auditoría. No se cambian esas migraciones ni el motor financiero.

`202611020012_optional_admin_reason.sql` agrega adaptadores antes de las funciones
existentes. La RPC de preparación normaliza únicamente la explicación administrativa:

- Vacía, espacios o ausente: constancia automática «Confirmación administrativa
  registrada sin motivo adicional.».
- Entre uno y siete caracteres: «Motivo indicado: …», conservando el texto escrito.
- Ocho o más caracteres: texto original sin cambios, para preservar los hashes de
  operaciones ya registradas y su idempotencia.

Las autorizaciones, saldo, asignaciones, centésimos, confirmación del receptor,
reversión e historial continúan en el mismo motor. La constancia automática no
afirma que exista una prueba bancaria: siguen registrándose responsable, fecha,
importe, método, grupo y evento administrativo por los mecanismos existentes.

La confirmación de una solicitud pendiente normaliza el texto solo cuando quien
actúa es un administrador autorizado para ese pago con invitados y no está
declarando su recepción personal. Se mantienen íntegros los chequeos de versión,
permisos e idempotencia. Rechazar y anular **siguen requiriendo motivo**.

El cambio no habilita a ningún administrador a confirmar pagos entre dos cuentas
registradas ni a imputar obligaciones privadas de un grupo ajeno.

## Aplicación

1. Verificar que 001–011 estén aplicadas en el proyecto correcto.
2. Revisar y respaldar según la guía operativa existente.
3. Pegar el contenido completo de la migración 012 en SQL Editor y ejecutarlo una
   sola vez como propietario. No ejecutar fragmentos ni volver a aplicar 001–011.
4. Actualizar la aplicación y recargar. No hay nuevas variables de entorno.

No se ejecutó SQL remoto desde el desarrollo ni se alteraron datos existentes.
La migración no actualiza saldos, pagos ni asignaciones. Los helpers/adaptadores
internos quedan sin EXECUTE para `anon` y `authenticated`; las RPC públicas
conservan el acceso de cuentas autenticadas.

El workspace devuelve `optional_admin_reason: true`. El inbox agrega esa misma
capacidad a su respuesta y a cada aviso, sin una llamada adicional del navegador.
La interfaz puede mantener el requisito antiguo si ese indicador todavía no existe.

## Compatibilidad y recuperación

Los intentos anteriores conservan su payload, hash y resultado. Un intento
preparado antes de 012 con texto entonces inválido no se convierte silenciosamente
en un pago: puede terminar rechazado con su motivo original. Se debe consultar el
resultado, reconocerlo y luego iniciar explícitamente otro intento si corresponde.
No se crea automáticamente otro pago ante una respuesta perdida.

Dos pagos reales con igual importe continúan siendo posibles después de reconocer
el resultado del primero. La nueva normalización no deduplica por importe, fecha,
grupo o nombres.

## Validación

`tests/optional-admin-reason-sql.test.ts` aplica las migraciones en PGlite y cubre
constancia automática, explicación breve, compatibilidad pre-012, respuestas
perdidas, reintentos con el mismo ID, segundo pago legítimo, confirmación de
pendientes, rechazo de terceros, receptor personal y permisos internos. Esto no
certifica la configuración desplegada ni la concurrencia real de PostgreSQL.

Prueba manual recomendada: en una deuda con invitado, registrar un pago sin texto
adicional, comprobar constancia y saldo; repetir con texto corto y pago parcial.
Entre dos cuentas, verificar que solo confirme el receptor. Simular una respuesta
perdida y recuperar el mismo ID antes de iniciar un pago nuevo.
