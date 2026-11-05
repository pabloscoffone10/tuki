import Link from "next/link";
import { Settings2 } from "lucide-react";
import { GroupChatUnread } from "./group-chat-unread";

const sections = [
  ["resumen", "Resumen"],
  ["gastos", "Gastos"],
  ["saldos", "Saldos"],
  ["personas", "Personas"],
  ["chat", "Chat"],
] as const;

export type GroupSection = (typeof sections)[number][0] | "ajustes";

export function groupSection(value: unknown): GroupSection {
  return typeof value === "string" && [...sections.map(([id]) => id), "ajustes"].includes(value)
    ? (value as GroupSection)
    : "resumen";
}

export function GroupNavigation({ groupId, section, admin }: { groupId: string; section: GroupSection; admin: boolean }) {
  return (
    <div className="border-b pb-3">
      <nav aria-label="Secciones del grupo" className="flex min-w-0 gap-1 overflow-x-auto">
        <div className="flex min-w-max flex-1 gap-1">
          {sections.map(([id, label]) => (
            <Link
              key={id}
              prefetch={false}
              scroll={false}
              href={`/grupos/${groupId}?seccion=${id}`}
              aria-current={section === id ? "page" : undefined}
              className={`flex min-h-11 min-w-[110px] shrink-0 items-center justify-center rounded-lg px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm ${
                section === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {label}
              {id === "chat" && <GroupChatUnread groupId={groupId} active={section === "chat"} />}
            </Link>
          ))}
          <Link
            scroll={false}
            href={`/grupos/${groupId}?seccion=ajustes`}
            aria-current={section === "ajustes" ? "page" : undefined}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="size-4" aria-hidden="true" />
            {admin ? "Ajustes e historial" : "Historial del grupo"}
          </Link>
        </div>
      </nav>
    </div>
  );
}
