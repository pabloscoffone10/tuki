import "server-only";
import { requireUser } from "@/features/auth/session";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { paymentError } from "./errors";
import type { PaymentWorkspace } from "./types";
export async function paymentWorkspace(groupId?:string){await requireUser();const client=await createReadOnlyClient();const {data,error}=await client.rpc("tuki_payment_workspace",{p_group_id:groupId??null});if(error)throw Error(paymentError(error));return data as PaymentWorkspace;}
