import { render,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({scan:vi.fn(async()=>({error:"not configured"})),ocr:vi.fn()}));
vi.mock("@/features/finance/actions",()=>({saveExpense:async()=>({})}));
vi.mock("@/features/smart-bills/actions",()=>({scanTicket:mocks.scan}));
vi.mock("@/features/smart-bills/browser-ocr",()=>({readTicketLocally:mocks.ocr,clearLocalOcrCache:vi.fn()}));
import { SmartBillForm } from "@/features/smart-bills/components/smart-bill-form";
import type { SmartBill } from "@/features/smart-bills/domain";
import type { ExpenseDetail } from "@/features/finance/types";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
it("imports local OCR only after review without Gemini or automatic expense creation",async()=>{
 mocks.scan.mockClear();mocks.ocr.mockResolvedValue({text:"Agua 100,00",extraction:{currency:null,total:"100.00",items:[{name:"Agua",quantity:null,unitPrice:null,subtotal:"100.00",discount:null,uncertain:true}],adjustments:[],warnings:[],complete:false}});
 const user=userEvent.setup();const view=render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={[]}/>);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["photo"],"ticket.png",{type:"image/png"}));
 await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));
 const importButton=await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"});
 expect(JSON.parse((view.container.querySelector('[name="smartBill"]') as HTMLInputElement).value).items).toEqual([]);
 await user.selectOptions(screen.getByLabelText("Confirmar moneda del ticket"),"UYU");await user.click(importButton);
 const bill=JSON.parse((view.container.querySelector('[name="smartBill"]') as HTMLInputElement).value);
 expect(bill.items[0]).toMatchObject({name:"Agua",quantity:"",price:"100.00",reviewed:false,consumers:[]});expect(bill.confirmed).toBe(false);expect(mocks.scan).not.toHaveBeenCalled();
});
it("leaves the draft available after a local OCR failure without automatically using Gemini",async()=>{
 mocks.scan.mockClear();mocks.ocr.mockRejectedValue(Error("No se encontró texto legible"));
 const user=userEvent.setup();render(<SmartBillForm id={a} groupId={b} aiAvailable people={[]}/>);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["photo"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("No se encontró texto legible");expect(mocks.scan).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Agregar producto manualmente"})).toBeEnabled();
});
it("offers a gallery/file picker and a rear-camera capture input",()=>{
 render(<SmartBillForm id={a} groupId={b} aiAvailable people={[]}/>);
 expect(screen.getByLabelText(/Comprobante privado/)).not.toHaveAttribute("capture");
 expect(screen.getByLabelText("Tomar foto del ticket")).toHaveAttribute("capture","environment");
 expect(screen.getByRole("checkbox",{name:/Acepto enviar este ticket/})).toHaveAccessibleName(/Google Gemini/);
});
it("rejects oversized photos before sending a scan request",async()=>{
 mocks.scan.mockReset();const user=userEvent.setup();render(<SmartBillForm id={a} groupId={b} aiAvailable people={[]}/>);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File([new Uint8Array(2*1024*1024+1)],"large.png",{type:"image/png"}));
 await user.click(screen.getByRole("checkbox",{name:/Acepto enviar este ticket/}));await user.click(screen.getByRole("button",{name:"Escanear o recuperar ticket"}));
 expect(screen.getByRole("alert")).toHaveTextContent("2 MiB");expect(mocks.scan).not.toHaveBeenCalled();
});
it("keeps manual loading available without AI and preserves products across summary tabs",async()=>{
 const user=userEvent.setup();render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={[{id:a,name:"Mati",status:"active",replaced:false},{id:b,name:"Pablo",status:"active",replaced:false}]}/>);
 expect(screen.getByText(/Escaneo con IA no disponible/)).toBeVisible();
 await user.click(screen.getByRole("button",{name:"Agregar producto manualmente"}));
 await user.type(screen.getByLabelText("Producto"),"Whisky");await user.type(screen.getByLabelText("Precio o subtotal"),"1600");
 expect(within(screen.getByRole("region",{name:"Producto 1"})).getByText(/Sin asignar/)).toBeVisible();await user.click(within(screen.getByRole("region",{name:"Producto 1"})).getByRole("checkbox",{name:"Mati"}));await user.click(within(screen.getByRole("region",{name:"Producto 1"})).getByRole("checkbox",{name:"Pablo"}));
 await user.type(screen.getByLabelText("Total leído del ticket (sin propina agregada después)"),"1600");
 await user.click(screen.getByRole("button",{name:"Resumen individual"}));
 const summary=screen.getByRole("region",{name:"Resumen individual"});expect(within(summary).getAllByText("$ 800,00 UYU")).toHaveLength(2);
 await user.click(screen.getByRole("button",{name:"Productos y cargos"}));expect(screen.getByLabelText("Producto")).toHaveValue("Whisky");
 const confirm=screen.getByRole("checkbox",{name:/Revisé los productos, consumidores/});await user.click(confirm);expect(confirm).toBeChecked();
 await user.type(screen.getByLabelText("Precio o subtotal"),"1");expect(confirm).not.toBeChecked();
});
it("requires a separate acknowledgment before repeating a scan with unknown provider outcome",async()=>{
 mocks.scan.mockReset();mocks.scan.mockResolvedValue({error:"Resultado desconocido",status:"recoverable",retryRequired:true} as never);
 const user=userEvent.setup();render(<SmartBillForm id={a} groupId={b} aiAvailable people={[{id:a,name:"Mati",status:"active",replaced:false}]}/>);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["test"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("checkbox",{name:/Acepto enviar este ticket/}));await user.click(screen.getByRole("button",{name:"Escanear o recuperar ticket"}));
 const extra=await screen.findByRole("checkbox",{name:/Acepto iniciar otro intento/});expect(extra).not.toBeChecked();expect((mocks.scan.mock.calls[0] as unknown as [unknown,FormData])[1].get("retry")).toBe("no");
 await user.click(extra);await user.click(screen.getByRole("button",{name:"Escanear o recuperar ticket"}));expect((mocks.scan.mock.calls[1] as unknown as [unknown,FormData])[1].get("retry")).toBe("yes");expect(extra).not.toBeChecked();
});
it("offers recovery of a cached extraction when new AI scanning is disabled",async()=>{
 mocks.scan.mockReset();mocks.scan.mockResolvedValue({status:"completed",recovered:true,operationId:a,extraction:{currency:"UYU",total:"100",items:[],adjustments:[],warnings:[],complete:true}} as never);
 const user=userEvent.setup();render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={[]}/>);await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["test"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("checkbox",{name:/Acepto consultar mi lectura privada/}));await user.click(screen.getByRole("button",{name:"Recuperar lectura guardada"}));expect(await screen.findByText(/Completado y recuperado/)).toBeVisible();expect(screen.getByRole("button",{name:"Reemplazar borrador con datos detectados"})).toBeVisible();
});
const people=[{id:a,name:"Mati",status:"active" as const,replaced:false},{id:b,name:"Pablo",status:"active" as const,replaced:false}];
const draft=():SmartBill=>({currency:"UYU",rate:"1",items:[{id:a,name:"Agua",quantity:"1",priceMode:"unit",price:"10",discount:"0",split:"equal",consumers:[{personId:a,input:"1"}],reviewed:true},{id:b,name:"Pan",quantity:"1",priceMode:"unit",price:"20",discount:"0",split:"equal",consumers:[{personId:a,input:"1"}],reviewed:true}],adjustments:[],ticketTotal:"30",noTotalReason:"",confirmed:false,uploadId:null});
const serialized=(container:HTMLElement):SmartBill=>JSON.parse(container.querySelector<HTMLInputElement>('input[name="smartBill"]')!.value);
it("duplicates a product under a new identity, keeps consumer copies independent and preserves collapsed edits",async()=>{
 const user=userEvent.setup(),original=draft();original.items=original.items.slice(0,1);const view=render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={people} bill={original}/>);
 await user.click(screen.getByRole("button",{name:"Duplicar producto"}));let value=serialized(view.container);expect(value.items).toHaveLength(2);expect(value.items[1].id).not.toBe(value.items[0].id);expect(value.items[1].consumers).toEqual(value.items[0].consumers);
 const copy=within(screen.getByRole("region",{name:"Producto 2"}));await user.clear(copy.getByLabelText("Precio o subtotal"));await user.type(copy.getByLabelText("Precio o subtotal"),"12,50");await user.click(copy.getByRole("checkbox",{name:"Pablo"}));value=serialized(view.container);expect(value.items[0].price).toBe("10");expect(value.items[1].price).toBe("12.50");expect(value.items[0].consumers).toHaveLength(1);expect(value.items[1].consumers).toHaveLength(2);
 await user.click(copy.getByText("Agua"));await user.click(copy.getByText("Agua"));expect(copy.getByLabelText("Precio o subtotal")).toHaveValue("12,50");
});
it("assigns explicitly chosen consumers only to explicitly selected products",async()=>{
 const user=userEvent.setup(),view=render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={people} bill={draft()}/>);
 const summary=screen.getByText("Asignación conjunta de productos");await user.click(summary);const toolbar=within(summary.closest("details")!);await user.click(toolbar.getByRole("checkbox",{name:"Pablo"}));await user.click(screen.getByRole("checkbox",{name:"Incluir Pan en asignación conjunta"}));await user.click(screen.getByRole("button",{name:"Asignar en partes iguales a 1 productos seleccionados"}));const value=serialized(view.container);expect(value.items[0].consumers).toEqual([{personId:a,input:"1"}]);expect(value.items[1].consumers).toEqual([{personId:b,input:"1"}]);expect(screen.getByRole("checkbox",{name:"Incluir Pan en asignación conjunta"})).not.toBeChecked();
});
it("defaults to the authenticated payer, resets review on financial changes and serializes comma amounts",async()=>{
 const user=userEvent.setup(),view=render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={people} currentPersonId={b} bill={draft()}/>);expect(screen.getByLabelText("Quién pagó")).toHaveValue(b);
 const confirm=screen.getByRole("checkbox",{name:/Revisé los productos, consumidores/});await user.click(confirm);expect(confirm).toBeChecked();await user.clear(screen.getByLabelText("Total leído del ticket (sin propina agregada después)"));await user.type(screen.getByLabelText("Total leído del ticket (sin propina agregada después)"),"30,00");expect(confirm).not.toBeChecked();expect(serialized(view.container).ticketTotal).toBe("30.00");
});
it("warns on unloading a dirty draft without persisting private receipt data in browser storage",async()=>{
 const user=userEvent.setup(),store=vi.spyOn(Storage.prototype,"setItem"),view=render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={people}/>);const clean=new Event("beforeunload",{cancelable:true});window.dispatchEvent(clean);expect(clean.defaultPrevented).toBe(false);
 await user.type(screen.getByLabelText("Descripción"),"Cuenta privada");const dirty=new Event("beforeunload",{cancelable:true});window.dispatchEvent(dirty);expect(dirty.defaultPrevented).toBe(true);expect(store).not.toHaveBeenCalled();view.unmount();const after=new Event("beforeunload",{cancelable:true});window.dispatchEvent(after);expect(after.defaultPrevented).toBe(false);store.mockRestore();
});
it("requires review again when duplicating an imported product and clears final financial consent",async()=>{
 mocks.scan.mockReset();mocks.scan.mockResolvedValue({status:"completed",extraction:{currency:"UYU",total:"10",items:[{name:"Agua",quantity:"1",unitPrice:"10",subtotal:null,discount:null,uncertain:false}],adjustments:[],warnings:[],complete:true}} as never);
 const user=userEvent.setup(),view=render(<SmartBillForm id={a} groupId={b} aiAvailable people={people}/>);await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["test"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("checkbox",{name:/Acepto enviar este ticket/}));await user.click(screen.getByRole("button",{name:"Escanear o recuperar ticket"}));await user.click(await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"}));
 const product=within(screen.getByRole("region",{name:"Producto 1"}));await user.click(product.getByRole("checkbox",{name:"Mati"}));await user.click(product.getByRole("checkbox",{name:/Revisé y corregí nombre/}));const final=screen.getByRole("checkbox",{name:/Revisé los productos, consumidores/});await user.click(final);await user.click(product.getByRole("button",{name:"Duplicar producto"}));const value=serialized(view.container);expect(value.items[0].reviewed).toBe(true);expect(value.items[1].reviewed).toBe(false);expect(final).not.toBeChecked();expect(within(screen.getByRole("region",{name:"Producto 2"})).getByRole("checkbox",{name:/Revisé y corregí nombre/})).not.toBeChecked();
});
it("has only UYU on new accounts and refuses to relabel foreign scanned prices as UYU",async()=>{
 mocks.scan.mockReset();mocks.scan.mockResolvedValue({status:"completed",extraction:{currency:"USD",total:"10",items:[{name:"Foreign",quantity:"1",unitPrice:"10",subtotal:null,discount:null,uncertain:false}],adjustments:[],warnings:[],complete:true}} as never);
 const user=userEvent.setup(),view=render(<SmartBillForm id={a} groupId={b} aiAvailable people={people} bill={draft()}/>);expect(screen.queryByLabelText("Moneda del ticket")).not.toBeInTheDocument();expect(screen.queryByLabelText(/Cotización manual/)).not.toBeInTheDocument();await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["fixture"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("checkbox",{name:/Acepto enviar este ticket/}));await user.click(screen.getByRole("button",{name:"Escanear o recuperar ticket"}));await user.click(await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"}));expect(screen.getByRole("alert")).toHaveTextContent("no importamos ni convertimos");expect(serialized(view.container).currency).toBe("UYU");expect(serialized(view.container).items[0].name).toBe("Agua");
});
it("preserves a historical foreign smart bill without exposing a currency or exchange selector",()=>{
 const bill={...draft(),currency:"USD" as const,rate:"40"},initial={currency:"USD",rate:"40.000000",payer_id:a,shares:[],title:"Histórico",notes:"",date:"2026-11-03",category:"food",version:1} as unknown as ExpenseDetail;const view=render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={people} bill={bill} initial={initial}/>);expect(serialized(view.container).currency).toBe("USD");expect(serialized(view.container).rate).toBe("40.000000");expect(screen.queryByLabelText("Moneda del ticket")).not.toBeInTheDocument();expect(screen.getByText(/Cuenta histórica en USD/)).toBeVisible();
});
