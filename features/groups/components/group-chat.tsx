"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  Copy,
  Bell,
  BellOff,
  LoaderCircle,
  MessageCircle,
  MoreVertical,
  SendHorizontal,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Avatar } from "@/features/avatars/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "../types";

type ChatMessage = {
  id: string;
  group_id: string;
  sender_person_id: string | null;
  client_message_id: string | null;
  content: string;
  message_kind: "user" | "system";
  system_event_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
  delivery?: "sending" | "failed";
};

type GroupChatProps = {
  group: { id: string; name: string; archived_at?: string | null };
  admin: boolean;
  personId: string | null;
  members: Member[];
};

const pageSize = 50;
const timeFormatter = new Intl.DateTimeFormat("es-UY", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Montevideo",
});
const dateFormatter = new Intl.DateTimeFormat("es-UY", {
  dateStyle: "long",
  timeZone: "America/Montevideo",
});
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messageMenuItemClass = "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (
    typeof message.id !== "string" || !uuidPattern.test(message.id)
    || typeof message.group_id !== "string" || !uuidPattern.test(message.group_id)
    || typeof message.content !== "string"
    || typeof message.created_at !== "string" || !Number.isFinite(Date.parse(message.created_at))
    || (message.deleted_at !== null && typeof message.deleted_at !== "string")
    || (message.sender_person_id !== null && (typeof message.sender_person_id !== "string" || !uuidPattern.test(message.sender_person_id)))
    || (message.client_message_id !== null && (typeof message.client_message_id !== "string" || !uuidPattern.test(message.client_message_id)))
    || (message.system_event_key !== null && typeof message.system_event_key !== "string")
    || !message.metadata || typeof message.metadata !== "object" || Array.isArray(message.metadata)
  ) return false;
  if (message.message_kind === "user") {
    return typeof message.sender_person_id === "string" && typeof message.client_message_id === "string" && message.system_event_key === null;
  }
  return message.message_kind === "system" && message.sender_person_id === null
    && message.client_message_id === null && typeof message.system_event_key === "string";
}

function messageOrder(a: ChatMessage, b: ChatMessage) {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function initialsFor(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toLocaleUpperCase("es-UY") || "?";
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const next = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const sameId = next.get(message.id);
    if (sameId?.deleted_at && !message.deleted_at) continue;
    if (message.client_message_id) {
      for (const [id, existing] of next) {
        if (existing.client_message_id === message.client_message_id && !(existing.deleted_at && !message.deleted_at)) next.delete(id);
      }
    }
    next.set(message.id, message);
  }
  return [...next.values()].sort(messageOrder);
}

function expenseSuggestion(text: string) {
  const matches = [...text.matchAll(/(?:\$|UYU\s*)(\d+(?:[,.]\d{1,2})?)/gi)];
  if (matches.length !== 1) return null;
  const amount = matches[0][1].replace(",", ".");
  const title = text
    .replace(matches[0][0], " ")
    .replace(/^\s*(?:yo\s+)?(?:pagu[eé]|pagamos|compr[eé]|gast[eé])\s+/i, "")
    .replace(/^\s*(?:de|por|para|en)\s+/i, "")
    .replace(/^\s*(?:la|el|los|las|un|una)\s+/i, "")
    .replace(/[.!?;,:]+$/g, "")
    .trim()
    .slice(0, 120);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) return null;
  return { amount, title: title || "Gasto sugerido desde el chat" };
}

function messageHref(message: ChatMessage, groupId: string, personId: string | null, admin: boolean) {
  const href = message.metadata.href;
  if (typeof href !== "string") return undefined;
  if (href.startsWith("/gastos/")) return href;
  if (href.startsWith(`/pagos?grupo=${groupId}#pago-`)) {
    const isParty = message.metadata.payerId === personId || message.metadata.receiverId === personId;
    if (isParty || (message.metadata.scope === "group" && admin)) return href;
  }
  return undefined;
}

type MessageActionsProps = {
  authorName: string;
  groupId: string;
  suggestion: { amount: string; title: string } | null;
  archived: boolean;
  canDelete: boolean;
  onCopy: () => void;
  onDelete: () => void;
};

function MessageActions({ authorName, groupId, suggestion, archived, canDelete, onCopy, onDelete }: MessageActionsProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Opciones del mensaje de ${authorName}`}
          className="size-11 shrink-0 rounded-full sm:min-h-8 sm:pointer-events-none sm:size-8 sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-xl border bg-card p-1.5 text-card-foreground shadow-lg">
          <DropdownMenu.Item className={messageMenuItemClass} onSelect={onCopy}>
            <Copy className="size-4" aria-hidden="true" />Copiar
          </DropdownMenu.Item>
          {suggestion && !archived && (
            <DropdownMenu.Item className={messageMenuItemClass} asChild>
              <Link href={`/grupos/${groupId}/gastos/nuevo?title=${encodeURIComponent(suggestion.title)}&amount=${encodeURIComponent(suggestion.amount)}`}>
                Crear gasto
              </Link>
            </DropdownMenu.Item>
          )}
          {canDelete && (
            <DropdownMenu.Item className={`${messageMenuItemClass} text-destructive`} onSelect={onDelete}>
              <Trash2 className="size-4" aria-hidden="true" />Eliminar
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function GroupChat({ group, admin, personId, members }: GroupChatProps) {
  const archived = !!group.archived_at;
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting" | "offline">("connecting");
  const [error, setError] = useState("");
  const [newMessages, setNewMessages] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prependHeightRef = useRef<number | null>(null);
  const followLatestRef = useRef(false);
  const wasNearBottomRef = useRef(true);

  const nearBottom = useCallback(() => {
    const element = scrollRef.current;
    return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }, []);

  const markRead = useCallback(async (client: SupabaseClient) => {
    if (!personId) return;
    try {
      const { error: markError } = await client.rpc("tuki_group_chat_mark_read", { p_group_id: group.id });
      if (markError) setError("No pudimos actualizar el estado de lectura. Volvé a abrir el chat para reintentar.");
    } catch {
      setError("No pudimos actualizar el estado de lectura. Volvé a abrir el chat para reintentar.");
    }
  }, [group.id, personId]);

  useEffect(() => {
    let active = true;
    let client: SupabaseClient;
    const onOffline = () => active && setConnection("offline");
    const onOnline = () => active && setConnection("reconnecting");

    try {
      client = createClient();
    } catch {
      queueMicrotask(() => {
        if (active) {
          setLoading(false);
          setError("El chat no puede conectarse porque falta configurar Supabase en este entorno.");
        }
      });
      return () => { active = false; };
    }
    queueMicrotask(() => { if (active) setSupabase(client); });

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    if (personId) {
      void (async () => {
        try {
          const { data, error: preferenceError } = await client.from("group_chat_preferences").select("muted")
            .eq("group_id", group.id).eq("person_id", personId).maybeSingle<{ muted: boolean }>();
          if (!active) return;
          if (preferenceError) setError("No pudimos cargar las preferencias del chat.");
          else setMuted(data?.muted ?? false);
        } catch {
          if (active) setError("No pudimos cargar las preferencias del chat.");
        }
      })();
    }

    const subscriptionName = `group-chat:${group.id}:${personId ?? "unlinked"}`;
    const channel = client.channel(subscriptionName)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "group_chat_messages",
        filter: `group_id=eq.${group.id}`,
      }, (payload) => {
        const row = payload.new ?? payload.old;
        if (!isChatMessage(row) || row.group_id !== group.id) return;
        if (payload.eventType === "DELETE") {
          setMessages((existing) => existing.filter((message) => message.id !== row.id));
          return;
        }
        const isNew = payload.eventType === "INSERT";
        const atEnd = nearBottom();
        if (isNew && atEnd) followLatestRef.current = true;
        setMessages((existing) => mergeMessages(existing, [row]));
        if (isNew && row.sender_person_id !== personId && !atEnd) {
          setNewMessages((count) => count + 1);
        }
        if (isNew && atEnd && document.visibilityState === "visible") void markRead(client);
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "group_chat_preferences",
        filter: `group_id=eq.${group.id}`,
      }, (payload) => {
        const value = (payload.new as { muted?: unknown }).muted;
        if (typeof value === "boolean") setMuted(value);
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setConnection("connected");
          setError("");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection(navigator.onLine ? "reconnecting" : "offline");
        }
      });
    void (async () => {
      try {
        const { data, error: loadError } = await client.from("group_chat_messages").select("*").eq("group_id", group.id)
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .limit(pageSize).returns<ChatMessage[]>();
        if (!active) return;
        if (loadError) {
          setError("No pudimos cargar los mensajes. Revisá que la migración de chat esté aplicada y reintentá.");
          return;
        }
        const page = [...(data ?? [])].reverse();
        followLatestRef.current = true;
        setMessages((existing) => mergeMessages(existing, page));
        setHasOlder(page.length === pageSize);
        await markRead(client);
      } catch {
        if (active) setError("No pudimos cargar los mensajes. Revisá tu conexión e intentá de nuevo.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && nearBottom()) void markRead(client);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (channel) void client.removeChannel(channel);
    };
  }, [group.id, markRead, nearBottom, personId]);

  useLayoutEffect(() => {
    const oldHeight = prependHeightRef.current;
    const element = scrollRef.current;
    if (oldHeight !== null && element) {
      element.scrollTop += element.scrollHeight - oldHeight;
      prependHeightRef.current = null;
      followLatestRef.current = false;
    } else if (followLatestRef.current && element) {
      element.scrollTop = element.scrollHeight;
      followLatestRef.current = false;
    }
  }, [messages]);

  const persistMessage = useCallback(async (content: string, clientMessageId: string) => {
    if (!supabase || !personId || archived) return;
    setError("");
    const optimistic: ChatMessage = {
      id: clientMessageId,
      group_id: group.id,
      sender_person_id: personId,
      client_message_id: clientMessageId,
      content,
      message_kind: "user",
      system_event_key: null,
      metadata: {},
      created_at: new Date().toISOString(),
      deleted_at: null,
      delivery: "sending",
    };
    setMessages((existing) => mergeMessages(existing, [optimistic]));
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });

    let data: unknown;
    let sendError: { code?: string; message: string } | null = null;
    try {
      const response = await supabase.rpc("tuki_send_group_chat_message", {
        p_group_id: group.id,
        p_client_message_id: clientMessageId,
        p_content: content,
      });
      data = response.data;
      sendError = response.error;
    } catch {
      sendError = { message: "network_error" };
    }
    if (sendError) {
      setMessages((existing) => existing.map((message) =>
        message.client_message_id === clientMessageId ? { ...message, delivery: "failed" } : message,
      ));
      setError(sendError.code === "P0001" && sendError.message.includes("chat_rate_limited")
        ? "Estás enviando mensajes muy rápido. Esperá un momento."
        : "No se pudo enviar el mensaje. Podés reintentar sin duplicarlo.");
      return;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!isChatMessage(saved) || saved.group_id !== group.id || saved.client_message_id !== clientMessageId) {
      setMessages((existing) => existing.map((message) =>
        message.client_message_id === clientMessageId ? { ...message, delivery: "failed" } : message,
      ));
      setError("El servidor no devolvió el mensaje guardado. Reintentá con el mismo identificador.");
      return;
    }
    setMessages((existing) => mergeMessages(existing, [saved]));
    void markRead(supabase);
  }, [archived, group.id, markRead, personId, supabase]);

  const sendDraft = useCallback(() => {
    const content = draft.trim();
    if (!supabase || !content || content.length > 2000 || !personId || archived) return;
    void persistMessage(content, crypto.randomUUID());
  }, [archived, draft, persistMessage, personId, supabase]);

  const retryMessage = (message: ChatMessage) => {
    if (!message.client_message_id) return;
    setMessages((existing) => existing.map((item) =>
      item.client_message_id === message.client_message_id ? { ...item, delivery: "sending" } : item,
    ));
    void persistMessage(message.content, message.client_message_id);
  };

  const loadOlder = async () => {
    const first = messages[0];
    if (!supabase || !first || loadingOlder) return;
    setLoadingOlder(true);
    const element = scrollRef.current;
    prependHeightRef.current = element?.scrollHeight ?? null;
    try {
      const { data, error: olderError } = await supabase.from("group_chat_messages").select("*")
        .eq("group_id", group.id)
        .or(`created_at.lt.${first.created_at},and(created_at.eq.${first.created_at},id.lt.${first.id})`)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .limit(pageSize).returns<ChatMessage[]>();
      if (olderError) {
        prependHeightRef.current = null;
        setError("No pudimos cargar mensajes anteriores. Reintentá.");
        return;
      }
      const page = [...(data ?? [])].reverse();
      setMessages((existing) => mergeMessages(existing, page));
      setHasOlder(page.length === pageSize);
    } catch {
      prependHeightRef.current = null;
      setError("No pudimos cargar mensajes anteriores. Reintentá.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const setSilenced = async () => {
    if (!supabase) return;
    const next = !muted;
    try {
      const { error: preferenceError } = await supabase.rpc("tuki_group_chat_set_muted", {
        p_group_id: group.id,
        p_muted: next,
      });
      if (preferenceError) setError("No pudimos guardar el silencio del chat.");
      else setMuted(next);
    } catch {
      setError("No pudimos guardar el silencio del chat.");
    }
  };

  const deleteMessage = async (message: ChatMessage) => {
    if (!supabase || !window.confirm("¿Eliminar este mensaje? Los demás verán «Mensaje eliminado».")) return;
    try {
      const { error: deleteError } = await supabase.rpc("tuki_group_chat_delete_message", {
        p_group_id: group.id,
        p_message_id: message.id,
        p_confirm: true,
      });
      if (deleteError) setError("No se pudo eliminar el mensaje. Puede que ya no tengas permiso en este grupo.");
    } catch {
      setError("No se pudo eliminar el mensaje. Puede que ya no tengas permiso en este grupo.");
    }
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setError("");
    } catch {
      setError("No pudimos copiar el mensaje.");
    }
  };

  const scrollToLatest = () => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setNewMessages(0);
    if (supabase) void markRead(supabase);
  };

  const memberByPerson = new Map(members.map((member) => [member.person_id, member]));
  const activeParticipants = members.filter((member) => member.status === "active").length;

  return (
    <section className="space-y-2.5">
      <header className="flex min-h-12 items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">Chat del grupo</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{activeParticipants} {activeParticipants === 1 ? "participante" : "participantes"}</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-1.5 rounded-full ${
                connection === "connected" ? "bg-emerald-500" : connection === "offline" ? "bg-destructive" : "bg-amber-500"
              }`} />
              {connection === "connected" ? "Conectado" : connection === "offline" ? "Sin conexión" : connection === "connecting" ? "Conectando…" : "Reconectando…"}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 rounded-full"
          onClick={() => void setSilenced()}
          aria-label={muted ? "Activar sonido del chat" : "Silenciar chat"}
          aria-pressed={muted}
          title={muted ? "Activar sonido del chat" : "Silenciar chat"}
        >
          {muted ? <BellOff className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}
        </Button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {(connection === "offline" || connection === "reconnecting") && (
        <p role="status" className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
          {connection === "offline" ? "Sin conexión. Los mensajes pendientes se pueden reintentar." : "Reconectando al chat…"}
        </p>
      )}
      {archived && <p role="status" className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">Grupo archivado: historial disponible en modo lectura.</p>}

      <div className="flex h-[min(72dvh,48rem)] min-h-96 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div ref={scrollRef} onScroll={() => {
          const atEnd = nearBottom();
          if (atEnd) {
            setNewMessages(0);
            if (!wasNearBottomRef.current && supabase) void markRead(supabase);
          }
          wasNearBottomRef.current = atEnd;
        }} className="min-h-0 flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto p-3 sm:p-4">
          {hasOlder && (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder && <LoaderCircle className="mr-2 size-4 animate-spin" />}
                Cargar mensajes anteriores
              </Button>
            </div>
          )}
          {loading && <p role="status" className="py-8 text-center text-sm text-muted-foreground">Cargando mensajes…</p>}
          {!loading && messages.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <MessageCircle className="mb-3 size-8 text-primary/60" aria-hidden="true" />
              <p className="font-medium">Todavía no hay mensajes</p>
              <p className="mt-1 text-sm text-muted-foreground">Empezá la conversación de este grupo.</p>
            </div>
          )}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const day = new Date(message.created_at).toDateString();
            const showDate = !previous || new Date(previous.created_at).toDateString() !== day;
            const own = message.sender_person_id === personId;
            const isUserMessage = message.message_kind === "user";
            const sameAsPrevious = !!previous && !showDate && isUserMessage
              && previous.message_kind === "user" && previous.sender_person_id === message.sender_person_id;
            const sameAsNext = !!next && new Date(next.created_at).toDateString() === day && isUserMessage
              && next.message_kind === "user" && next.sender_person_id === message.sender_person_id;
            const author = message.sender_person_id ? memberByPerson.get(message.sender_person_id)?.person : null;
            const suggestion = message.message_kind === "user" && !message.deleted_at ? expenseSuggestion(message.content) : null;
            const href = messageHref(message, group.id, personId, admin);
            return (
              <div key={message.id} className={sameAsPrevious ? "mt-0.5" : "mt-2"}>
                {showDate && (
                  <div className="my-3 flex items-center gap-3 text-[10px] font-medium text-muted-foreground">
                    <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
                    <time dateTime={message.created_at}>{dateFormatter.format(new Date(message.created_at))}</time>
                    <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
                  </div>
                )}
                <article className={`group flex w-full items-end gap-1.5 ${own ? "justify-end" : "justify-start"}`}>
                  {!own && isUserMessage && (
                    <span className="mb-0.5 inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                      {!sameAsNext && (author?.user_id
                        ? <span className="scale-[0.58]"><Avatar kind="profile" targetId={author.user_id} name={author.display_name} fallback="initials" /></span>
                        : <span className="text-[9px] font-semibold text-primary">{initialsFor(author?.display_name ?? "Participante")}</span>)}
                    </span>
                  )}
                  {own && isUserMessage && !message.deleted_at && (
                    <MessageActions
                      authorName={author?.display_name ?? "Vos"}
                      groupId={group.id}
                      suggestion={suggestion}
                      archived={archived}
                      canDelete={message.delivery !== "sending"}
                      onCopy={() => void copyMessage(message.content)}
                      onDelete={() => void deleteMessage(message)}
                    />
                  )}
                  <div className={`group relative w-fit max-w-[min(78%,42rem)] rounded-2xl px-3 py-2 text-sm leading-5 shadow-sm ${
                    isUserMessage
                      ? own
                        ? `bg-primary text-primary-foreground ${sameAsPrevious ? "rounded-tr-lg" : "rounded-tr-md"} ${sameAsNext ? "rounded-br-lg" : "rounded-br-md"}`
                        : `border border-border/70 bg-muted/60 text-foreground ${sameAsPrevious ? "rounded-tl-lg" : "rounded-tl-md"} ${sameAsNext ? "rounded-bl-lg" : "rounded-bl-md"}`
                      : "mx-auto max-w-[90%] rounded-xl bg-muted/50 px-3 py-1.5 text-center text-xs text-muted-foreground shadow-none"
                  }`}>
                    {message.message_kind === "system" ? (
                      <>
                        <p>{message.content}</p>
                        {href && <Link className="mt-1 inline-block underline underline-offset-2" href={href}>Ver detalle</Link>}
                        <time className="mt-1 block text-[10px] opacity-70" dateTime={message.created_at}>{timeFormatter.format(new Date(message.created_at))}</time>
                      </>
                    ) : (
                      <>
                        {!sameAsPrevious && !own && (
                          <p className="mb-0.5 text-[11px] font-medium leading-4 text-primary">{author?.display_name ?? "Participante"}</p>
                        )}
                        <p className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${message.deleted_at ? "italic opacity-75" : ""}`}>
                          {message.deleted_at ? "Mensaje eliminado" : message.content}
                        </p>
                        <div className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] leading-3 ${own ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                          <time dateTime={message.created_at}>{timeFormatter.format(new Date(message.created_at))}</time>
                          {message.delivery === "sending" && <LoaderCircle className="size-3 animate-spin" aria-label="Enviando" />}
                          {own && message.delivery !== "sending" && !message.delivery && <Check className="size-3" aria-label="Enviado" />}
                          {message.delivery === "failed" && (
                            <button type="button" className="underline" onClick={() => retryMessage(message)}>Reintentar</button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {!own && isUserMessage && !message.deleted_at && (
                    <MessageActions
                      authorName={author?.display_name ?? "Participante"}
                      groupId={group.id}
                      suggestion={suggestion}
                      archived={archived}
                      canDelete={admin && message.delivery !== "sending"}
                      onCopy={() => void copyMessage(message.content)}
                      onDelete={() => void deleteMessage(message)}
                    />
                  )}
                </article>
              </div>
            );
          })}
        </div>

        {newMessages > 0 && (
          <div className="flex justify-center border-t bg-card p-2">
            <Button type="button" size="sm" variant="outline" onClick={scrollToLatest}>
              <ArrowDown className="mr-2 size-4" aria-hidden="true" />
              {newMessages} {newMessages === 1 ? "mensaje nuevo" : "mensajes nuevos"}
            </Button>
          </div>
        )}

        {!archived && (
          <form onSubmit={(event) => { event.preventDefault(); sendDraft(); }} className="sticky bottom-0 flex items-end gap-2 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <label className="sr-only" htmlFor={`chat-message-${group.id}`}>Escribí un mensaje</label>
            <textarea
              id={`chat-message-${group.id}`}
              ref={textareaRef}
              value={draft}
              rows={1}
              maxLength={2000}
              disabled={!supabase || !personId || connection === "offline"}
              placeholder="Escribí un mensaje..."
              onChange={(event) => {
                setDraft(event.target.value);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  sendDraft();
                }
              }}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <Button type="submit" size="icon" aria-label="Enviar mensaje" disabled={!supabase || !draft.trim() || draft.length > 2000 || !personId || connection === "offline"}>
              <SendHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </form>
        )}
      </div>
      {!personId && <p role="status" className="text-xs text-muted-foreground">Solo las cuentas vinculadas a una persona activa del grupo pueden enviar mensajes.</p>}
    </section>
  );
}
