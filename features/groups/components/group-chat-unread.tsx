"use client";

import { useEffect, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function GroupChatUnread({ groupId, active }: { groupId: string; active: boolean }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let activeEffect = true;
    let client: SupabaseClient;
    try {
      client = createClient();
    } catch {
      return () => { activeEffect = false; };
    }

    const refresh = async () => {
      const { data, error } = await client.rpc("tuki_group_chat_unread_count", { p_group_id: groupId });
      if (activeEffect && !error && typeof data === "number") setUnread(data);
    };
    void refresh();

    let channel: RealtimeChannel | undefined;
    if (!active) {
      channel = client.channel(`group-chat-unread:${groupId}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "group_chat_messages",
          filter: `group_id=eq.${groupId}`,
        }, () => { void refresh(); })
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "group_chat_reads",
          filter: `group_id=eq.${groupId}`,
        }, () => { void refresh(); })
        .subscribe();
    }

    return () => {
      activeEffect = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [active, groupId]);

  const visibleUnread = active ? 0 : unread;
  if (!visibleUnread) return null;
  return (
    <span
      aria-label={`${visibleUnread} mensajes sin leer`}
      className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-5 text-primary-foreground"
    >
      {visibleUnread > 99 ? "99+" : visibleUnread}
    </span>
  );
}
