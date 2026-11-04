vi.mock("@/features/payments/operation-actions",()=>({recoverPaymentOperation:async()=>({operation:null}),resumePaymentOperation:vi.fn(),resolvePaymentOperation:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect,it,vi } from "vitest";
vi.mock("@/features/payments/actions",()=>({createPayment:vi.fn(async()=>({}))}));
import { PaymentForm } from "@/features/payments/components/payment-form";
import type { PaymentWorkspace } from "@/features/payments/types";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002",g="00000000-0000-4000-8000-000000000003";
const data:PaymentWorkspace={person_id:a,options:[{payer_id:a,receiver_id:b,payer_name:"Pablo",receiver_name:"Mati",scope:"global",max_minor:"80000"}],obligations:[{id:g,debtor_id:a,creditor_id:b,debtor_name:"Pablo",creditor_name:"Mati",amount_minor:"80000",origin_group_id:g,origin_group_name:"Piria"}],payments:[]};
it("Saldar prefills the same manual form and supports partial amount and selected obligations",async()=>{const user=userEvent.setup();render(<PaymentForm id={g} workspace={data} initialPayer={a} initialReceiver={b}/>);const amount=await screen.findByLabelText("Importe pagado en UYU");expect(amount).toHaveValue("800.00");await user.clear(amount);await user.type(amount,"300");expect(amount).toHaveValue("300");await user.click(screen.getByRole("checkbox",{name:"Seleccionar obligaciones manualmente"}));expect(screen.getByRole("checkbox",{name:/Piria/})).toBeVisible();expect(screen.getByRole("checkbox",{name:/Confirmo que el dinero/})).not.toBeChecked();});
it("never switches the requested pair silently when that debt is no longer available",async()=>{render(<PaymentForm id={g} workspace={data} initialPayer={b} initialReceiver={a}/>);expect(await screen.findByText(/No se cambió el pagador ni el receptor/)).toBeVisible();expect(screen.queryByRole("button",{name:"Registrar pago pendiente"})).not.toBeInTheDocument();});
it("keeps exact decimal payloads and resets final consent when payment details change",async()=>{
 const user=userEvent.setup();render(<PaymentForm id={g} workspace={data}/>);const amount=await screen.findByLabelText("Importe pagado en UYU");await user.clear(amount);await user.type(amount,"125,50");const confirmation=screen.getByRole("checkbox",{name:/Confirmo que el dinero/});await user.click(confirmation);await user.type(amount,"1");expect(screen.getByRole("checkbox",{name:/Confirmo que el dinero/})).not.toBeChecked();await user.clear(amount);await user.type(amount,"125,50");const form=screen.getByRole("button",{name:"Registrar pago pendiente"}).closest("form")!;expect(new FormData(form).get("amount")).toBe("125.50");
});

it("makes the existing administrative guest payment flow explicit and keeps partial amounts",async()=>{
 const user=userEvent.setup();const guestWorkspace:PaymentWorkspace={...data,person_id:g,optional_admin_reason:true,options:[{...data.options[0],payer_name:"Guille",receiver_name:"Facu",scope:"group",can_admin_confirm:true}]};
 render(<PaymentForm id={g} workspace={guestWorkspace} groupId={g}/>);
 expect(await screen.findByRole("heading",{name:"Pago manual con invitados"})).toBeVisible();expect(screen.getByRole("option",{name:/Guille.*Facu.*Con invitados/})).toBeVisible();
 const amount=screen.getByLabelText("Importe pagado en UYU");await user.clear(amount);await user.type(amount,"125,50");
 const form=screen.getByRole("button",{name:"Registrar y confirmar como administrador"}).closest("form")!;expect(new FormData(form).get("amount")).toBe("125.50");expect(new FormData(form).get("administrative")).toBe("true");expect(new FormData(form).get("received")).toBe("false");expect(screen.getByText(/Es una declaraci.n manual/)).toBeVisible();
});
