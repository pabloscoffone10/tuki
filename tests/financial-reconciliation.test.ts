// @vitest-environment node
// Deliberately unconstrained restore fixtures let the read-only diagnostic detect corruption.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach,afterEach,it,expect } from "vitest";
const sql=readFileSync("supabase/audits/financial_reconciliation.sql","utf8");
let db:PGlite;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
beforeEach(async()=>{
 db=new PGlite();await db.exec(`create schema storage;
 create table persons(id uuid);create table groups(id uuid);
 insert into persons values('${id(5)}'),('${id(6)}');insert into groups values('${id(2)}');
 create table payments(id uuid,amount_minor numeric,status text,payer_id uuid,receiver_id uuid,group_id uuid,scope text,confirmed_at timestamptz,confirmed_by uuid,approval_mode text);
 create table payment_allocations(payment_id uuid,obligation_id uuid,amount_minor numeric,reversed_at timestamptz,reversed_by uuid);
 create table obligations(id uuid,expense_id uuid,revision_id uuid,group_id uuid,debtor_id uuid,creditor_id uuid,amount_minor numeric,active boolean);
 create table expenses(id uuid,group_id uuid,status text,version int);
 create table expense_revisions(id uuid,expense_id uuid,version int,total_minor numeric,payer_id uuid,group_id uuid);
 create table expense_shares(revision_id uuid,amount_minor numeric,person_id uuid);
 create table payment_events(payment_id uuid,action text);
 create table smart_bill_revisions(revision_id uuid,upload_id uuid);
 create table ticket_uploads(id uuid,path text);create table storage.objects(id uuid,bucket_id text,name text);
 insert into expenses values('${id(1)}','${id(2)}','active',1);
 insert into expense_revisions values('${id(3)}','${id(1)}',1,80000,'${id(6)}','${id(2)}');
 insert into expense_shares values('${id(3)}',80000,'${id(5)}');
 insert into obligations values('${id(4)}','${id(1)}','${id(3)}','${id(2)}','${id(5)}','${id(6)}',80000,true);
 insert into payments values('${id(7)}',30000,'confirmed','${id(5)}','${id(6)}','${id(2)}','group',now(),'${id(6)}','counterparty');
 insert into payment_allocations values('${id(7)}','${id(4)}',30000,null,null);
 insert into payment_events values('${id(7)}','created'),('${id(7)}','confirm');`);
// Cold WASM startup can exceed 10s while the full SQL suite starts in parallel.
// Match the explicit initialization budget of the other PGlite fixtures.
},60000);
afterEach(async()=>{await db?.close();});
const issues=async()=>new Set((await db.query<{issue:string}>(sql)).rows.map(r=>r.issue));
it("returns no issue for a balanced partial payment and cannot mutate data",async()=>{await db.exec("begin transaction read only");expect(await issues()).toEqual(new Set());await db.exec("rollback");expect((await db.query<{n:number}>("select count(*)::int n from payments")).rows[0].n).toBe(1);});
it("detects missing allocations, over-allocation and partial reversal",async()=>{await db.exec("update payment_allocations set amount_minor=90000;update payments set status='void'");const found=await issues();expect(found.has("unconfirmed_payment_live_allocation")).toBe(true);expect(found.has("payment_allocations_exceed_amount")).toBe(true);await db.exec("update payments set status='confirmed';delete from payment_allocations");expect((await issues()).has("confirmed_payment_allocation_mismatch")).toBe(true);});
it("detects obligation overpayment, wrong parties, origin and inactive references",async()=>{await db.exec(`update payment_allocations set amount_minor=90000;update obligations set active=false,group_id='${id(9)}',debtor_id='${id(10)}'`);const found=await issues();for(const code of["obligation_overallocated","allocation_parties_or_scope_mismatch","confirmed_payment_inactive_obligation"])expect(found.has(code)).toBe(true);});
it("detects broken restore references, incorrect shares and missing current revision",async()=>{await db.exec("delete from obligations;update expense_shares set amount_minor=100;update expenses set version=2");const found=await issues();for(const code of["allocation_reference_missing","expense_revision_share_mismatch","expense_current_revision_missing"])expect(found.has(code)).toBe(true);});
it("detects duplicate audit events and missing ticket metadata",async()=>{await db.exec(`insert into payment_events values('${id(7)}','confirm');insert into smart_bill_revisions values('${id(3)}','${id(11)}')`);const found=await issues();expect(found.has("duplicate_financial_event")).toBe(true);expect(found.has("referenced_ticket_metadata_missing")).toBe(true);});
it("does not deduplicate distinct legitimate payments by amount or party",async()=>{await db.exec(`insert into payments select '${id(8)}',amount_minor,status,payer_id,receiver_id,group_id,scope,confirmed_at,confirmed_by,approval_mode from payments;insert into payment_allocations values('${id(8)}','${id(4)}',30000,null,null);insert into payment_events values('${id(8)}','created'),('${id(8)}','confirm')`);expect(await issues()).toEqual(new Set());});
it("detects missing parties and obligations that no longer match the versioned split",async()=>{await db.exec("delete from persons;update obligations set amount_minor=50000");const found=await issues();for(const code of["obligation_reference_missing","payment_reference_missing","obligation_share_mismatch"])expect(found.has(code)).toBe(true);});
it("detects a current split whose obligation was incorrectly deactivated",async()=>{await db.exec("delete from payment_allocations;delete from payment_events;delete from payments;update obligations set active=false");const found=await issues();expect(found.has("current_share_active_obligation_missing")).toBe(true);expect(found.has("expense_share_obligation_missing")).toBe(false);});
it("detects fractional centesimos even when every financial total agrees",async()=>{await db.exec("update expense_revisions set total_minor=80000.5;update expense_shares set amount_minor=80000.5;update obligations set amount_minor=80000.5;update payments set amount_minor=30000.5;update payment_allocations set amount_minor=30000.5");const found=await issues();expect(found.has("financial_minor_invalid")).toBe(true);expect(found.has("confirmed_payment_allocation_mismatch")).toBe(false);expect(found.has("expense_revision_share_mismatch")).toBe(false);});
it("detects a missing terminal audit event without flagging a valid reversed payment",async()=>{await db.exec(`update payments set status='void';update payment_allocations set reversed_at=now(),reversed_by='${id(6)}'`);expect((await issues()).has("payment_terminal_audit_event_missing")).toBe(true);await db.exec(`insert into payment_events values('${id(7)}','void')`);expect(await issues()).toEqual(new Set());});
it("detects restored orphan revision and share references even with no debt obligations",async()=>{await db.exec(`delete from payment_allocations;delete from payment_events;delete from payments;delete from obligations;delete from expenses;update expense_shares set person_id='${id(12)}'`);const found=await issues();expect(found.has("expense_revision_reference_missing")).toBe(true);expect(found.has("expense_share_reference_missing")).toBe(true);});
it("detects non-finite monetary values in an unconstrained restore",async()=>{await db.exec("update payments set amount_minor='NaN';update payment_allocations set amount_minor='NaN';update obligations set amount_minor='Infinity';update expense_revisions set total_minor='Infinity';update expense_shares set amount_minor='Infinity'");expect((await issues()).has("financial_minor_invalid")).toBe(true);});
