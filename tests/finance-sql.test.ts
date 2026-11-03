// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
let db:PGlite;
let corrected:{group:string;payer:string;guest:string;target:string};
let correctedEmpty:{group:string;payer:string;guest:string;target:string};
const a="00000000-0000-4000-8000-000000000001", b="00000000-0000-4000-8000-000000000002";
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb not null default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
 insert into auth.users(id,email_confirmed_at) values('${a}',now()),('${b}',now());`);
 for(const file of readdirSync("supabase/migrations").filter(x=>x.endsWith(".sql")&&x<="202611020005_safe_removal.sql").sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
  if(file.startsWith("202611020003")){
   const prepare=async()=>{const f=await fixture(),target=await rpc("tuki_add_guest",[f.group,"Existing Mati",null]);await rpc("tuki_replace_guest",[f.group,f.guest,target,true]);return {...f,target};};
   corrected=await prepare();correctedEmpty=await prepare();
  }
 }
},60000);
afterAll(async()=>{await db?.close();});
async function query<T=Record<string,unknown>>(sql:string,args:unknown[]=[],user=a){return db.transaction(async tx=>{await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return tx.query<T>(sql,args);});}
async function rpc<T=string>(name:string,args:unknown[]=[],user=a){return (await query<{v:T}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args,user)).rows[0].v;}
async function fixture(){const group=await rpc("tuki_create_group",["Juana","","permanent"]);const payer=await rpc("tuki_ensure_person");const guest=await rpc("tuki_add_guest",[group,"Mati",null]);return {group,payer,guest};}
function payload(payer:string,guest:string,extra:Record<string,unknown>={}){return {title:"Cena",notes:"private notes",date:"2026-11-02",category:"food",currency:"UYU",amount:"100.01",rate:"1",payerId:payer,method:"equal",shares:[{personId:payer,input:"1"},{personId:guest,input:"1"}],...extra};}
const save=(id:string,g:string,p:unknown,v=0,user=a)=>rpc("tuki_save_expense",[id,g,v,JSON.stringify(p)],user);
it("persists exact equal shares, one obligation, ledger and idempotent creation",async()=>{
 const {group,payer,guest}=await fixture(),id=randomUUID(),p=payload(payer,guest);
 await save(id,group,p);expect(await save(id,group,p)).toBe(id);
 const shares=await query<{n:string}>("select s.amount_minor::text n from expense_shares s join expense_revisions r on r.id=s.revision_id where r.expense_id=$1",[id]);
 expect(shares.rows.reduce((n,s)=>n+BigInt(s.n),0n)).toBe(10001n);
 const data=await rpc<{obligations:unknown[];ledger:unknown[]}>("tuki_group_finances",[group]);expect(data.obligations).toHaveLength(1);expect(data.ledger).toHaveLength(2);
 expect((await query("select * from expenses where id=$1",[id],b)).rows).toHaveLength(0);
 await expect(query("delete from expenses where id=$1",[id])).rejects.toThrow(/permission denied/);
});
it("supports payer excluded, exact FX and proportional units",async()=>{
 const {group,payer,guest}=await fixture(),id=randomUUID();await save(id,group,payload(payer,guest,{currency:"USD",amount:"2.01",rate:"40.123456",method:"units",shares:[{personId:guest,input:"3.5"}]}));
 const detail=await rpc<{total_minor:string;rate:string}>("tuki_expense_detail",[id]);expect(detail.total_minor).toBe("8065");expect(detail.rate).toBe("40.123456");
 expect((await query<{n:string}>("select amount_minor::text n from obligations where expense_id=$1 and active",[id])).rows[0].n).toBe("8065");
});
it("rejects invalid splits, participants, precision and missing consent transactionally",async()=>{
 const {group,payer,guest}=await fixture();
 for(const extra of [{method:"percent"},{method:"custom"},{amount:"1.001"},{payerId:randomUUID()},{shares:[]}]) await expect(save(randomUUID(),group,payload(payer,guest,extra))).rejects.toThrow();
 expect((await query("select * from expenses where group_id=$1",[group])).rows).toHaveLength(0);
 await expect(rpc("tuki_delete_group",[group,false])).rejects.toThrow("confirmation_required");
});
it("keeps edits immutable, invalidates old obligations and detects stale edits",async()=>{
 const {group,payer,guest}=await fixture(),id=randomUUID();await save(id,group,payload(payer,guest));await save(id,group,payload(payer,guest,{amount:"20"}),1);
 expect((await query("select * from expense_revisions where expense_id=$1",[id])).rows).toHaveLength(2);
 expect((await query("select * from obligations where expense_id=$1 and active",[id])).rows).toHaveLength(1);
 await expect(save(id,group,payload(payer,guest),1)).rejects.toThrow("expense_conflict");
 await rpc("tuki_void_expense",[id,2,true]);expect((await query("select * from obligations where expense_id=$1 and active",[id])).rows).toHaveLength(0);
 expect((await rpc<{status:string;history:unknown[]}>("tuki_expense_detail",[id])).status).toBe("void");
 await expect(rpc("tuki_delete_group",[group,true])).rejects.toThrow("group_has_financial_history");
});
it("projects only minimal global debt into shared groups, including archived origins",async()=>{
 const {group,payer,guest}=await fixture(),g2=await rpc("tuki_create_group",["Piria Halloween","","temporary"]),id=randomUUID();
 await rpc("tuki_add_guest",[g2,null,guest]);await save(id,group,payload(payer,guest));await rpc("tuki_archive_group",[group,true]);
 const summary=await rpc<{obligations:Record<string,string>[];ledger:unknown[]}>("tuki_group_finances",[g2]);expect(summary.obligations).toHaveLength(1);expect(summary.ledger).toHaveLength(0);
 expect(summary.obligations[0].origin_group_id).toBe(group);expect(summary.obligations[0]).not.toHaveProperty("expense_id");expect(JSON.stringify(summary)).not.toContain("private notes");
 await rpc("tuki_set_member",[g2,guest,"member","retired"]);expect((await rpc<{obligations:unknown[]}>("tuki_group_finances",[g2])).obligations).toHaveLength(0);
});
it("does not reveal origin details or receipts to recipient-only members",async()=>{
 const {group,payer,guest}=await fixture(),g2=await rpc("tuki_create_group",["Otro","","permanent"]),id=randomUUID();await rpc("tuki_add_guest",[g2,null,guest]);
 const token="a".repeat(64);await rpc("tuki_create_invitation",[g2,createHash("sha256").update(token).digest("hex"),72]);await rpc("tuki_accept_invitation",[token],b);
 await save(id,group,payload(payer,guest,{receipt:{mime:"application/pdf",name:"ticket.pdf",data:Buffer.from("%PDF-test").toString("base64")}}));
 expect((await rpc<{obligations:unknown[]}>("tuki_group_finances",[g2],b)).obligations).toHaveLength(1);
 await expect(rpc("tuki_expense_detail",[id],b)).rejects.toThrow("expense_forbidden");
 expect((await query("select receipt_data from expense_revisions where expense_id=$1",[id],b)).rows).toHaveLength(0);
});
it("permits only author/admin edits and rejects receipts with spoofed content",async()=>{
 const {group,payer,guest}=await fixture(),id=randomUUID(),token="b".repeat(64);await rpc("tuki_create_invitation",[group,createHash("sha256").update(token).digest("hex"),72]);await rpc("tuki_accept_invitation",[token],b);
 await save(id,group,payload(payer,guest));await expect(save(id,group,payload(payer,guest),1,b)).rejects.toThrow("expense_forbidden");
 await expect(save(randomUUID(),group,payload(payer,guest,{receipt:{mime:"image/png",data:Buffer.from("fake").toString("base64")}}))).rejects.toThrow("invalid_receipt");
});
it("physically deletes only financially pristine groups and preserves people",async()=>{
 const {group,guest}=await fixture();await rpc("tuki_delete_group",[group,true]);expect((await query("select * from groups where id=$1",[group])).rows).toHaveLength(0);
 expect((await query("select * from persons where id=$1",[guest])).rows).toHaveLength(1);await rpc("tuki_delete_orphan_guest",[guest,true]);expect((await query("select * from persons where id=$1",[guest])).rows).toHaveLength(0);
});
it("removes an unused membership, retires financial participants, protects the last admin",async()=>{
 const {group,payer,guest}=await fixture();const unused=await rpc("tuki_add_guest",[group,"Guille",null]);expect(await rpc("tuki_remove_member",[group,unused,true])).toBe("removed");
 await expect(rpc("tuki_delete_orphan_guest",[unused,true])).rejects.toThrow("person_referenced");
 await save(randomUUID(),group,payload(payer,guest));expect(await rpc("tuki_remove_member",[group,guest,true])).toBe("retired");
 await expect(rpc("tuki_remove_member",[group,payer,true])).rejects.toThrow("last_admin");await expect(rpc("tuki_delete_orphan_guest",[payer,true])).rejects.toThrow("person_forbidden");
});
it("blocks the pre-financial correction after financial schema installation",async()=>{
 const {group,guest}=await fixture(),target=await rpc("tuki_add_guest",[group,"Mati",null]);await expect(rpc("tuki_replace_guest",[group,guest,target,true])).rejects.toThrow("correction_schema_changed");
});
it("hardens every new RPC and private helper",async()=>{
 const rows=await db.query<{proname:string;prosecdef:boolean;proconfig:string[];anon:boolean}>("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tuki_save_expense','tuki_void_expense','tuki_group_finances','tuki_my_obligations','tuki_expense_detail','tuki_list_expenses','tuki_delete_group','tuki_remove_member','tuki_delete_orphan_guest','tuki_finance_activity')");
 expect(rows.rows).toHaveLength(10);for(const row of rows.rows){expect(row.prosecdef).toBe(true);expect(row.proconfig).toContain('search_path=""');expect(row.anon).toBe(false);}
});
it("uses exact successful SQL percentage and custom allocations",async()=>{
 const {group,payer,guest}=await fixture();
 for(const [method,inputs] of [["percent",["33.3333","66.6667"]],["custom",["33.34","66.67"]]] as const){
  const id=randomUUID();await save(id,group,payload(payer,guest,{method,shares:[{personId:payer,input:inputs[0]},{personId:guest,input:inputs[1]}]}));
  const detail=await rpc<{shares:{personId:string;amount_minor:string;input_value:string}[]}>("tuki_expense_detail",[id]);
  expect(detail.shares.reduce((n,s)=>n+BigInt(s.amount_minor),0n)).toBe(10001n);
  for(const s of detail.shares)expect(()=>BigInt(s.input_value)).not.toThrow();
  if(method==="custom")expect(detail.shares.find(s=>s.personId===payer)?.amount_minor).toBe("3334");
 }
});
it("never allows a null optimistic version to overwrite or void",async()=>{
 const {group,payer,guest}=await fixture(),id=randomUUID();await save(id,group,payload(payer,guest));
 await expect(rpc("tuki_save_expense",[id,group,null,JSON.stringify(payload(payer,guest))])).rejects.toThrow("expense_conflict");
 await expect(rpc("tuki_void_expense",[id,null,true])).rejects.toThrow("expense_conflict");
});
it("preserves corrected 003 identities and never reactivates the historical source",async()=>{
 const {group,payer,guest,target}=corrected;
 await expect(rpc("tuki_set_member",[group,guest,"member","active"])).rejects.toThrow("membership_replaced");
 await expect(save(randomUUID(),group,payload(payer,guest))).rejects.toThrow("invalid_participant");
 await save(randomUUID(),group,payload(payer,target));expect(await rpc("tuki_remove_member",[group,guest,true])).toBe("retired");
 expect((await query<{id:string}>("select replaced_by_person_id id from group_members where group_id=$1 and person_id=$2",[group,guest])).rows[0].id).toBe(target);
 await rpc("tuki_delete_group",[correctedEmpty.group,true]);
 expect((await query("select * from persons where id in ($1,$2)",[correctedEmpty.guest,correctedEmpty.target])).rows).toHaveLength(2);
});
it("preserves other groups and all previous financial participants after editing",async()=>{
 const {group,payer,guest}=await fixture(),other=await rpc("tuki_create_group",["Other","","permanent"]),id=randomUUID();await rpc("tuki_add_guest",[other,null,guest]);
 await save(id,group,payload(payer,guest));await save(id,group,payload(payer,guest,{shares:[{personId:payer,input:"1"}]}),1);
 expect(await rpc("tuki_remove_member",[group,guest,true])).toBe("retired");
 expect((await query<{status:string}>("select status from group_members where group_id=$1 and person_id=$2",[other,guest])).rows[0].status).toBe("active");
 await expect(rpc("tuki_delete_orphan_guest",[guest,true])).rejects.toThrow("person_referenced");
});
it("allows historical retired people in edits but not in new expenses",async()=>{
 const {group,payer,guest}=await fixture(),id=randomUUID();await save(id,group,payload(payer,guest));await rpc("tuki_set_member",[group,guest,"member","retired"]);
 await save(id,group,payload(payer,guest,{amount:"50"}),1);
 await expect(save(randomUUID(),group,payload(payer,guest))).rejects.toThrow("invalid_participant");
 await rpc("tuki_archive_group",[group,true]);await expect(save(id,group,payload(payer,guest),2)).rejects.toThrow("group_archived");await rpc("tuki_void_expense",[id,2,true]);
});
it("refuses unauthorized deletions and future schema changes",async()=>{
 const {group,guest}=await fixture();await expect(rpc("tuki_delete_group",[group,true],b)).rejects.toThrow("group_forbidden");
 await expect(rpc("tuki_remove_member",[group,guest,true],b)).rejects.toThrow("group_forbidden");await expect(rpc("tuki_delete_orphan_guest",[guest,true],b)).rejects.toThrow("person_forbidden");
 await db.exec("create table public.future_payments(id uuid primary key)");
 try{await expect(rpc("tuki_delete_group",[group,true])).rejects.toThrow("removal_schema_changed");expect(await rpc("tuki_remove_member",[group,guest,true])).toBe("retired");}finally{await db.exec("drop table public.future_payments");}
});
it("does not expose audit sequences or removal helpers",async()=>{
 for(const name of ["expense_events_id_seq","lifecycle_audit_id_seq"]){const result=await db.query<{allowed:boolean}>("select has_sequence_privilege('authenticated',$1,'USAGE,SELECT,UPDATE') allowed",[`public.${name}`]);expect(result.rows[0].allowed).toBe(false);}
 const result=await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','tuki_private.removal_schema_known()','EXECUTE') allowed");expect(result.rows[0].allowed).toBe(false);
});
