import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("@/features/feedback/actions", () => ({ submitFeedback: vi.fn(async () => ({ok:true,message:"Recibimos tu reporte."})) }));
import { FeedbackForm } from "@/features/feedback/form";
import { HelpSearch } from "@/features/help/search";
it("submits an anonymous report without requiring email and confirms receipt", async () => {
 render(<FeedbackForm/>);const user=userEvent.setup();
 await user.type(screen.getByLabelText("Descripción (obligatoria)"),"Una sugerencia");
 await user.click(screen.getByRole("button",{name:"Enviar reporte"}));
 expect(await screen.findByRole("status")).toHaveTextContent("Recibimos tu reporte.");
});
it("filters help and presents a useful empty state", async () => {
 render(<HelpSearch/>);const user=userEvent.setup();
 await user.type(screen.getByRole("searchbox"),"inexistente");
 expect(screen.getByRole("status")).toHaveTextContent("No encontramos preguntas");
 expect(screen.queryByText("¿Puedo registrar un pago parcial?")).not.toBeInTheDocument();
});
