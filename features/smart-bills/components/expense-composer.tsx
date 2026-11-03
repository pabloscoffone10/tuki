"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/features/finance/components/expense-form";
import type { FinancePerson } from "@/features/finance/types";
import { SmartBillForm } from "./smart-bill-form";
export function ExpenseComposer(props:{id:string;groupId:string;people:FinancePerson[];aiAvailable:boolean;currentPersonId?:string}){
 const [mode,setMode]=useState("normal");return <div className="space-y-6"><div className="flex flex-wrap gap-3" aria-label="Tipo de gasto"><Button type="button" variant={mode==="normal"?"default":"outline"} onClick={()=>setMode("normal")}>Gasto normal</Button><Button type="button" variant={mode==="smart"?"default":"outline"} onClick={()=>setMode("smart")}>Cuenta inteligente</Button></div><div hidden={mode!=="normal"}><ExpenseForm {...props}/></div><div hidden={mode!=="smart"}><SmartBillForm {...props}/></div></div>;
}
