import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { Member } from "@/features/groups/types";

type TestMessage = {
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
};

const chatGroupId = "30000000-0000-4000-8000-000000000001";
const chatPersonA = "20000000-0000-4000-8000-000000000001";
const chatPersonB = "20000000-0000-4000-8000-000000000002";
const mocks = vi.hoisted(() => ({
  client: null as unknown,
  handlers: [] as Array<(payload: unknown) => void>,
  pages: [] as TestMessage[][],
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("@/features/avatars/avatar", () => ({
  Avatar: ({ name }: { name: string }) => <span aria-label={`Foto de ${name}`}>{name.slice(0, 1)}</span>,
}));

import { GroupChat } from "@/features/groups/components/group-chat";

function makeMessage(overrides: Partial<TestMessage> = {}): TestMessage {
  return {
    id: crypto.randomUUID(),
    group_id: chatGroupId,
    sender_person_id: chatPersonB,
    client_message_id: crypto.randomUUID(),
    content: "Mensaje de prueba",
    message_kind: "user",
    system_event_key: null,
    metadata: {},
    created_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

function createMockClient() {
  const builder = () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      or: () => query,
      returns: async () => ({ data: mocks.pages.shift() ?? [], error: null }),
      maybeSingle: async () => ({ data: { muted: false }, error: null }),
    };
    return query;
  };
  const channel = {
    on: (_event: string, _filter: object, handler: (payload: unknown) => void) => {
      mocks.handlers.push(handler);
      return channel;
    },
    subscribe: (callback: (status: string) => void) => {
      callback("SUBSCRIBED");
      return channel;
    },
  };
  return {
    from: () => builder(),
    rpc: mocks.rpc,
    channel: () => channel,
    removeChannel: vi.fn(),
  };
}

const groupProps = {
  group: { id: chatGroupId, name: "Piria", archived_at: null },
  personId: chatPersonA,
  admin: false,
  members: [
    { group_id: chatGroupId, person_id: chatPersonA, role: "admin", status: "active", joined_at: "", updated_at: "", retired_at: null,
      person: { id: chatPersonA, user_id: "10000000-0000-4000-8000-000000000001", display_name: "Ana", merged_into: null, created_by: "10000000-0000-4000-8000-000000000001", created_at: "", updated_at: "" } },
    { group_id: chatGroupId, person_id: chatPersonB, role: "member", status: "active", joined_at: "", updated_at: "", retired_at: null,
      person: { id: chatPersonB, user_id: "10000000-0000-4000-8000-000000000002", display_name: "Beto", merged_into: null, created_by: "10000000-0000-4000-8000-000000000002", created_at: "", updated_at: "" } },
  ] satisfies Member[],
};

beforeEach(() => {
  mocks.client = createMockClient();
  mocks.handlers = [];
  mocks.pages = [[]];
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "tuki_send_group_chat_message") {
      return {
        error: null,
        data: makeMessage({
          id: "40000000-0000-4000-8000-000000000001",
          group_id: String(args.p_group_id),
          sender_person_id: chatPersonA,
          client_message_id: String(args.p_client_message_id),
          content: String(args.p_content),
        }),
      };
    }
    return { data: null, error: null };
  });
});

it("sends a persistent message with a client id and deduplicates its Realtime echo", async () => {
  const user = userEvent.setup();
  render(<GroupChat {...groupProps} />);

  expect(screen.getByRole("heading", { name: "Chat del grupo" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Silenciar chat" })).toBeInTheDocument();
  const input = await screen.findByRole("textbox", { name: "Escribí un mensaje" });
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, "Hola grupo");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
    "tuki_send_group_chat_message",
    expect.objectContaining({ p_group_id: chatGroupId, p_content: "Hola grupo" }),
  ));
  expect(await screen.findByText("Hola grupo")).toBeInTheDocument();
  const sentArticle = screen.getByText("Hola grupo").closest("article");
  expect(sentArticle).not.toBeNull();
  expect(screen.queryByText("Copiar")).not.toBeInTheDocument();
  await user.click(sentArticle!.querySelector("button")!);
  expect(await screen.findByRole("menuitem", { name: "Copiar" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();

  const sendIndex = mocks.rpc.mock.calls.findIndex(([name]) => name === "tuki_send_group_chat_message");
  const saved = mocks.rpc.mock.results[sendIndex].value as Promise<{ data: TestMessage }>;
  const message = (await saved).data;
  await act(async () => {
    for (const handler of mocks.handlers) {
      handler({ eventType: "INSERT", new: message, old: {} });
      handler({ eventType: "INSERT", new: message, old: {} });
    }
  });
  expect(screen.getAllByText("Hola grupo")).toHaveLength(1);
});

it("loads 50 recent messages, pages older history, and does not resurrect a tombstone on a stale event", async () => {
  const now = Date.now();
  const recent = Array.from({ length: 50 }, (_, index) => makeMessage({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    client_message_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    content: `Mensaje ${index + 1}`,
    created_at: new Date(now - (49 - index) * 1000).toISOString(),
  })).reverse();
  mocks.pages = [recent, [makeMessage({
    id: "00000000-0000-4000-8000-000000000000",
    content: "Mensaje anterior",
    created_at: new Date(now - 100000).toISOString(),
  })]];
  render(<GroupChat {...groupProps} />);

  expect(await screen.findByText("Mensaje 1")).toBeInTheDocument();
  expect(screen.getAllByText("Beto")).toHaveLength(1);
  await userEvent.setup().click(screen.getByRole("button", { name: "Cargar mensajes anteriores" }));
  expect(await screen.findByText("Mensaje anterior")).toBeInTheDocument();

  const suggestion = makeMessage({ id: "50000000-0000-4000-8000-000000000001", content: "Pagué $850 de la cancha" });
  await act(async () => {
    for (const handler of mocks.handlers) handler({ eventType: "INSERT", new: suggestion, old: {} });
  });
  const suggestionArticle = screen.getByText("Pagué $850 de la cancha").closest("article");
  expect(suggestionArticle).not.toBeNull();
  await userEvent.setup().click(suggestionArticle!.querySelector("button")!);
  expect(screen.getByRole("menuitem", { name: "Crear gasto" })).toHaveAttribute(
    "href",
    `/grupos/${chatGroupId}/gastos/nuevo?title=cancha&amount=850`,
  );

  const unsafe = makeMessage({ id: "50000000-0000-4000-8000-000000000002", content: "<img src=x onerror=alert(1)>" });
  await act(async () => {
    for (const handler of mocks.handlers) handler({ eventType: "INSERT", new: unsafe, old: {} });
  });
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  expect(document.querySelector('img[src="x"]')).toBeNull();

  const message = makeMessage({ id: "50000000-0000-4000-8000-000000000003", content: "Contenido privado" });
  await act(async () => {
    for (const handler of mocks.handlers) {
      handler({ eventType: "INSERT", new: message, old: {} });
      handler({ eventType: "UPDATE", new: { ...message, content: "Mensaje eliminado", deleted_at: new Date().toISOString() }, old: message });
      handler({ eventType: "INSERT", new: message, old: {} });
    }
  });
  expect(screen.getByText("Mensaje eliminado")).toBeInTheDocument();
  expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
});
