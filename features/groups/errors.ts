const messages: Record<string, string> = {
  group_forbidden: "No tenés permiso para administrar este grupo.",
  authentication_required: "Necesitás una cuenta con email confirmado para continuar.",
  group_archived: "El grupo está archivado. Un administrador debe desarchivarlo antes de modificar participantes o aceptar invitaciones.",
  person_forbidden: "No tenés autorización para usar o modificar esa identidad.",
  member_exists: "Esa persona ya pertenece al grupo. Si está retirada, reactivala desde su ficha.",
  member_retired: "Tu participación está retirada. Una invitación genérica no puede reactivarla: pedile a un administrador que te reactive explícitamente.",
  invalid_member_state: "La combinación de rol y estado no es válida. Un administrador no puede estar pendiente de invitación.",
  last_admin: "El grupo necesita al menos un administrador activo. Promové a otra persona con cuenta antes de retirarte o cambiar tu rol.",
  admin_requires_account: "Solo una persona con cuenta puede ser administradora.",
  invitation_unavailable: "La invitación no está disponible o el enlace no es válido.",
  invitation_expired: "La invitación venció. Pedile un enlace nuevo al administrador.",
  invitation_revoked: "La invitación fue revocada. Pedile un enlace nuevo al administrador.",
  invitation_used: "La invitación ya fue utilizada por otra persona.",
  identity_unavailable: "No pudimos recuperar tu identidad global. Contactá al administrador de la aplicación.",
  invalid_input: "Revisá los datos de la operación.",
  correction_confirmation_required: "Confirmá explícitamente la identidad de reemplazo.",
  correction_source_unavailable: "Solo se puede corregir un invitado activo, sin cuenta y todavía no reemplazado.",
  correction_target_unavailable: "La identidad elegida ya está retirada, pendiente o reemplazada en este grupo. No se reactivará automáticamente.",
  correction_schema_changed: "Esta corrección previa a gastos está bloqueada: la base tiene tablas o referencias adicionales. No se reasignarán movimientos financieros ni datos de otro esquema.",
  correction_history_incompatible: "Hay historial o referencias incompatibles con una corrección simple. No se cambió ninguna membresía ni identidad.",
  membership_replaced: "Esta participación fue reemplazada y queda solo como historial. Administrá la identidad de reemplazo, sin reactivar el duplicado.",
};
export function groupError(error: { code?: string; message?: string }) {
  if (error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42P01") return "La base de grupos todavía no está disponible. Aplicá la migración de la Fase 3 indicada en la documentación.";
  if (error.message && messages[error.message]) return messages[error.message];
  if (error.code === "23505") return "La persona o invitación ya existe. Actualizá la página antes de reintentar.";
  if (error.code === "42501") return "No tenés autorización para realizar esta operación.";
  return "No pudimos completar la operación. Actualizá la página y volvé a intentar.";
}
