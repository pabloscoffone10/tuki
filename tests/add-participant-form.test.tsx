import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({add:vi.fn()}));
vi.mock("@/features/groups/actions",()=>({addGuest:mocks.add}));
import { AddParticipantForm } from "@/features/groups/components/add-participant-form";
import type { Member,ReusableGuest } from "@/features/groups/types";
const groupId="00000000-0000-4000-8000-000000000001",personId="00000000-0000-4000-8000-000000000002",userId="user";
const guest=(name="Máti")=>({id:personId,display_name:name,user_id:null,created_by:userId,merged_into:null,memberships:[{group_id:"visible",group:{id:"visible",name:"Piria"}},{group_id:"restricted",group:null}]} as ReusableGuest);
beforeEach(()=>{vi.resetAllMocks();mocks.add.mockResolvedValue({success:"Participante agregado"});});
it("suggests only authorized props with accent-insensitive matching and preserves the chosen identity",async()=>{
 const user=userEvent.setup();render(<AddParticipantForm groupId={groupId} userId={userId} people={[guest()]} members={[]}/>);await user.type(screen.getByRole("textbox"),"mati");expect(screen.getByText(/Lo conocés de: Piria/)).toBeVisible();expect(screen.queryByText(/restricted/)).not.toBeInTheDocument();expect(mocks.add).not.toHaveBeenCalled();await user.click(screen.getByRole("button",{name:"Usar a Máti"}));await user.click(screen.getByRole("button",{name:"Agregar esta persona al grupo"}));await waitFor(()=>expect(mocks.add).toHaveBeenCalled());const form=mocks.add.mock.calls[0][1] as FormData;expect(form.get("personId")).toBe(personId);expect(form.get("mode")).toBe("existing");expect(form.get("name")).toBe("");
});
it("does not automatically merge a homonym and requires deliberate new-identity confirmation",async()=>{
 const user=userEvent.setup();render(<AddParticipantForm groupId={groupId} userId={userId} people={[guest()]} members={[]}/>);await user.type(screen.getByRole("textbox"),"Mati");expect(screen.queryByRole("button",{name:"Crear y agregar invitado"})).not.toBeInTheDocument();await user.click(screen.getByRole("button",{name:"Crear un invitado nuevo llamado Mati"}));await user.click(screen.getByRole("button",{name:"Crear y agregar invitado"}));expect(mocks.add).not.toHaveBeenCalled();await user.click(screen.getByRole("checkbox",{name:/Revisé las coincidencias/}));await user.click(screen.getByRole("button",{name:"Crear y agregar invitado"}));await waitFor(()=>expect(mocks.add).toHaveBeenCalled());const form=mocks.add.mock.calls[0][1] as FormData;expect(form.get("mode")).toBe("new");expect(form.get("name")).toBe("Mati");expect(form.get("personId")).toBe("");
});
it("shows registered current members as already present without account claiming or identity reuse",async()=>{
 const member={person_id:personId,status:"active",person:{id:personId,display_name:"Pablo",user_id:"registered"}} as Member;const user=userEvent.setup();render(<AddParticipantForm groupId={groupId} userId={userId} people={[]} members={[member]}/>);await user.type(screen.getByRole("textbox"),"Pablo");expect(screen.getByText("Con cuenta")).toBeVisible();expect(screen.getByText(/Ya tiene participación/)).toBeVisible();expect(screen.queryByRole("button",{name:/Usar a/})).not.toBeInTheDocument();expect(screen.getByRole("link",{name:/Generá una invitación/})).toHaveAttribute("href",`/grupos/${groupId}?seccion=ajustes`);expect(mocks.add).not.toHaveBeenCalled();
});
it("clears a chosen identity when the search changes and cannot discover unauthorized guests",async()=>{
 const unauthorized={...guest("Privado"),id:"other",created_by:"another-user"},user=userEvent.setup();render(<AddParticipantForm groupId={groupId} userId={userId} people={[guest(),unauthorized]} members={[]}/>);await user.type(screen.getByRole("textbox"),"Mati");await user.click(screen.getByRole("button",{name:"Usar a Máti"}));await user.clear(screen.getByRole("textbox"));await user.type(screen.getByRole("textbox"),"Privado");expect(screen.queryByRole("button",{name:"Agregar esta persona al grupo"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Usar a Privado"})).not.toBeInTheDocument();expect(screen.getByText(/No hay coincidencias/)).toBeVisible();expect(mocks.add).not.toHaveBeenCalled();
});
