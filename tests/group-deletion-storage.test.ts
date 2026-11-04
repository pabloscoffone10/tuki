vi.mock("@/features/avatars/deletion-storage",()=>({finishAvatarGroupDeletion:async()=>true}));
// @vitest-environment node
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({status:vi.fn(),rpc:vi.fn(),remove:vi.fn(),service:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.status})}));
vi.mock('@/lib/env',()=>({requireSupabaseConfig:()=>({url:'https://staging.example.test'})}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.service}));
import { finishGroupFileDeletion } from '@/features/groups/deletion-storage';
const group='00000000-0000-4000-8000-000000000001',path=`${group}/ticket`;
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-key');
 mocks.status.mockResolvedValue({data:1,error:null});mocks.service.mockReturnValue({rpc:mocks.rpc,storage:{from:()=>({remove:mocks.remove})}});
 mocks.remove.mockResolvedValue({error:null});
});
afterEach(()=>{vi.unstubAllEnvs();});
it('never elevates privileges when ownership verification fails',async()=>{
 mocks.status.mockResolvedValue({error:{code:'42501'}});expect(await finishGroupFileDeletion(group)).toBe(false);expect(mocks.service).not.toHaveBeenCalled();
});
it('needs no service key when there are no files, and preserves pending cleanup when configuration is missing',async()=>{
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');expect(await finishGroupFileDeletion(group)).toBe(false);mocks.status.mockResolvedValue({data:0,error:null});expect(await finishGroupFileDeletion(group)).toBe(true);expect(mocks.service).not.toHaveBeenCalled();
});
it('removes private objects through Storage and acknowledges only after success',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{remaining:1,paths:[path]}}).mockResolvedValueOnce({data:{remaining:0,paths:[]}});
 expect(await finishGroupFileDeletion(group)).toBe(true);expect(mocks.remove).toHaveBeenCalledWith([path]);expect(mocks.rpc).toHaveBeenLastCalledWith('tuki_group_file_cleanup',{p_group_id:group,p_removed:[path]});
});
it('keeps the durable queue unacknowledged after a Storage failure or an invalid cross-group path',async()=>{
 mocks.rpc.mockResolvedValue({data:{remaining:1,paths:[path]}});mocks.remove.mockResolvedValue({error:{message:'transport'}});expect(await finishGroupFileDeletion(group)).toBe(false);expect(mocks.rpc).toHaveBeenCalledTimes(1);
 mocks.remove.mockClear();mocks.rpc.mockResolvedValue({data:{remaining:1,paths:['another-group/file']}});expect(await finishGroupFileDeletion(group)).toBe(false);expect(mocks.remove).not.toHaveBeenCalled();
});
