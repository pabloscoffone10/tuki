import { render,screen,within } from "@testing-library/react";
import { expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({group:vi.fn(),personal:vi.fn(),period:vi.fn(()=>({from:null,to:null}))}));
vi.mock("@/features/reports/data",()=>({groupStatistics:mocks.group,personalStatistics:mocks.personal,reportPeriod:mocks.period}));
import { StatisticsContent,GroupStatisticsPanel,PersonalStatisticsPanel,barWidth } from "@/features/reports/statistics";
import type { GroupStatistics } from "@/features/reports/types";
const groupId="00000000-0000-4000-8000-000000000001";
const personId="00000000-0000-4000-8000-000000000002";
const base:GroupStatistics={group_id:groupId,group_name:"Juana",from:null,to:null,currency:"UYU",expense_count:1,total_minor:"60000",confirmed_minor:"20000",outstanding_minor:"10000",pending_payment_count:1,people:[{person_id:personId,display_name:"Mati",advanced_minor:"60000",consumed_minor:"30000",settled_paid_minor:"0",settled_received_minor:"20000",balance_minor:"10000"}],currencies:[{currency:"UYU",original_minor:"60000",total_minor:"60000"}],categories:[{category:"food",total_minor:"60000",count:1}],timeline:[{date:"2026-11-01",total_minor:"60000",count:1}]};
it("separates original expenses, confirmed allocations and gross debt without adding them",()=>{
 render(<StatisticsContent data={base}/>);expect(screen.getByRole("heading",{name:"Gastos originales"})).toBeVisible();expect(screen.getByRole("heading",{name:"Liquidado confirmado"})).toBeVisible();expect(screen.getByText(/Las deudas proyectadas desde otros grupos no se incluyen/)).toBeVisible();expect(screen.getByText(/no compensan deudas inversas/)).toBeVisible();expect(screen.getByRole("region",{name:"Por categoría registrada"})).toHaveTextContent("Comida");expect(screen.getByText("2026-11")).toBeInTheDocument();
});
it("has clear empty statistics instead of invented chart values",()=>{
 render(<StatisticsContent data={{...base,expense_count:0,total_minor:"0",confirmed_minor:"0",outstanding_minor:"0",people:[],currencies:[],categories:[],timeline:[]}}/>);expect(screen.getAllByText(/no hay gastos activos/i).length).toBeGreaterThan(0);expect(screen.queryByText("Mati")).not.toBeInTheDocument();
});
it("uses exact integer ratios for visual widths even beyond Number safe cents",()=>{
 expect(barWidth("900719925474099300000","1801439850948198600000")).toBe(50);expect(barWidth("0","0")).toBe(0);
});
it("builds origin-only export links and does not link private receipts",async()=>{
 mocks.group.mockResolvedValue(base);render(await GroupStatisticsPanel({groupId}));expect(screen.getByRole("link",{name:"Descargar CSV"})).toHaveAttribute("href",`/grupos/${groupId}/exportar?&format=csv`);expect(screen.queryByRole("link",{name:/comprobante/i})).not.toBeInTheDocument();expect(mocks.group).toHaveBeenCalledWith(groupId,{from:null,to:null});
});
it("states the different authorized scopes of personal consumption and settlements",async()=>{
 mocks.personal.mockResolvedValue({person_id:personId,advanced_minor:"60000",consumed_minor:"30000",expense_count:1,owe_minor:"0",owed_minor:"10000",confirmed_paid_minor:"0",confirmed_received_minor:"20000",pending_payment_count:1,recent_groups:[]});render(await PersonalStatisticsPanel());const panel=screen.getByRole("region",{name:"Estadísticas personales"});expect(within(panel).getByText("Consumiste")).toBeVisible();expect(within(panel).getByText(/No representan el mismo conjunto/)).toBeVisible();expect(within(panel).queryByText(/Piria/)).not.toBeInTheDocument();
});
it("shows report failures without a fake zero",async()=>{
 mocks.group.mockRejectedValue(Error("No tenés acceso activo a este grupo o reporte."));render(await GroupStatisticsPanel({groupId}));expect(screen.getByRole("alert")).toHaveTextContent("No tenés acceso");expect(screen.queryByText("Gastos originales")).not.toBeInTheDocument();
});
