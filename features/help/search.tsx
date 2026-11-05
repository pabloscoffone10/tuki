"use client";
import { useState } from "react";
import { searchFaq } from "./faq";
import { Field, inputClass } from "@/features/groups/components/fields";
export function HelpSearch() {
  const [query, setQuery] = useState(""); const results = searchFaq(query);
  return <div className="space-y-6"><Field label="Buscar en la ayuda"><input type="search" className={inputClass} value={query} onChange={e => setQuery(e.target.value)} placeholder="Por ejemplo: pagos o invitados"/></Field><p role="status" className="text-sm text-muted-foreground">{results.length ? `${results.length} preguntas` : "No encontramos preguntas. Probá con otras palabras o enviá una consulta."}</p>{[...new Set(results.map(f => f.category))].map(category => <section key={category} className="space-y-3"><h2 className="text-lg font-semibold">{category}</h2>{results.filter(f => f.category === category).map(f => <details key={f.question} className="rounded-xl border bg-card p-4"><summary className="cursor-pointer py-2 text-sm font-medium">{f.question}</summary><p className="mt-3 text-sm leading-7 text-muted-foreground">{f.answer}</p></details>)}</section>)}</div>;
}
