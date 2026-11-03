export type PaymentOperation={id:string;state:"prepared"|"processed"|"rejected"|"cancelled";payment_status?:"pending"|"confirmed"|"rejected"|"void";version?:number;error_code?:string;created_at?:string;summary?:{payer_name:string;receiver_name:string;amount:string;date:string;method:string;group_name?:string|null;administrative?:boolean;received?:boolean;reason?:string|null}};
export type OperationReply={operation?:PaymentOperation|null;error?:string;success?:string;unknown?:boolean};
export function operationMessage(op:PaymentOperation){
 if(op.state==="cancelled")return "Intento cancelado sin registrar un pago.";
 if(op.state==="prepared")return "Operación preparada y no enviada al motor financiero. Podés enviar este mismo intento o cancelarlo de forma segura.";
 if(op.state==="rejected")return "El intento no pudo registrarse. No creó un pago. Revisá el motivo antes de iniciar otra operación.";
 return op.payment_status==="confirmed"?"Pago confirmado. Se identificó la operación original y el saldo se actualizó una sola vez.":op.payment_status==="pending"?"Pago registrado, esperando confirmación. Todavía no reduce la deuda.":op.payment_status==="rejected"?"El receptor rechazó el pago. La deuda se conserva.":op.payment_status==="void"?"Este pago fue anulado. Su historial se conserva.":"Operación procesada. Consultá el estado actual del pago.";
}
