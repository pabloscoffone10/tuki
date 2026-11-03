import { netPairs } from "@/features/finance/domain";
import type { PairState,PaymentWorkspace } from "./types";
export const pairKey=(a:string,b:string)=>[a,b].sort().join(":");
export function debtStates(data:PaymentWorkspace):PairState[]{
 if(data.pair_states)return data.pair_states;
 // Missing rows on an older server can NEVER prove a zero balance.
 const rows:PairState[]=netPairs(data.obligations).map(p=>({payer_id:p.debtor,receiver_id:p.creditor,payer_name:p.debtorName,receiver_name:p.creditorName,state:"pending",remaining_minor:p.amount.toString(),scope:"global",pending_payment:data.payments.some(x=>x.status==="pending"&&pairKey(x.payer_id,x.receiver_id)===pairKey(p.debtor,p.creditor))}));
 const seen=new Set(rows.map(p=>pairKey(p.payer_id,p.receiver_id)));
 for(const p of data.payments){const key=pairKey(p.payer_id,p.receiver_id);if(!seen.has(key)){seen.add(key);rows.push({payer_id:p.payer_id,receiver_id:p.receiver_id,payer_name:p.payer_name,receiver_name:p.receiver_name,state:"unverifiable",remaining_minor:null,scope:"unverifiable",pending_payment:data.payments.some(x=>x.status==="pending"&&pairKey(x.payer_id,x.receiver_id)===key)});}}
 return rows;
}
