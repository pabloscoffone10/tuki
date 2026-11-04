import { render,screen } from '@testing-library/react';
import { it,expect,vi } from 'vitest';
vi.mock('@/features/groups/actions',()=>({createGroup:async()=>({}),updateGroup:async()=>({}),archiveGroup:async()=>({}),createInvitation:async()=>({}),revokeInvitation:async()=>({})}));
vi.mock('@/features/finance/actions',()=>({safeRemoval:async()=>({})}));
import { GroupSettings } from '@/features/groups/components/group-settings';
import type { Group } from '@/features/groups/types';
const group={id:'00000000-0000-4000-8000-000000000001',name:'Tuki',kind:'temporary',description:'',archived_at:'2026-11-03T00:00:00Z',had_financial_activity:true} as Group;
it('offers irreversible deletion to the owner of an archived financial group with explicit required confirmation',()=>{
 render(<GroupSettings group={group} admin={false} owner invitations={[]} events={[]}/>);
 expect(screen.getByRole('button',{name:'Eliminar grupo definitivamente'})).toBeInTheDocument();
 const confirmation=screen.getByRole('checkbox');expect(confirmation).toBeRequired();expect(confirmation).not.toBeChecked();
 expect(screen.getByText(/Esta acción es irreversible/)).toBeInTheDocument();
});
it('does not expose owner deletion to an ordinary administrator',()=>{
 render(<GroupSettings group={group} admin owner={false} invitations={[]} events={[]}/>);
 expect(screen.queryByRole('button',{name:'Eliminar grupo definitivamente'})).not.toBeInTheDocument();
});
