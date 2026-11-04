import { it,expect,vi } from "vitest";
import { render,screen,fireEvent } from "@testing-library/react";
vi.mock("@/features/finance/components/expense-form",()=>({ExpenseForm:()=> <p>Formulario normal</p>}));
vi.mock("@/features/smart-bills/components/smart-bill-form",()=>({SmartBillForm:()=> <p>OCR existente</p>}));
vi.mock("@/features/smart-bills/components/voice-bill-form",()=>({VoiceBillForm:()=> <p>Formulario de voz</p>}));
import { ExpenseComposer } from "@/features/smart-bills/components/expense-composer";
it("offers both modes, returns to selection and keeps the OCR flow",()=>{
 render(<ExpenseComposer id="id" groupId="group" people={[]} aiAvailable/>);
 fireEvent.click(screen.getByRole("button",{name:/Cuenta Inteligente/}));
 expect(screen.getByText("Elegí cómo querés agregar los gastos de tu grupo.")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:/Usar voz/}));expect(screen.getByText("Formulario de voz")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:/Elegir modalidad/}));
 fireEvent.click(screen.getByRole("button",{name:/Escanear ticket/}));expect(screen.getByText("OCR existente")).toBeVisible();
});
