const messages:Record<string,string>={
 beta_currency_uyu_only:"Durante la beta, las operaciones nuevas son únicamente en UYU, sin conversión.",beta_historical_currency_locked:"La moneda y la cotización históricas deben conservarse; no se puede convertir este gasto durante la beta.",
 expense_has_confirmed_payments:"Este gasto incluye personas con pagos confirmados entre sí. Antes de editarlo o anularlo, las personas autorizadas deben anular esos pagos. El historial se conserva.",
 invalid_bill:"Revisá los productos, cantidades y cargos de la cuenta.",bill_unassigned:"Hay productos o cargos sin asignar.",bill_quantities:"Las cantidades asignadas deben sumar la cantidad del producto.",bill_negative:"Un descuento deja un consumo negativo.",bill_confirmation_required:"Confirmá la revisión de la cuenta.",bill_review_required:"Revisá y confirmá los campos dudosos.",bill_total_mismatch:"El total del ticket no coincide. Corregí los datos o agregá un redondeo explícito.",bill_total_required:"Ingresá el total del ticket o explicá por qué no es legible.",bill_document_required:"Editá esta cuenta desde el editor de productos para conservar su desglose.",bill_ticket_unavailable:"El ticket privado no está disponible para esta cuenta.",
 expense_conflict:"El gasto cambió o ya fue anulado. Recargá la página antes de volver a editarlo.",
 expense_forbidden:"No tenés permiso para consultar o modificar este gasto.",
 group_forbidden:"Ya no tenés acceso activo a este grupo.",group_archived:"El grupo está archivado. Desarchivalo antes de cargar o editar gastos.",
 invalid_decimal:"Ingresá importes con punto decimal y la precisión indicada.",invalid_expense:"Revisá el importe, la moneda y la cotización.",invalid_split:"El reparto debe sumar exactamente el total en UYU o el 100%. Las cantidades deben ser positivas.",
 invalid_participant:"Uno de los participantes ya no está disponible. Recargá la página.",invalid_receipt:"El comprobante debe ser PNG, JPEG o PDF válido de hasta 512 KiB.",confirmation_required:"Confirmá la operación antes de continuar.",
 group_has_financial_history:"Este grupo tiene historial financiero, aunque sus gastos estén anulados. Podés archivarlo para conservarlo.",
 last_admin:"Debe quedar al menos un administrador activo.",person_forbidden:"No tenés permiso para modificar esta identidad.",person_referenced:"Esta identidad tiene referencias de membresía, invitaciones o historial y debe conservarse.",removal_schema_changed:"La estructura de datos cambió. La eliminación está bloqueada hasta revisar sus referencias.",
};
export function financeError(error:{message?:string;code?:string}){
 if(error.code==="PGRST202"||error.code==="42P01") return "Falta aplicar las migraciones 004 y 005 de la Fase 4 en Supabase.";
 const match=Object.keys(messages).find(key=>error.message===key);
 if(match)return messages[match];
 if(error.code==="23503")return "Hay referencias históricas que impiden eliminar este registro.";
 if(error.code==="23514"||error.code==="22007"||error.code==="22008"||error.code==="22P02"||error.code==="23502") return "Revisá los datos: hay un valor inválido o incompleto.";
 return "No pudimos completar la operación. Reintentá y, si continúa, revisá las migraciones de la Fase 4.";
}
