import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({transition:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/features/payments/actions",()=>({transitionPayment:mocks.transition}));
import { NotificationPaymentActions } from "@/features/notifications/payment-actions";
const notice={id:"notice",category:"payments",kind:"confirmation_requested",title:"Pago",message:"Mensaje",href:"/pagos",created_at:"2026-11-02",read_at:null,payment_id:"00000000-0000-4000-8000-000000000001",payment_version:1,can_confirm:true};
beforeEach(()=>{vi.resetAllMocks();mocks.transition.mockResolvedValue({success:"Pago confirmado"});});
it("receiver confirms directly from a notification with explicit consent and stable request metadata",async()=>{
 const user=userEvent.setup(),done=vi.fn(async()=>{});render(<NotificationPaymentActions notice={notice} onSuccess={done}/>);await user.click(screen.getByRole("button",{name:"Recibí el pago"}));expect(screen.getByRole("button",{name:"Confirmar operación"})).toBeDisabled();await user.click(screen.getByRole("checkbox"));await user.click(screen.getByRole("button",{name:"Confirmar operación"}));await waitFor(()=>expect(done).toHaveBeenCalled());const form=mocks.transition.mock.calls[0][1] as FormData;expect(form.get("id")).toBe(notice.payment_id);expect(form.get("version")).toBe("1");expect(form.get("action")).toBe("confirm");expect(form.get("requestId")).toMatch(/^[a-f0-9-]{36}$/);
});
it("requires a reason for administrative confirmation and rejection",async()=>{
 const user=userEvent.setup();render(<NotificationPaymentActions notice={{...notice,confirm_as_admin:true}} onSuccess={async()=>{}}/>);await user.click(screen.getByRole("button",{name:"Confirmar como administrador"}));await user.click(screen.getByRole("checkbox"));expect(screen.getByRole("button",{name:"Confirmar operación"})).toBeDisabled();await user.type(screen.getByRole("textbox"),"Entrega verificada");await user.click(screen.getByRole("checkbox"));await user.click(screen.getByRole("button",{name:"Confirmar operación"}));await waitFor(()=>expect(mocks.transition).toHaveBeenCalled());expect((mocks.transition.mock.calls[0][1] as FormData).get("reason")).toBe("Entrega verificada");
});
it("does not offer approval after authority or pending state is lost",()=>{render(<NotificationPaymentActions notice={{...notice,can_confirm:false}} onSuccess={async()=>{}}/>);expect(screen.queryByRole("button")).not.toBeInTheDocument();});
it("an authorized administrative notification can omit the extra explanation after 012",async()=>{
 const user=userEvent.setup();render(<NotificationPaymentActions notice={{...notice,confirm_as_admin:true,optional_admin_reason:true}} onSuccess={async()=>{}}/>);await user.click(screen.getByRole("button",{name:"Confirmar como administrador"}));expect(screen.getByRole("textbox")).not.toBeRequired();await user.click(screen.getByRole("checkbox"));await user.click(screen.getByRole("button",{name:"Confirmar operación"}));await waitFor(()=>expect(mocks.transition).toHaveBeenCalled());expect((mocks.transition.mock.calls[0][1] as FormData).get("reason")).toBe("");
});
