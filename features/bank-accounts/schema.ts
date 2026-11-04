import { z } from "zod";
export const banks=["Itaú","Santander","BROU","Prex","OCA Blue","Otro"] as const;
export const bankAccountSchema=z.object({id:z.uuid(),bank:z.enum(banks),holder:z.string().trim().min(2).max(120),identifier:z.string().trim().min(3).max(80).regex(/^[^\x00-\x1f\x7f]+$/),currency:z.enum(["UYU","USD"]),alias:z.string().trim().max(60),is_default:z.boolean()});
export type BankAccount=z.infer<typeof bankAccountSchema>;
export function compatibleAccounts(accounts:BankAccount[],currency:"UYU"|"USD"){return accounts.filter(a=>a.currency===currency).sort((a,b)=>Number(b.is_default)-Number(a.is_default));}
