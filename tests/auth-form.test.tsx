import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("@/features/auth/actions", () => ({
  login: async () => ({ error: "El email o la contraseña no son correctos." }),
  register: async () => ({}), recoverPassword: async () => ({}), changePassword: async () => ({}), googleLogin: async () => ({}),
}));
import { AuthForm } from "@/features/auth/components/auth-form";

it("muestra errores de acceso accesibles y permite reintentar", async () => {
  const user = userEvent.setup();
  render(<AuthForm mode="login" />);
  await user.type(screen.getByLabelText("Email"), "ana@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "incorrecta");
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("El email o la contraseña no son correctos.");
  expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute("href", "/recuperar-contrasena");
});
