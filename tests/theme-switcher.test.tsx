import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";

it("permite elegir un tema y conserva la preferencia en el navegador", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  try {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    await user.click(screen.getByRole("button", { name: "Tema oscuro" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Tema oscuro" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Tema claro" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("light"));
    expect(localStorage.getItem("theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "Tema del sistema" }));
    expect(localStorage.getItem("theme")).toBe("system");
  } finally { vi.unstubAllGlobals(); localStorage.clear(); }
});
