// @vitest-environment node
import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({from:vi.fn(),eq:vi.fn()}));
vi.mock("server-only",()=>({}));vi.mock("@/features/auth/session",()=>({requireUser:async()=>({id:"owner"})}));vi.mock("@/lib/supabase/server",()=>({createReadOnlyClient:async()=>({from:mocks.from})}));
import { getGroup } from "@/features/groups/data";
beforeEach(()=>{vi.clearAllMocks();mocks.from.mockImplementation((table:string)=>{const builder={select:()=>builder,eq:(...args:unknown[])=>{mocks.eq(table,...args);return builder;},is:()=>builder,order:()=>builder,limit:()=>builder,maybeSingle:async()=>({data:{id:"g"},error:null}),returns:async()=>({data:table==="group_members"?[{person_id:"me",role:"admin",status:"active",person:{user_id:"owner"}}]:[],error:null})};return builder;});});
it("a summary requests no reusable identities, invitations or event history",async()=>{
 const result=await getGroup("g",{people:false,invitations:false,events:false});expect(result.group?.id).toBe("g");expect(mocks.from.mock.calls.map(([table])=>table)).toEqual(["groups","group_members"]);
});
it("people lookup remains restricted to guests created by the authenticated user",async()=>{
 await getGroup("g",{people:true,invitations:false,events:false});expect(mocks.from).toHaveBeenCalledWith("persons");expect(mocks.eq).toHaveBeenCalledWith("persons","created_by","owner");expect(mocks.from).not.toHaveBeenCalledWith("group_invitations");
});
