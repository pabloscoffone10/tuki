import {render,screen,within,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({ocr:vi.fn(),scan:vi.fn(),save:vi.fn(async()=>({}))}));
vi.mock("@/features/finance/actions",()=>({saveExpense:mocks.save}));
vi.mock("@/features/smart-bills/actions",()=>({scanTicket:mocks.scan}));
vi.mock("@/features/smart-bills/browser-ocr",()=>({readTicketLocally:mocks.ocr,clearLocalOcrCache:vi.fn()}));
import {SmartBillForm} from "@/features/smart-bills/components/smart-bill-form";
import {parseReceiptDocument} from "@/features/smart-bills/receipt-parser";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
const people=[{id:a,name:"Pablo",status:"active" as const,replaced:false},{id:b,name:"Guille",status:"active" as const,replaced:false}];
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});

it("shows original image, exact line discrepancy and an explicit correction before allowing confirmation",async()=>{
 const user=userEvent.setup();const text="UYU\nMilanesa napolitana 3 x 880 = 2040\nSUBTOTAL 2040\nTOTAL 2040";
 const parsed=parseReceiptDocument(text);mocks.ocr.mockResolvedValue({text,...parsed});
 const view=render(<SmartBillForm id={a} groupId={b} aiAvailable people={people} currentPersonId={a}/>);
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["image"],"ticket.png",{type:"image/png"}));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 await user.click(screen.getByRole("button",{name:"Ver ticket"}));
 expect(screen.getByRole("dialog",{name:"Ticket original"})).toBeVisible();
 expect(screen.getByAltText(/Ticket original para revisar/)).toBeInTheDocument();
 await user.click(screen.getByRole("button",{name:"Acercar ticket"}));expect(screen.getByText("Zoom 125%")).toBeVisible();
 await user.click(screen.getByRole("button",{name:"Cerrar"}));expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));
 await user.click(await screen.findByRole("button",{name:"Reemplazar borrador con datos detectados"}));
 expect(screen.getByText("Ver detalles").closest("details")).not.toHaveAttribute("open");
 await user.click(screen.getByText("Ver detalles"));expect(screen.getByText("Ocultar detalles").closest("details")).toHaveAttribute("open");
 await user.click(screen.getByText("Ocultar detalles"));
 await user.click(screen.getByRole("button",{name:"Ver ticket"}));await user.keyboard("{Escape}");
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(screen.getByLabelText("Precio")).toHaveValue("2040.00");
 const confirm=screen.getByRole("checkbox",{name:/Revisé los productos, consumidores/});expect(confirm).toBeDisabled();
 await user.click(within(screen.getByRole("region",{name:"Producto 1"})).getByRole("button",{name:"Pablo"}));expect(confirm).toBeDisabled();
 // Explicit total correction resolves conflicting unit-price evidence without expanding units.
 await user.clear(screen.getByLabelText("Precio"));await user.type(screen.getByLabelText("Precio"),"2040");
 expect(confirm).toBeEnabled();await user.click(confirm);
 expect(JSON.parse(view.container.querySelector<HTMLInputElement>('[name="smartBill"]')!.value).confirmed).toBe(true);
 expect(mocks.save).not.toHaveBeenCalled();expect(mocks.scan).not.toHaveBeenCalled();
});

it("cancels local work and ignores a late result without losing manual products",async()=>{
 let finish!:(value:unknown)=>void;let signal:AbortSignal|undefined;
 mocks.ocr.mockImplementation((_file:File,_progress:unknown,activeSignal:AbortSignal)=>{signal=activeSignal;return new Promise(resolve=>{finish=resolve;});});
 const user=userEvent.setup();render(<SmartBillForm id={a} groupId={b} aiAvailable people={people}/>);
 await user.click(screen.getByRole("button",{name:"Agregar producto manualmente"}));await user.type(screen.getByLabelText("Producto"),"Mi borrador");
 await user.upload(screen.getByLabelText(/Comprobante privado/),new File(["image"],"ticket.png",{type:"image/png"}));await user.click(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"}));
 await waitFor(()=>expect(mocks.ocr).toHaveBeenCalled());await user.click(screen.getByRole("button",{name:"Cancelar lectura"}));expect(signal?.aborted).toBe(true);
 finish({text:"late",...parseReceiptDocument("Agua $100\nTOTAL $100")});
 await waitFor(()=>expect(screen.getByRole("button",{name:"Leer foto gratis (OCR local)"})).toBeEnabled());
 expect(screen.getByLabelText("Producto")).toHaveValue("Mi borrador");expect(screen.queryByRole("button",{name:"Reemplazar borrador con datos detectados"})).not.toBeInTheDocument();expect(mocks.scan).not.toHaveBeenCalled();
});

it("aggregates individual unit assignments into the existing exact quantity split",async()=>{
 const user=userEvent.setup();const view=render(<SmartBillForm id={a} groupId={b} aiAvailable={false} people={people} bill={{currency:"UYU",rate:"1",ticketTotal:"2040",noTotalReason:"",confirmed:false,uploadId:null,adjustments:[],items:[{id:a,name:"Milanesa",quantity:"3",priceMode:"unit",price:"680",discount:"0",split:"units",consumers:[],reviewed:true}]}}/>);
 await user.selectOptions(screen.getByLabelText("Dividir producto"),"units");await user.click(screen.getByText("Asignar unidades una por una"));
 await user.selectOptions(screen.getByLabelText("Unidad 1 de Milanesa"),a);await user.selectOptions(screen.getByLabelText("Unidad 2 de Milanesa"),b);await user.selectOptions(screen.getByLabelText("Unidad 3 de Milanesa"),a);
 const data=JSON.parse(view.container.querySelector<HTMLInputElement>('[name="smartBill"]')!.value);
 expect(data.items[0].consumers).toEqual([{personId:a,input:"2"},{personId:b,input:"1"}]);
 const product=within(screen.getByRole("region",{name:"Producto 1"}));expect(product.getByText(/Pablo: \$ 1.360,00 UYU/)).toBeVisible();expect(product.getByText(/Guille: \$ 680,00 UYU/)).toBeVisible();
});
