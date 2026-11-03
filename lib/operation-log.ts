import "server-only";
// Deliberately never log exceptions, request payloads, user IDs, tokens or amounts.
export function operationLog(operation:"payment_prepare"|"payment_submit"|"payment_lookup"|"payment_resolve"|"payment_transition",reference:string,code?:string){
 const safeReference=/^[a-f0-9-]{36}$/i.test(reference)?reference:"unavailable";
 const safeCode=code&&/^[A-Z0-9_]{2,24}$/.test(code)?code:"UNKNOWN_RESULT";
 console.warn(JSON.stringify({event:"tuki_operation",operation,reference:safeReference,code:safeCode}));
}
