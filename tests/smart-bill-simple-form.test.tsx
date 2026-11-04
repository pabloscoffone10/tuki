import {render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({ocr:vi.fn(),scan:vi.fn(),save:vi.fn(async()=>({}))}));
vi.mock("@/features/finance/actions",()=>({saveExpense:mocks.save}));
vi.mock("@/features/smart-bills/actions",()=>({scanTicket:mocks.scan}));
vi.mock("@/features/smart-bills/browser-ocr",()=>({readTicketLocally:mocks.ocr,clearLocalOcrCache:vi.fn()}));
import {SmartBillForm} from "@/features/smart-bills/components/smart-bill-form";
import {parseReceiptDocument} from "@/features/smart-bills/receipt-parser";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002",c="00000000-0000-4000-8000-000000000003";
const people=[{id:a,name:"Pablo",status:"active" as const,replaced:false},{id:b,name:"Mati",status:"active" as const,replaced:false},{id:c,name:"Guille",status:"active" as const,replaced:false}];
const text="UYU\nMilanesa 3 x 500 1500\nCubiertos 3 x 100 300\nTOTAL 1800";
beforeEach(()=>vi.clearAllMocks());
it("sends only locally recognized text to Gemini, imports total-price rows and splits them without multiplying quantities",async()=>{
 const user=userEvent.setup();const parsed=parseReceiptDocument(text);mocks.ocr.mockResolvedValue({text,...parsed});mocks.scan.mockResolvedValue({status:"completed",extraction:parsed.extraction});
 const view=render(<SmartBillForm id={a} groupId={b} people={people} currentPersonId={a} aiAvailable/>);
 const value=()=>JSON.parse(view.container.querySelector<HTMLInputElement>('[name="smartBill"]')!.value);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["photo"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));expect(mocks.scan).not.toHaveBeenCalled();
 await user.click(screen.getByText("Otras opciones de lectura"));await user.click(screen.getByRole("checkbox",{name:/Acepto enviar el texto/}));await user.click(screen.getByRole("button",{name:"Analizar texto con Gemini"}));
 const form=mocks.scan.mock.calls[0][1] as FormData;expect(form.get("text")).toBe(text);expect(form.get("file")).toBeNull();expect(value().items).toEqual([]);
 await user.click(await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"}));
 expect(value().items).toHaveLength(2);expect(value().items[0]).toMatchObject({quantity:"3",priceMode:"subtotal",price:"1500.00"});expect(screen.getAllByLabelText("Precio")).toHaveLength(2);expect(screen.getAllByLabelText("Cantidad")).toHaveLength(2);
 for(const index of [1,2])for(const name of ["Pablo","Mati","Guille"])await user.click(within(screen.getByRole("region",{name:`Producto ${index}`})).getByRole("button",{name}));
 await user.click(screen.getByRole("button",{name:"Resumen individual"}));expect(within(screen.getByRole("region",{name:"Resumen individual"})).getAllByText("$ 600,00 UYU")).toHaveLength(3);
 expect(value().confirmed).toBe(false);await user.click(screen.getByRole("checkbox",{name:/Revisé los productos, consumidores/}));expect(value().confirmed).toBe(true);expect(mocks.save).not.toHaveBeenCalled();
});
it("accepts subtotal-only multiple quantities and edits the displayed total",async()=>{
 const user=userEvent.setup();mocks.ocr.mockResolvedValue({text:"ticket",extraction:{currency:"UYU",total:"1500",items:[{name:"Milanesa",quantity:"3",unitPrice:null,subtotal:"1500",discount:null,uncertain:true}],adjustments:[],warnings:[],complete:true}});
 const view=render(<SmartBillForm id={a} groupId={b} people={people} aiAvailable={false}/>);await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["photo"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));await user.click(await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"}));
 expect(screen.getAllByLabelText("Precio")).toHaveLength(1);expect(screen.getByLabelText("Precio")).toHaveValue("1500");expect(screen.queryByLabelText("Precio de cada unidad")).not.toBeInTheDocument();
 await user.clear(screen.getByLabelText("Producto"));await user.type(screen.getByLabelText("Producto"),"Milanesa a caballo");await user.clear(screen.getByLabelText("Precio"));await user.type(screen.getByLabelText("Precio"),"1500,00");
 expect(JSON.parse(view.container.querySelector<HTMLInputElement>('[name="smartBill"]')!.value).items[0]).toMatchObject({name:"Milanesa a caballo",quantity:"3",price:"1500.00",priceMode:"subtotal"});
});
it("runs local OCR before Gemini when requested together and preserves manual products on Gemini failure",async()=>{
 const user=userEvent.setup();mocks.ocr.mockResolvedValue({text,...parseReceiptDocument(text)});mocks.scan.mockResolvedValue({error:"Gemini no disponible"});
 render(<SmartBillForm id={a} groupId={b} people={people} aiAvailable/>);await user.click(screen.getByRole("button",{name:"Agregar producto manualmente"}));await user.type(screen.getByLabelText("Producto"),"Mi borrador");await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["photo"],"ticket.png",{type:"image/png"}));
 await user.click(screen.getByText("Otras opciones de lectura"));await user.click(screen.getByRole("checkbox",{name:/Acepto enviar el texto/}));await user.click(screen.getByRole("button",{name:"Analizar texto con Gemini"}));expect(await screen.findByText("Gemini no disponible")).toBeVisible();expect(mocks.ocr).toHaveBeenCalledTimes(1);expect(mocks.scan).toHaveBeenCalledTimes(1);expect(screen.getByLabelText("Producto")).toHaveValue("Mi borrador");expect(screen.getByLabelText("Texto del ticket")).toHaveValue(text);
});


it("shows mismatch before assignment and preserves all editable grouped products",async()=>{
 const user=userEvent.setup();mocks.ocr.mockResolvedValue({text,...parseReceiptDocument(text.replace("TOTAL 1800","TOTAL 1900"))});
 const view=render(<SmartBillForm id={a} groupId={b} people={people} aiAvailable={false}/>);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["photo"],"ticket.png",{type:"image/png"}));
 await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));await user.click(await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"}));
 expect(screen.getByText(/La suma no coincide con el total impreso/)).toBeVisible();
 expect(screen.getAllByLabelText("Producto")).toHaveLength(2);expect(screen.getAllByLabelText("Cantidad")).toHaveLength(2);
 for(const chip of screen.getAllByRole("button",{name:/^(Pablo|Mati|Guille)$/}))expect(chip).toHaveAttribute("aria-pressed","false");
 await user.clear(screen.getAllByLabelText("Precio")[0]);await user.type(screen.getAllByLabelText("Precio")[0],"1600");
 expect(screen.queryByText(/La suma no coincide con el total impreso/)).not.toBeInTheDocument();
 expect(JSON.parse(view.container.querySelector<HTMLInputElement>('[name="smartBill"]')!.value).items[0].quantity).toBe("3");
 expect(mocks.save).not.toHaveBeenCalled();
});
it("shows imported propina beside products with nobody selected and keeps added-tip reconciliation",async()=>{
 const user=userEvent.setup();const parsed=parseReceiptDocument(text);parsed.extraction.adjustments=[{kind:"tip",label:"Propina",amount:"180",percent:null,included:false,subtract:false}];mocks.ocr.mockResolvedValue({text,...parsed});
 render(<SmartBillForm id={a} groupId={b} people={people} aiAvailable={false}/>);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["photo"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));await user.click(await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"}));
 const tip=screen.getByRole("region",{name:"Producto 3"});expect(within(tip).getByLabelText("Producto")).toHaveValue("Propina");
 expect(within(tip).getByRole("button",{name:"Pablo"})).toHaveAttribute("aria-pressed","false");
 await user.click(within(tip).getByRole("button",{name:"Pablo"}));expect(within(tip).getByRole("button",{name:"Pablo"})).toHaveAttribute("aria-pressed","true");
 expect(screen.queryByText(/La suma no coincide con el total impreso/)).not.toBeInTheDocument();
});
