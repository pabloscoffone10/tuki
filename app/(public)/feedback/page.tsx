import { FeedbackForm } from "@/features/feedback/form";
export const metadata = { title: "Enviar sugerencia" };
export default function FeedbackPage() { return <><h1 className="text-3xl font-semibold tracking-tight">Enviar sugerencia</h1><p className="text-sm leading-7 text-muted-foreground">Compartí una idea, informá un error o enviá una consulta. Si iniciaste sesión, el reporte quedará asociado a tu cuenta. Tu correo es opcional.</p><FeedbackForm/></>; }
