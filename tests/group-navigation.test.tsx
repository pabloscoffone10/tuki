import { render,screen } from "@testing-library/react";
import { expect,it } from "vitest";
import { GroupNavigation,groupSection } from "@/features/groups/components/group-navigation";
it("links to individual group sections and exposes the selected location to assistive technology",()=>{
 render(<GroupNavigation groupId="group" section="personas" admin/>);expect(screen.getByRole("link",{name:"Personas"})).toHaveAttribute("aria-current","page");expect(screen.getByRole("link",{name:"Gastos"})).toHaveAttribute("href","/grupos/group?seccion=gastos");expect(screen.getByRole("link",{name:"Chat"})).toHaveAttribute("href","/grupos/group?seccion=chat");expect(screen.getByRole("link",{name:"Ajustes e historial"})).toBeVisible();expect(screen.getAllByRole("link").map(link=>link.textContent?.trim().split(/\s+/)[0])).toEqual(["Resumen","Gastos","Saldos","Personas","Chat","Ajustes"]);
});
it("does not advertise administration to a member and ignores unknown sections",()=>{
 render(<GroupNavigation groupId="group" section="resumen" admin={false}/>);expect(screen.queryByRole("link",{name:"Ajustes e historial"})).not.toBeInTheDocument();expect(screen.getByRole("link",{name:"Historial del grupo"})).toBeVisible();for(const value of[undefined,['gastos'],'https://evil.test','unknown','chat'])expect(groupSection(value)).toBe(value==='chat'?'chat':'resumen');
});
