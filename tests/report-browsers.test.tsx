import { render,screen } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/features/reports/data",()=>({reportRpc:mocks.rpc}));
import { ExpenseBrowser } from "@/features/reports/expense-browser";
import { FinancialHistory } from "@/features/reports/history";
beforeEach(()=>mocks.rpc.mockReset());
it("sends filters to server and only renders its bounded page, preserving URL on next",async()=>{
 mocks.rpc.mockResolvedValue({items:[{id:"e",group_id:"g",group_name:"Piria",status:"active",title:"Cena",expense_date:"2026-11-03",total_minor:"12345",payer_name:"Mati",currency:"UYU",original_minor:"12345"}],total:60,page:1,size:25,options:{people:[{id:"p",name:"Mati"}]}});
 render(await ExpenseBrowser({groupId:"g",searchParams:Promise.resolve({q:"Cena",min:"100,25"})}));
 expect(mocks.rpc).toHaveBeenCalledWith("tuki_expenses_page",{p_group_id:"g",p_filters:{sort:"date_desc",q:"Cena",min_minor:"10025",status:"active"},p_page:1,p_size:25});
 expect(screen.getByRole("link",{name:/Cena/})).toHaveAttribute("href","/gastos/e");expect(screen.getByRole("link",{name:"Siguiente"})).toHaveAttribute("href","/grupos/g?q=Cena&min=100%2C25&seccion=gastos&page=2");expect(screen.getByRole("textbox",{name:"Descripción"})).toHaveValue("Cena");
});
it("invalid filters do not query database and show safe correction link",async()=>{
 render(await ExpenseBrowser({searchParams:Promise.resolve({payer:"private-person"})}));expect(mocks.rpc).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("Revisá el pagador");
});
it("separates empty search and active expenses and keeps creation unavailable without permission",async()=>{
 mocks.rpc.mockResolvedValue({items:[],total:0,page:1,size:25});render(await ExpenseBrowser({groupId:"g",searchParams:Promise.resolve({q:"Inexistente"})}));expect(screen.getByText("No hay resultados para estos filtros o esta página.")).toBeVisible();expect(screen.queryByRole("link",{name:"Registrar un gasto"})).not.toBeInTheDocument();
});
it("history distinguishes request, confirmation and reversal, using stored dates and authorized links",async()=>{
 const base={entity:"payment",entity_id:"p",created_at:"2026-11-03T15:00:00Z",operation_date:"2026-11-01",actor_name:"Mati",amount_minor:"10000",currency:"UYU",status:"void",group_id:"g",group_name:"Piria",title:"Pago registrado",version:3};
 mocks.rpc.mockResolvedValue({items:[{...base,id:"1",kind:"created"},{...base,id:"2",kind:"confirm"},{...base,id:"3",kind:"void"}],total:3,page:1,size:25});
 render(await FinancialHistory({searchParams:Promise.resolve({from:"2026-11-01",to:"2026-11-30"})}));expect(screen.getByRole("heading",{name:"Solicitud de pago registrada"})).toBeVisible();expect(screen.getByRole("heading",{name:"Pago confirmado"})).toBeVisible();expect(screen.getByRole("heading",{name:"Pago anulado / revertido"})).toBeVisible();expect(screen.getAllByText(/Fecha declarada del pago: 2026-11-01/)).toHaveLength(3);expect(mocks.rpc).toHaveBeenCalledWith("tuki_history_page",{p_group_id:null,p_from:"2026-11-01",p_to:"2026-11-30",p_page:1,p_size:25});
});
