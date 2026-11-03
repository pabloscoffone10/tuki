import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({save:vi.fn()}));
vi.mock("@/features/finance/actions",()=>({saveExpense:mocks.save}));
import { ExpenseForm } from "@/features/finance/components/expense-form";
import type { ExpenseDetail } from "@/features/finance/types";
const one="00000000-0000-4000-8000-000000000001",two="00000000-0000-4000-8000-000000000002";
const people=[{id:one,name:"Mati",status:"active",replaced:false},{id:two,name:"Pablo",status:"active",replaced:false}];
beforeEach(()=>{vi.resetAllMocks();mocks.save.mockResolvedValue({error:"Test response"});});
it("defaults to the authenticated payer without silently assigning all members",()=>{
 render(<ExpenseForm id={one} groupId={two} people={people} currentPersonId={two}/>);expect(screen.getByLabelText("Pagó")).toHaveValue(two);expect(screen.getByRole("checkbox",{name:"Mati"})).not.toBeChecked();expect(screen.getByRole("checkbox",{name:"Pablo"})).not.toBeChecked();expect(screen.queryByLabelText("Moneda")).not.toBeInTheDocument();expect(screen.getByLabelText("Comprobante privado (PNG, JPEG o PDF; hasta 512 KiB)")).not.toBeVisible();
});
it("previews exact shares, supports excluded payer and percentage validation",async()=>{
 const user=userEvent.setup();render(<ExpenseForm id={one} groupId={two} people={people} currentPersonId={one}/>);
 await user.type(screen.getByLabelText("Importe en UYU"),"100,01");await user.click(screen.getByRole("button",{name:"Seleccionar participantes activos"}));expect(screen.getByText(/Total: \$ 100,01 UYU/)).toBeVisible();expect(screen.getByText("$ 50,01 UYU")).toBeVisible();expect(screen.getByText("$ 50,00 UYU")).toBeVisible();
 await user.click(screen.getByRole("checkbox",{name:"Mati"}));expect(screen.getAllByText("$ 100,01 UYU")).toHaveLength(1);
 await user.selectOptions(screen.getByLabelText("Reparto"),"percent");expect(screen.getByText(/El reparto no coincide/)).toBeVisible();await user.clear(screen.getByLabelText("Porcentaje de Pablo"));await user.type(screen.getByLabelText("Porcentaje de Pablo"),"100");expect(screen.queryByText(/El reparto no coincide/)).not.toBeInTheDocument();
});
it("requires explicit review and submits canonical decimals while resetting review on changes",async()=>{
 const user=userEvent.setup();render(<ExpenseForm id={one} groupId={two} people={people} currentPersonId={two}/>);await user.type(screen.getByLabelText("Descripción"),"Cancha");await user.type(screen.getByLabelText("Importe en UYU"),"125,50");await user.click(screen.getByRole("checkbox",{name:"Pablo"}));
 const review=screen.getByRole("checkbox",{name:/Revisé quiénes/});await user.click(screen.getByRole("button",{name:"Crear gasto"}));expect(mocks.save).not.toHaveBeenCalled();await user.click(review);await user.type(screen.getByLabelText("Importe en UYU"),"0");expect(review).not.toBeChecked();await user.clear(screen.getByLabelText("Importe en UYU"));await user.type(screen.getByLabelText("Importe en UYU"),"125,50");await user.click(review);await user.click(screen.getByRole("button",{name:"Crear gasto"}));await waitFor(()=>expect(mocks.save).toHaveBeenCalled());const form=mocks.save.mock.calls[0][1] as FormData;expect(form.get("amount")).toBe("125.50");expect(form.get("payerId")).toBe(two);expect(JSON.parse(String(form.get("shares")))).toEqual([{personId:two,input:"1"}]);
});
it("preserves recorded payer and historical participants when editing",()=>{
 const initial={payer_id:one,currency:"UYU",rate:"1",original_minor:"10000",method:"equal",shares:[{personId:one,input_value:"1"}],title:"Original",notes:"",category:"other",date:"2026-11-03",version:2} as ExpenseDetail;
 render(<ExpenseForm id={one} groupId={two} people={[{...people[0],status:"retired"},people[1]]} currentPersonId={two} initial={initial}/>);expect(screen.getByLabelText("Pagó")).toHaveValue(one);expect(screen.getByRole("checkbox",{name:"Mati (histórico)"})).toBeChecked();expect(screen.getByRole("checkbox",{name:"Pablo"})).not.toBeChecked();
});
it("retains custom and proportional splits while new beta expenses have no foreign currency controls",async()=>{
 const user=userEvent.setup();render(<ExpenseForm id={one} groupId={two} people={people} currentPersonId={one}/>);await user.type(screen.getByLabelText("Importe en UYU"),"10");await user.click(screen.getByRole("checkbox",{name:"Mati"}));await user.selectOptions(screen.getByLabelText("Reparto"),"custom");await user.clear(screen.getByLabelText("Importe UYU de Mati"));await user.type(screen.getByLabelText("Importe UYU de Mati"),"10,00");expect(screen.queryByText(/El reparto no coincide/)).not.toBeInTheDocument();await user.selectOptions(screen.getByLabelText("Reparto"),"units");expect(screen.getByLabelText("Cantidad de Mati")).toBeVisible();await user.click(screen.getByText("Más opciones: fecha y comprobante"));expect(screen.queryByLabelText("Moneda")).not.toBeInTheDocument();expect(screen.queryByLabelText("1 unidad equivale a UYU")).not.toBeInTheDocument();expect(screen.getByText(/Moneda: UYU/)).toBeVisible();
});
it("reads a historical foreign expense without changing its stored currency or rate",()=>{
 const initial={payer_id:one,currency:"USD",rate:"40.125000",original_minor:"1000",method:"equal",shares:[{personId:one,input_value:"1"}],title:"Histórico",notes:"",category:"other",date:"2026-11-03",version:2} as ExpenseDetail;render(<ExpenseForm id={one} groupId={two} people={people} initial={initial}/>);expect(screen.getByText(/Total: \$ 401,25 UYU/)).toBeVisible();expect(screen.queryByLabelText("Moneda")).not.toBeInTheDocument();expect(screen.getByLabelText("Importe en USD")).toHaveValue("10.00");expect(screen.getByLabelText("Importe en USD").closest("form")?.querySelector('input[name="currency"]')).toHaveValue("USD");
});
