import { render,screen } from "@testing-library/react";
import { expect,it,vi } from "vitest";
vi.mock('server-only',()=>({}));
import { PaymentSummary } from "@/features/payments/components/workspace";
import type { PaymentWorkspace } from "@/features/payments/types";
it("uses authorized explicit historical balances when the projection list omits a retired participant",()=>{
 const data:PaymentWorkspace={person_id:'pablo',options:[],obligations:[],payments:[],pair_states:[{payer_id:'mati',receiver_id:'pablo',payer_name:'Mati',receiver_name:'Pablo',state:'partial',remaining_minor:'50000',pending_payment:false,scope:'global'}]};render(<PaymentSummary data={data}/>);expect(screen.getByRole('heading',{name:'Te deben'}).parentElement).toHaveTextContent('$ 500,00 UYU');
});
it("does not turn an unverifiable personal balance into a definitive zero",()=>{
 const data:PaymentWorkspace={person_id:'pablo',options:[],obligations:[],payments:[],pair_states:[{payer_id:'mati',receiver_id:'pablo',payer_name:'Mati',receiver_name:'Pablo',state:'unverifiable',remaining_minor:null,pending_payment:false,scope:'unverifiable'}]};render(<PaymentSummary data={data}/>);expect(screen.getByRole('heading',{name:'Te deben'}).parentElement).toHaveTextContent('Por verificar');expect(screen.getByRole('heading',{name:'Debés'}).parentElement).toHaveTextContent('Por verificar');
});
