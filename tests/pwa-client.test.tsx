import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component,type ReactNode } from "react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({refresh:vi.fn(),create:vi.fn(),recover:vi.fn(),resume:vi.fn(),resolve:vi.fn(),transition:vi.fn()}));
vi.mock("next/navigation",async importOriginal=>({...await importOriginal<typeof import("next/navigation")>(),useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/features/payments/actions",()=>({createPayment:mocks.create,transitionPayment:mocks.transition}));
vi.mock("@/features/payments/operation-actions",()=>({recoverPaymentOperation:mocks.recover,resumePaymentOperation:mocks.resume,resolvePaymentOperation:mocks.resolve}));
import { InstallControl } from "@/components/pwa/install-control";
import { PwaStatus } from "@/components/pwa/pwa-status";
import { ActionForm } from "@/features/groups/components/action-form";
import { PaymentOperationForm,PaymentOperationPanel } from "@/features/payments/components/operation-recovery";
import { NotificationPaymentActions } from "@/features/notifications/payment-actions";

function connection(online:boolean){Object.defineProperty(navigator,"onLine",{configurable:true,value:online});act(()=>window.dispatchEvent(new Event(online?"online":"offline")));}
beforeEach(()=>{vi.clearAllMocks();Object.defineProperty(navigator,"onLine",{configurable:true,value:true});});
afterEach(()=>{vi.unstubAllEnvs();connection(true);Reflect.deleteProperty(navigator,"serviceWorker");});
it("offers install only after the browser event and invokes no prompt until a user requests it",async()=>{
 const user=userEvent.setup();render(<InstallControl/>);expect(screen.queryByRole("button",{name:"Instalar Tuki"})).not.toBeInTheDocument();const prompt=vi.fn(async()=>{}),event=new Event("beforeinstallprompt",{cancelable:true});Object.assign(event,{prompt,userChoice:Promise.resolve({outcome:"dismissed"})});act(()=>window.dispatchEvent(event));expect(event.defaultPrevented).toBe(true);expect(prompt).not.toHaveBeenCalled();await user.click(screen.getByRole("button",{name:"Instalar Tuki"}));expect(prompt).toHaveBeenCalledOnce();await waitFor(()=>expect(screen.queryByRole("button",{name:"Instalar Tuki"})).not.toBeInTheDocument());expect(screen.getByText(/Una instalación en iOS/)).toBeInTheDocument();
});
it("shows explicit iOS instructions and the installed state without asking push permission",()=>{
 render(<InstallControl/>);expect(screen.getByText(/abrí Tuki en Safari/,{selector:"p"})).toBeInTheDocument();act(()=>window.dispatchEvent(new Event("appinstalled")));expect(screen.getByText(/Estás usando Tuki en modo instalado/)).toBeVisible();
});
it("retains the browser installation event from the global status before opening configuration",async()=>{
 render(<PwaStatus/>);const prompt=vi.fn(async()=>{}),event=new Event("beforeinstallprompt",{cancelable:true});Object.assign(event,{prompt,userChoice:Promise.resolve({outcome:"dismissed"})});act(()=>window.dispatchEvent(event));render(<InstallControl/>);expect(screen.getByRole("button",{name:"Instalar Tuki"})).toBeVisible();expect(prompt).not.toHaveBeenCalled();
});
it("warns offline, then refreshes data only after an explicit recovery click",async()=>{
 const user=userEvent.setup();render(<PwaStatus/>);connection(false);expect(screen.getByRole("alert",{name:"Sin conexión"})).toHaveTextContent("no están actualizados");connection(true);expect(mocks.refresh).not.toHaveBeenCalled();expect(screen.getByText(/Volvió la conexión/)).toBeVisible();await user.click(screen.getByRole("button",{name:"Consultar datos actuales"}));expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("registers only the public worker and leaves a waiting version without activating or reloading forms",async()=>{
 vi.stubEnv("NODE_ENV","production");Object.defineProperty(window,"isSecureContext",{configurable:true,value:true});const target=new EventTarget(),waiting={postMessage:vi.fn()},register=vi.fn(async()=>Object.assign(target,{waiting,installing:null}));Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{register}});render(<PwaStatus/>);await waitFor(()=>expect(screen.getByText(/Hay una actualización de Tuki/)).toBeVisible());expect(register).toHaveBeenCalledWith("/sw.js",{scope:"/",updateViaCache:"none"});expect(waiting.postMessage).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
});
it("keeps a financial form draft in memory and prevents offline submit, including synthetic submission",async()=>{
 const action=vi.fn(async()=>({success:"ok"})),user=userEvent.setup();render(<ActionForm action={action} label="Guardar gasto"><label>Descripción<input name="title"/></label></ActionForm>);await user.type(screen.getByRole("textbox"),"Cena pendiente");connection(false);expect(screen.getByRole("button",{name:"Guardar gasto"})).toBeDisabled();fireEvent.submit(screen.getByRole("textbox").closest("form")!);expect(action).not.toHaveBeenCalled();connection(true);expect(screen.getByRole("textbox")).toHaveValue("Cena pendiente");expect(action).not.toHaveBeenCalled();
});
it("blocks payment creation and recovery transitions offline without changing the original operation",()=>{
 render(<><PaymentOperationForm label="Registrar pago"><input aria-label="Importe" name="amount" defaultValue="10"/></PaymentOperationForm><PaymentOperationPanel initial={{unknown:true,error:"Resultado desconocido"}} onClear={vi.fn()}/></>);connection(false);expect(screen.getByRole("button",{name:"Registrar pago"})).toBeDisabled();expect(screen.getByRole("button",{name:"Consultar resultado original"})).toBeDisabled();fireEvent.submit(screen.getByRole("textbox",{name:"Importe"}).closest("form")!);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.recover).not.toHaveBeenCalled();expect(screen.getByText("Resultado desconocido")).toBeVisible();
});
it("prevents an offline notification confirmation without dropping entered consent",async()=>{
 const user=userEvent.setup();render(<NotificationPaymentActions notice={{id:"n",category:"payments",kind:"confirmation_requested",title:"Pago",message:"",href:"/pagos",created_at:"2026-11-03",read_at:null,can_confirm:true,payment_id:"p",payment_version:1}} onSuccess={async()=>{}}/>);await user.click(screen.getByRole("button",{name:"Recibí el pago"}));await user.click(screen.getByRole("checkbox"));connection(false);expect(screen.getByRole("button",{name:"Confirmar operación"})).toBeDisabled();connection(true);expect(screen.getByRole("checkbox")).toBeChecked();expect(mocks.transition).not.toHaveBeenCalled();
});
it("keeps uncontrolled drafts after a temporary transport failure instead of resetting the form",async()=>{
 const user=userEvent.setup(),action=vi.fn(async()=>{throw Error("private network diagnostic");});render(<ActionForm action={action} label="Guardar gasto"><label>Descripción<input name="title"/></label></ActionForm>);await user.type(screen.getByRole("textbox"),"Cena por revisar");await user.click(screen.getByRole("button",{name:"Guardar gasto"}));await screen.findByRole("alert");expect(screen.getByRole("textbox")).toHaveValue("Cena por revisar");expect(screen.getByRole("alert")).not.toHaveTextContent("private network diagnostic");expect(action).toHaveBeenCalledOnce();
});
it("recovers an unknown browser transport result without retrying the payment automatically",async()=>{
 const user=userEvent.setup();mocks.create.mockRejectedValueOnce(Error("connection closed"));render(<PaymentOperationForm label="Registrar pago"><input name="id" type="hidden" value="original-payment-id" readOnly/></PaymentOperationForm>);await user.click(screen.getByRole("button",{name:"Registrar pago"}));await screen.findByText("Resultado desconocido: requiere conciliación");expect(mocks.create).toHaveBeenCalledOnce();expect(mocks.recover).not.toHaveBeenCalled();expect(screen.queryByRole("button",{name:"Registrar pago"})).not.toBeInTheDocument();
});
it("lets Next.js handle action redirects rather than misreporting a saved group as a network failure",async()=>{
 class Boundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true};}render(){return this.state.failed?<p>Control de navegación recibido</p>:this.props.children;}}
 const log=vi.spyOn(console,"error").mockImplementation(()=>{});try{const user=userEvent.setup(),error=Object.assign(Error("NEXT_REDIRECT"),{digest:"NEXT_REDIRECT;replace;/grupos;303;"});render(<Boundary><ActionForm action={async()=>{throw error;}} label="Crear grupo"><input name="name" defaultValue="Viaje"/></ActionForm></Boundary>);await user.click(screen.getByRole("button",{name:"Crear grupo"}));expect(await screen.findByText("Control de navegación recibido")).toBeVisible();expect(screen.queryByText(/No recibimos una confirmación/)).not.toBeInTheDocument();}finally{log.mockRestore();}
});
