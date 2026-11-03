import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({recover:vi.fn(),resume:vi.fn(),resolve:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/features/payments/actions",()=>({createPayment:vi.fn()}));
vi.mock("@/features/payments/operation-actions",()=>({recoverPaymentOperation:mocks.recover,resumePaymentOperation:mocks.resume,resolvePaymentOperation:mocks.resolve}));
import { PaymentRecoveryBoundary,PaymentOperationPanel } from "@/features/payments/components/operation-recovery";
const id="00000000-0000-4000-8000-000000000001",processed={id,state:"processed" as const,payment_status:"confirmed" as const};
beforeEach(()=>{vi.resetAllMocks();mocks.recover.mockResolvedValue({operation:processed});});
it("reload/remount recovers the existing operation before exposing any new financial form",async()=>{
 const storage=vi.spyOn(Storage.prototype,"setItem"),user=userEvent.setup();
 const first=render(<PaymentRecoveryBoundary><button>Nuevo pago</button></PaymentRecoveryBoundary>);expect(screen.queryByRole("button",{name:"Nuevo pago"})).not.toBeInTheDocument();await screen.findByText(`Referencia: ${id}`);first.unmount();
 render(<PaymentRecoveryBoundary><button>Nuevo pago</button></PaymentRecoveryBoundary>);await screen.findByText(`Referencia: ${id}`);expect(mocks.resume).not.toHaveBeenCalled();expect(screen.queryByRole("button",{name:"Nuevo pago"})).not.toBeInTheDocument();
 mocks.resolve.mockResolvedValue({operation:null});mocks.recover.mockResolvedValue({operation:null});await user.click(screen.getByRole("button",{name:"Reconocer resultado e iniciar otro pago"}));await screen.findByRole("button",{name:"Nuevo pago"});expect(mocks.resolve).toHaveBeenCalledWith(id,"ack");expect(storage).not.toHaveBeenCalled();storage.mockRestore();
});
it("an unknown result cannot resend or start a new operation until reconciled",async()=>{
 const user=userEvent.setup();render(<PaymentOperationPanel initial={{unknown:true,error:"Respuesta perdida"}} onClear={vi.fn()}/>);
 expect(screen.queryByRole("button",{name:"Enviar el mismo intento"})).not.toBeInTheDocument();await user.click(screen.getByRole("button",{name:"Consultar resultado original"}));await screen.findByText(`Referencia: ${id}`);expect(screen.getByText(/Pago confirmado/)).toBeVisible();expect(mocks.resume).not.toHaveBeenCalled();
});
it("prepared attempts require consent, reuse their original ID and are not sent on mount",async()=>{
 const user=userEvent.setup();mocks.resume.mockResolvedValue({operation:processed});render(<PaymentOperationPanel initial={{operation:{id,state:"prepared",summary:{payer_name:"Mati",receiver_name:"Pablo",amount:"300",date:"2026-11-03",method:"cash"}}}} onClear={vi.fn()}/>);
 expect(screen.getByText(/Mati → Pablo/)).toBeVisible();expect(screen.getByRole("button",{name:"Enviar el mismo intento"})).toBeDisabled();expect(mocks.resume).not.toHaveBeenCalled();await user.click(screen.getByRole("checkbox"));await user.click(screen.getByRole("button",{name:"Enviar el mismo intento"}));await waitFor(()=>expect(mocks.resume).toHaveBeenCalledExactlyOnceWith(id,true));await screen.findByText(/Pago confirmado/);
});
it("permission or connection lookup failure never exposes an unguarded form",async()=>{
 mocks.recover.mockResolvedValue({unknown:true,error:"No pudimos consultar"});render(<PaymentRecoveryBoundary><button>Nuevo pago</button></PaymentRecoveryBoundary>);await screen.findByText("No pudimos consultar");expect(screen.queryByRole("button",{name:"Nuevo pago"})).not.toBeInTheDocument();
});
