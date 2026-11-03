export function notificationHref(value:unknown){
 if(typeof value!=="string")return "/notificaciones";
 const uuid="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
 return ["/pagos","/grupos","/gastos"].includes(value)||new RegExp(`^/(?:grupos|gastos)/${uuid}$`).test(value)||new RegExp(`^/pagos#pago-${uuid}$`).test(value)?value:"/notificaciones";
}
