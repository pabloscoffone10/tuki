import { render,screen } from "@testing-library/react";
import { expect,it,vi } from "vitest";
vi.mock('@/features/reports/statistics',()=>({PersonalStatisticsPanel:()=>null}));
const mocks=vi.hoisted(()=>({groups:vi.fn()}));
vi.mock('@/features/groups/data',()=>({listGroups:mocks.groups}));
vi.mock('@/features/finance/components/views',()=>({BalanceCards:()=> <section aria-label="Saldos personales">Tus saldos</section>,ExpenseList:()=> <p>Movimientos</p>}));
import { Overview } from "@/features/overview/components/overview";
it('provides optional first steps without hiding personal balances when no groups are visible',async()=>{
 mocks.groups.mockResolvedValue({groups:[]});render(await Overview());expect(screen.getByRole('heading',{name:'Creá un grupo para tu próximo plan'})).toBeVisible();expect(screen.getByRole('region',{name:'Saldos personales'})).toBeVisible();expect(screen.getAllByRole('link',{name:/Crear grupo/}).length).toBeGreaterThan(0);expect(mocks.groups).toHaveBeenCalledTimes(1);
});
it('removes the large welcome panel for an existing group and reuses the fetched list',async()=>{
 mocks.groups.mockClear();mocks.groups.mockResolvedValue({groups:[{id:'g',name:'Piria',kind:'permanent',archived_at:null}]});render(await Overview());expect(screen.queryByRole('heading',{name:'Creá un grupo para tu próximo plan'})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:/Piria/})).toBeVisible();expect(mocks.groups).toHaveBeenCalledTimes(1);
});
