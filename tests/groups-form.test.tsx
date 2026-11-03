import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ActionForm } from "@/features/groups/components/action-form";
import { Confirmation } from "@/features/groups/components/fields";

it("requiere confirmación y muestra resultado accesible antes de archivar", async () => {
  const action = vi.fn(async () => ({ success: "Grupo archivado. El historial se conserva." }));
  const user = userEvent.setup();
  render(<ActionForm action={action} label="Archivar grupo"><Confirmation>Confirmo el archivo.</Confirmation></ActionForm>);
  await user.click(screen.getByRole("button", { name: "Archivar grupo" }));
  expect(action).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Archivar grupo" }));
  expect(await screen.findByRole("status")).toHaveTextContent("El historial se conserva");
  expect(action).toHaveBeenCalledTimes(1);
});
