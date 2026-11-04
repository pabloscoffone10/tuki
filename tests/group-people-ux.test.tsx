vi.mock("@/features/avatars/actions",()=>({avatarUrl:async()=>({}),updateAvatar:vi.fn()}));
import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it,expect,vi } from "vitest";
vi.mock("@/features/groups/actions",()=>({addGuest:async()=>({}),changeMember:async()=>({}),renameGuest:async()=>({}),replaceGuest:async()=>({})}));
vi.mock("@/features/finance/actions",()=>({safeRemoval:async()=>({})}));
import { GroupPeople } from "@/features/groups/components/group-people";
import type { Group,Member } from "@/features/groups/types";
it("prevents impossible last-administrator actions in the UI while explaining the safe handoff",async()=>{
 const group={id:"group",name:"Piria",had_financial_activity:true,archived_at:null} as Group;
 const member={person_id:"person",person:{id:"person",display_name:"Pablo",user_id:"user"},role:"admin",status:"active",joined_at:"2026-11-03T12:00:00Z"} as Member;
 const user=userEvent.setup();render(<GroupPeople group={group} members={[member]} admin me={member} userId="user" people={[]}/>);await user.click(screen.getByText("Gestionar participación"));
 expect(screen.getByRole("option",{name:"Miembro"})).toBeDisabled();expect(screen.getByRole("option",{name:"Retirado"})).toBeDisabled();expect(screen.getByRole("option",{name:"Invitado pendiente"})).toBeDisabled();expect(screen.queryByText("Eliminar participación de este grupo")).not.toBeInTheDocument();expect(screen.getByText(/No podés eliminar esta participación/)).toBeVisible();
});
