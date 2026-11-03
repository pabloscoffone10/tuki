vi.mock("@/features/payments/actions",()=>({transitionPayment:vi.fn(async()=>({success:"ok"}))}));
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/grupos",useRouter:()=>({refresh:vi.fn()}) }));
vi.mock("@/features/notifications/actions",()=>({inbox:async()=>({error:""}),readNotice:async()=>({success:true}),savePreferences:async()=>({success:true})}));
vi.mock("@/components/layout/theme-switcher", () => ({ ThemeSwitcher: () => <span>Apariencia</span> }));

it("abre el menú móvil, marca la sección activa y cierra al navegar", async () => {
  const user = userEvent.setup();
  render(<AppShell><h1>Grupos</h1></AppShell>);
  const trigger = screen.getByRole("button", { name: "Abrir menú" });
  await user.click(trigger);
  const menu = screen.getByRole("dialog", { name: "Menú de navegación" });
  const groupsLink = within(menu).getByRole("link", { name: "Mis grupos" });
  expect(groupsLink).toHaveAttribute("aria-current", "page");
  expect(groupsLink).toHaveAttribute("href", "/grupos");
  groupsLink.addEventListener("click", (event) => event.preventDefault());
  await user.click(groupsLink);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it("keeps the three frequent destinations available outside the mobile drawer",()=>{
 render(<AppShell><h1>Grupos</h1></AppShell>);const nav=screen.getByRole("navigation",{name:"Accesos rápidos móviles"});expect(within(nav).getByRole("link",{name:"Inicio"})).toHaveAttribute("href","/");expect(within(nav).getByRole("link",{name:"Grupos"})).toHaveAttribute("aria-current","page");expect(within(nav).getByRole("link",{name:"Pagos"})).toHaveAttribute("href","/pagos");
});
