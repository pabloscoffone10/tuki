import { beforeEach,it,expect,vi } from "vitest";
import { render,screen,fireEvent,waitFor,cleanup,act } from "@testing-library/react";
const mocks=vi.hoisted(()=>({analyze:vi.fn(),save:vi.fn(),start:vi.fn(),stop:vi.fn(),abort:vi.fn()}));
vi.mock("@/features/smart-bills/voice-actions",()=>({analyzeVoice:mocks.analyze,saveVoiceExpense:mocks.save}));
import { VoiceBillForm } from "@/features/smart-bills/components/voice-bill-form";
const person={id:"00000000-0000-4000-8000-000000000001",name:"Pablo",status:"active",replaced:false};
class RestartRecognition {
 static last:RestartRecognition;
 onend:(()=>void)|null=null;
 onerror:((e:{error:string})=>void)|null=null;
 onresult:((e:{results:{isFinal:boolean;0:{transcript:string}}[]})=>void)|null=null;
 start=mocks.start;stop=mocks.stop;abort=mocks.abort;
 constructor(){RestartRecognition.last=this;}
}
const result={data:{currency:"UYU",total:"500",items:[{name:"Pizza",amount:"500",payer:"yo",consumers:["Pablo"]}],adjustments:[],warnings:[],complete:true},self:person.id};
beforeEach(()=>{cleanup();vi.resetAllMocks();mocks.analyze.mockResolvedValue(result);mocks.save.mockResolvedValue({error:"simulado"});Object.defineProperty(window,"isSecureContext",{configurable:true,value:true});Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:undefined});});
function mount(){render(<VoiceBillForm id={person.id} groupId={person.id} people={[person]} currentPersonId={person.id}/>);}
it("resumes a disconnected recognition session, preserves text and stops at the original deadline",()=>{
 vi.useFakeTimers();
 try{
  Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:RestartRecognition});mount();
  fireEvent.click(screen.getByRole("button",{name:"Iniciar micrófono"}));const recognition=RestartRecognition.last;
  act(()=>{recognition.onresult?.({results:[{isFinal:true,0:{transcript:"Una pizza"}}]});recognition.onend?.();vi.advanceTimersByTime(250);});
  expect(mocks.start).toHaveBeenCalledTimes(2);
  act(()=>recognition.onresult?.({results:[{isFinal:true,0:{transcript:"costó 500"}}]}));
  expect(screen.getByLabelText("Transcripción editable")).toHaveValue("Una pizza costó 500");
  act(()=>vi.advanceTimersByTime(59750));expect(mocks.stop).toHaveBeenCalledOnce();
  act(()=>{recognition.onend?.();vi.advanceTimersByTime(1000);});expect(mocks.start).toHaveBeenCalledTimes(2);
 }finally{cleanup();vi.useRealTimers();}
});
it("does not restart after an explicit stop or a denied permission",()=>{
 vi.useFakeTimers();
 try{
  Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:RestartRecognition});mount();
  fireEvent.click(screen.getByRole("button",{name:"Iniciar micrófono"}));
  act(()=>RestartRecognition.last.onend?.());fireEvent.click(screen.getByRole("button",{name:"Detener"}));
  act(()=>vi.advanceTimersByTime(300));expect(mocks.start).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"Iniciar micrófono"}));
  act(()=>{RestartRecognition.last.onerror?.({error:"not-allowed"});RestartRecognition.last.onend?.();vi.advanceTimersByTime(300);});
  expect(mocks.start).toHaveBeenCalledTimes(2);expect(screen.getByRole("alert")).toHaveTextContent("bloqueó");
 }finally{cleanup();vi.useRealTimers();}
});
async function analyze(){fireEvent.change(screen.getByLabelText("Transcripción editable"),{target:{value:"Yo pagué 500 de pizza para Pablo"}});fireEvent.click(screen.getByRole("checkbox",{name:/Confirmo este texto/}));fireEvent.click(screen.getByRole("button",{name:"Confirmar texto y analizar"}));await screen.findAllByLabelText("Concepto");}
it("keeps typed transcription editable and supports incompatible browsers",()=>{mount();fireEvent.click(screen.getByRole("button",{name:"Iniciar micrófono"}));expect(screen.getByRole("alert")).toHaveTextContent("no admite");fireEvent.change(screen.getByLabelText("Transcripción editable"),{target:{value:"Pizza 500"}});expect(screen.getByLabelText("Transcripción editable")).toHaveValue("Pizza 500");expect(mocks.analyze).not.toHaveBeenCalled();});
it("requires text consent and financial confirmation before saving",async()=>{mount();expect(screen.getByRole("button",{name:"Confirmar texto y analizar"})).toBeDisabled();await analyze();const save=screen.getByRole("button",{name:"Confirmar y guardar gasto"});expect(save).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("checkbox",{name:/Revisé el texto/}));fireEvent.click(save);await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));expect(mocks.save.mock.calls[0][0].get("confirmed")).toBe("yes");});
it("asks one local question and preserves extracted facts without another Gemini call",async()=>{mocks.analyze.mockResolvedValue({...result,data:{...result.data,items:[{...result.data.items[0],payer:null,consumers:[]}]}});mount();fireEvent.change(screen.getByLabelText("Transcripción editable"),{target:{value:"Pizza 500"}});fireEvent.click(screen.getByRole("checkbox",{name:/Confirmo este texto/}));fireEvent.click(screen.getByRole("button",{name:"Confirmar texto y analizar"}));await screen.findByRole("heading",{name:"¿Quién pagó Pizza?"});fireEvent.change(screen.getByLabelText("Pagador pendiente"),{target:{value:person.id}});fireEvent.click(screen.getByRole("button",{name:"Continuar"}));expect(screen.getByText("¿Quiénes consumieron Pizza?")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Pablo"}));fireEvent.click(screen.getByRole("button",{name:"Continuar"}));expect(await screen.findByLabelText("Concepto")).toHaveValue("Pizza");expect(mocks.analyze).toHaveBeenCalledTimes(1);});
it("blocks multiple expense persistence and inconsistent totals",async()=>{mocks.analyze.mockResolvedValue({...result,data:{...result.data,items:[result.data.items[0],result.data.items[0]]}});mount();await analyze();expect(screen.getByText(/guardado múltiple está bloqueado/)).toBeInTheDocument();expect(screen.getByText(/El total narrado no coincide/)).toBeInTheDocument();expect(screen.getByRole("button",{name:"Confirmar y guardar gasto"})).toBeDisabled();});
it("transcribes, stops, handles denied permissions and aborts on unmount",()=>{class MockRecognition {static last:MockRecognition;onresult?: (e:unknown)=>void;onerror?:(e:unknown)=>void;start=mocks.start;stop=mocks.stop;abort=mocks.abort;constructor(){MockRecognition.last=this;}}Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:MockRecognition});mount();fireEvent.click(screen.getByRole("button",{name:"Iniciar micrófono"}));expect(mocks.start).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole("button",{name:"Detener"}));expect(mocks.stop).toHaveBeenCalledOnce();expect(MockRecognition.last).toBeDefined();cleanup();expect(mocks.abort).toHaveBeenCalledOnce();});


