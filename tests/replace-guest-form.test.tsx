import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ replaceGuest: vi.fn(async () => ({ success: "Reemplazado solo en este grupo." })) }));
vi.mock("@/features/groups/actions", () => ({ replaceGuest: mocks.replaceGuest }));
import { ReplaceGuestForm } from "@/features/groups/components/replace-guest-form";

it("exige elegir por ID y volver a confirmar si cambia el destino", async () => {
  const user = userEvent.setup();
  const one = "00000000-0000-4000-8000-000000000002";
  const two = "00000000-0000-4000-8000-000000000003";
  const candidates = [one,two].map((id,index) => ({ id, display_name: "Mati", user_id: null, created_by: "owner", merged_into: null, created_at: "2026-01-01", updated_at: "2026-01-01", memberships: [{ group_id: "other", group: { id: "other", name: index ? "Piria Halloween" : "Juana" } }] }));
  render(<ReplaceGuestForm groupId="00000000-0000-4000-8000-000000000001" sourceId="00000000-0000-4000-8000-000000000004" sourceName="Mati" candidates={candidates} />);
  await user.selectOptions(screen.getByRole("combobox"),one);
  expect(screen.getByRole("option",{ name: /Juana/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button",{ name: "Confirmar reemplazo en este grupo" }));
  expect(mocks.replaceGuest).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox"));
  await user.selectOptions(screen.getByRole("combobox"),two);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button",{ name: "Confirmar reemplazo en este grupo" }));
  expect(await screen.findByText("Reemplazado solo en este grupo.")).toBeVisible();
  const form = mocks.replaceGuest.mock.calls[0] as unknown as [unknown,FormData];
  expect(form[1].get("targetPersonId")).toBe(two);
});
