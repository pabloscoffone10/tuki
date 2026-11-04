// @vitest-environment node
import { beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({group:vi.fn()}));
vi.mock("@/features/groups/data",()=>({getGroup:mocks.group}));
import { groupCardMembers } from "@/features/groups/card-actions";
const id="00000000-0000-4000-8000-000000000001";
beforeEach(()=>vi.resetAllMocks());
it("rejects invalid ids and inaccessible groups without returning members",async()=>{expect((await groupCardMembers("invalid")).error).toBeTruthy();expect(mocks.group).not.toHaveBeenCalled();mocks.group.mockResolvedValue({notFound:true});expect(await groupCardMembers(id)).toEqual({error:expect.any(String)});});
it("returns only display data and identifies guests without exposing account ids",async()=>{mocks.group.mockResolvedValue({group:{id},members:[{person_id:"person",person:{display_name:"Ana",user_id:"private-auth-id",created_by:"private-owner"},role:"admin",status:"active"}]});const result=await groupCardMembers(id);expect(result.members).toEqual([{id:"person",name:"Ana",kind:"registered",status:"active",admin:true}]);expect(JSON.stringify(result)).not.toContain("private-");expect(mocks.group).toHaveBeenCalledWith(id,{people:false,invitations:false,events:false});});
