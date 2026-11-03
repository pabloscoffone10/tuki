import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it,expect,vi } from "vitest";
vi.mock("@/features/payments/components/quick-debt-actions",()=>({QuickDebtActions:()=> <button>Marcar como pagado</button>}));
import { DebtBoard } from "@/features/payments/components/debt-board";
import type { Payment,PaymentWorkspace } from "@/features/payments/types";
it("filters pending, awaiting confirmation and settled pairs with visible history",async()=>{
 const payment=(id:string,payer:string,receiver:string,status:Payment["status"])=>({id,payer_id:payer,receiver_id:receiver,payer_name:payer,receiver_name:receiver,amount_minor:"10000",status} as Payment);
 const data:PaymentWorkspace={person_id:"Pablo",options:[],obligations:[{id:"one",debtor_id:"Mati",creditor_id:"Pablo",debtor_name:"Mati",creditor_name:"Pablo",amount_minor:"50000",origin_group_id:"g",origin_group_name:"Piria"},{id:"two",debtor_id:"Guille",creditor_id:"Pablo",debtor_name:"Guille",creditor_name:"Pablo",amount_minor:"20000",origin_group_id:"g",origin_group_name:"Piria"}],payments:[payment("p1","Mati","Pablo","pending"),payment("p2","Juana","Pablo","confirmed")]};
 data.pair_states=[{payer_id:"Mati",receiver_id:"Pablo",payer_name:"Mati",receiver_name:"Pablo",remaining_minor:"50000",state:"partial",pending_payment:true,scope:"global"},{payer_id:"Guille",receiver_id:"Pablo",payer_name:"Guille",receiver_name:"Pablo",remaining_minor:"20000",state:"pending",pending_payment:false,scope:"global"},{payer_id:"Juana",receiver_id:"Pablo",payer_name:"Juana",receiver_name:"Pablo",remaining_minor:"0",state:"settled",pending_payment:false,scope:"global"}];
 const user=userEvent.setup();render(<DebtBoard data={data} groupId="g"/>);expect(screen.getAllByRole("button",{name:"Marcar como pagado"})).toHaveLength(2);
 await user.selectOptions(screen.getByRole("combobox"),"waiting");expect(screen.getByRole("heading",{name:"Mati → Pablo"})).toBeVisible();expect(screen.queryByRole("heading",{name:"Guille → Pablo"})).not.toBeInTheDocument();expect(screen.getByRole("link",{name:/Ver historial/})).toHaveAttribute("href","#pago-p1");
 await user.selectOptions(screen.getByRole("combobox"),"pending");expect(screen.getByRole("heading",{name:"Guille → Pablo"})).toBeVisible();await user.selectOptions(screen.getByRole("combobox"),"settled");expect(screen.getByRole("heading",{name:"Juana → Pablo"})).toBeVisible();expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("never infers zero from a historical payment and missing obligation rows",()=>{const data={person_id:"a",options:[],obligations:[],payments:[{id:"p",payer_id:"a",receiver_id:"b",payer_name:"Mati",receiver_name:"Pablo",amount_minor:"10000",status:"confirmed"} as Payment]} satisfies PaymentWorkspace;render(<DebtBoard data={data}/>);expect(screen.getByText(/Saldo no verificable/)).toBeVisible();expect(screen.queryByText(/^\$ 0,00 UYU/)).not.toBeInTheDocument();});
it('opens the authorized collapsed history before following its fragment link',async()=>{
 const data={person_id:'a',options:[],obligations:[],payments:[{id:'p',payer_id:'a',receiver_id:'b',payer_name:'Mati',receiver_name:'Pablo',amount_minor:'10000',status:'confirmed'} as Payment]} satisfies PaymentWorkspace;
 const user=userEvent.setup();render(<><DebtBoard data={data}/><details data-testid="history"><summary>Historial</summary><article id="pago-p">Pago original</article></details></>);expect(screen.getByTestId('history')).not.toHaveAttribute('open');await user.click(screen.getByRole('link',{name:/Ver historial/}));expect(screen.getByTestId('history')).toHaveAttribute('open');
});
