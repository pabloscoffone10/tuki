import { Handshake, Layers3, ReceiptText, UsersRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PhaseNotice } from "@/components/shared/phase-notice";
export const metadata = { title: "Cómo funciona" };
export default function HelpPage() {
  return <div className="max-w-3xl space-y-7"><div><p className="mb-2 text-xs font-medium text-primary">Compartir, sin vueltas.</p><h1 className="text-3xl font-semibold tracking-tight">Más planes. Menos cuentas.</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">Tuki está tomando forma. Así va a acompañar tus próximos planes.</p></div><div className="grid gap-4 sm:grid-cols-2">{[
    { icon: UsersRound, title: "Juntá a tu gente", text: "Un grupo para un viaje, una salida o los planes de siempre. Con amigos que tengan cuenta y con invitados." },
    { icon: ReceiptText, title: "Compartí los gastos", text: "Registrá quién pagó y cómo se reparte. Los importes finales siempre serán en pesos uruguayos." },
    { icon: Layers3, title: "Una deuda, varias vistas", text: "Si dos personas comparten varios grupos, su deuda se verá en todos ellos sin duplicarse. Los detalles del gasto seguirán limitados al grupo de origen." },
    { icon: Handshake, title: "Cerrá las cuentas", text: "Registrá pagos realizados fuera de Tuki. Solo la confirmación autorizada reduce deudas, incluso de grupos archivados." },
  ].map(({ icon: Icon, title, text }) => <Card key={title} className="p-6"><Icon className="mb-5 size-6 text-primary" strokeWidth={1.5} aria-hidden="true" /><h2 className="text-sm font-semibold">{title}</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">{text}</p></Card>)}</div><p className="text-xs leading-6 text-muted-foreground">Ya podés gestionar grupos y registrar gastos con repartos exactos. Las deudas se compensan únicamente entre las mismas dos personas. Ya podés registrar pagos parciales o completos, confirmar su recepción y conservar su historial. Tuki no realiza transferencias bancarias.</p><PhaseNotice label="Cómo empezar" /></div>;
}
