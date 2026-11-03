import "server-only";
import { requireUser } from "@/features/auth/session";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { financeError } from "./errors";
import type { ExpenseDetail, ExpenseRow, FinanceSummary } from "./types";
import type { Obligation } from "./domain";
export async function financeRpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
 await requireUser();const client=await createReadOnlyClient();const {data,error}=await client.rpc(name,args);
 if(error)throw new Error(financeError(error));return data as T;
}
export const listExpenses=(groupId?:string)=>financeRpc<ExpenseRow[]>("tuki_list_expenses",{p_group_id:groupId??null});
export async function expenseDetail(id:string){
 const detail=await financeRpc<ExpenseDetail>("tuki_expense_detail",{p_id:id});const client=await createReadOnlyClient();
 const ids=detail.history.map(h=>h.id);const {data,error}=await client.from("smart_bill_revisions").select("revision_id,document,upload_id").in("revision_id",ids);
 if(error&&!["42P01","PGRST205"].includes(error.code))throw new Error(financeError(error));
 if(data){detail.smartHistory=data;const current=detail.history.find(h=>h.version===detail.version);detail.smartBill=data.find(s=>s.revision_id===current?.id)?.document;}
 return detail;
}
export const groupFinances=(id:string)=>financeRpc<FinanceSummary>("tuki_group_finances",{p_group_id:id});
export async function personalFinances(){
 const user=await requireUser();const client=await createReadOnlyClient();
 const [{data:person,error},obligations]=await Promise.all([client.from("persons").select("id").eq("user_id",user.id).single(),financeRpc<Obligation[]>("tuki_my_obligations")]);
 if(error)throw new Error(financeError(error));return {personId:person.id as string,obligations};
}
