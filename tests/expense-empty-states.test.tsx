import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect,it } from "vitest";
import { ExpenseFilters } from "@/features/finance/components/expense-filters";
it("offers the first expense only in an editable group",()=>{
 render(<ExpenseFilters rows={[]} groupId="g" canCreate/>);expect(screen.getByRole("link",{name:"Registrar primer gasto"})).toHaveAttribute('href','/grupos/g/gastos/nuevo');
});
it("does not offer creating an expense in an archived/read-only group",()=>{
 render(<ExpenseFilters rows={[]} groupId="g"/>);expect(screen.queryByRole("link",{name:"Registrar primer gasto"})).not.toBeInTheDocument();expect(screen.getByRole("link",{name:"Volver al resumen del grupo"})).toBeVisible();
});
it("distinguishes no matches from no data and clears filters in place",async()=>{
 const user=userEvent.setup();render(<ExpenseFilters rows={[{id:'e',group_id:'g',group_name:'Piria',status:'active',version:1,title:'Cancha',category:'sports',expense_date:'2026-11-03',total_minor:'100000'}]}/>);await user.type(screen.getByRole('textbox',{name:'Buscar gastos'}),'restaurant');expect(screen.getByText('No hay resultados para estos filtros.')).toBeVisible();expect(screen.queryByText(/Todavía no hay gastos/)).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Limpiar filtros'}));expect(screen.getByRole('link',{name:/Cancha/})).toBeVisible();
});
