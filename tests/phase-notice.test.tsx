import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { PhaseNotice } from "@/components/shared/phase-notice";
it("explica el alcance y permite cerrar el diálogo con teclado", async () => {
  const user = userEvent.setup();
  render(<PhaseNotice />);
  const trigger = screen.getByRole("button", { name: "Cómo empezar" });
  await user.click(trigger);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByText(/Los pagos pendientes y rechazados/)).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
