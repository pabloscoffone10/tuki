import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({members:vi.fn(),remove:vi.fn()}));
vi.mock("@/features/groups/card-actions",()=>({groupCardMembers:mocks.members}));
vi.mock("@/features/finance/actions",()=>({safeRemoval:mocks.remove}));
import { GroupCardMenu } from "@/features/groups/components/group-card-menu";
const props={groupId:"00000000-0000-4000-8000-000000000001",name:"Piria",admin:false,owner:false,archived:false};
beforeEach(()=>{vi.resetAllMocks();mocks.members.mockResolvedValue({members:[{id:"a",name:"Ana",kind:"registered",status:"active",admin:true},{id:"b",name:"Guille",kind:"guest",status:"active",admin:false}]});});
it("loads registered members and guests on demand and hides unauthorized actions",async()=>{
 const user=userEvent.setup();render(<GroupCardMenu {...props}/>);expect(mocks.members).not.toHaveBeenCalled();await user.click(screen.getByRole("button",{name:"Opciones de Piria"}));expect(screen.queryByRole("menuitem",{name:"Eliminar grupo"})).not.toBeInTheDocument();expect(screen.queryByRole("menuitem",{name:"Editar grupo e imagen"})).not.toBeInTheDocument();await user.click(screen.getByRole("menuitem",{name:"Ver miembros"}));expect(await screen.findByText("Ana")).toBeVisible();expect(screen.getByText("Registrado")).toBeVisible();expect(screen.getByText("Invitado sin cuenta")).toBeVisible();expect(mocks.members).toHaveBeenCalledWith(props.groupId);
});
it("routes administrators to existing settings and requires deletion confirmation for owners",async()=>{
 const user=userEvent.setup();render(<GroupCardMenu {...props} admin owner/>);await user.click(screen.getByRole("button",{name:"Opciones de Piria"}));expect(screen.getByRole("menuitem",{name:"Editar grupo e imagen"})).toHaveAttribute("href",`/grupos/${props.groupId}?seccion=ajustes`);await user.click(screen.getByRole("menuitem",{name:"Eliminar grupo"}));expect(screen.getByRole("checkbox")).toBeRequired();expect(screen.getByRole("button",{name:"Eliminar grupo definitivamente"})).toBeVisible();expect(mocks.remove).not.toHaveBeenCalled();
});
it("supports keyboard opening and closes without entering the card",async()=>{
 const user=userEvent.setup();render(<GroupCardMenu {...props}/>);screen.getByRole("button",{name:"Opciones de Piria"}).focus();await user.keyboard("{Enter}");expect(screen.getByRole("menuitem",{name:"Ver miembros"})).toBeVisible();await user.keyboard("{Escape}");expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
});
