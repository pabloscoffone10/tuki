vi.mock("@/features/finance/components/views",()=>({ExpenseList:()=>null,GroupFinance:()=>null}));
vi.mock("@/features/reports/statistics",()=>({GroupStatisticsPanel:()=>null}));
vi.mock("@/features/reports/expense-browser",()=>({ExpenseBrowser:()=>null}));
vi.mock("@/features/reports/history",()=>({FinancialHistory:()=>null}));
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getGroup: vi.fn() }));
vi.mock("@/features/groups/data", () => ({ getGroup: mocks.getGroup }));
vi.mock("@/features/finance/actions", () => ({ safeRemoval: async () => ({}) }));
// This test exercises membership privacy; financial projections have SQL and board tests.
vi.mock("@/features/payments/components/workspace",()=>({GroupDebtControl:()=>null}));
vi.mock("@/features/groups/actions", () => ({
  createGroup: async () => ({}), updateGroup: async () => ({}), addGuest: async () => ({}), archiveGroup: async () => ({}),
  changeMember: async () => ({}), createInvitation: async () => ({}), renameGuest: async () => ({}), revokeInvitation: async () => ({}), replaceGuest: async () => ({}),
}));
import { GroupDetail } from "@/features/groups/components/group-detail";

it("muestra la participación histórica sin inventar datos de una persona oculta por RLS", async () => {
  const groupId = "00000000-0000-4000-8000-000000000001";
  mocks.getGroup.mockResolvedValue({
    group: { id: groupId, name: "Grupo", description: "", kind: "permanent", created_at: "2026-11-01T12:00:00Z", archived_at: null },
    members: [{ person_id: "00000000-0000-4000-8000-000000000002", person: null, role: "member", status: "retired", joined_at: "2026-11-01T12:00:00Z" }],
    admin: false, me: undefined, userId: "current", people: [], invitations: [], events: [],
  });
  render(await GroupDetail({ params: Promise.resolve({ groupId }),searchParams:Promise.resolve({seccion:"personas"}) }));
  expect(screen.getAllByText("Identidad restringida").length).toBeGreaterThan(0);
  expect(screen.getByText("Retirado")).toBeVisible();
  expect(screen.queryByText("Sin cuenta")).not.toBeInTheDocument();
  expect(screen.queryByText("Con cuenta")).not.toBeInTheDocument();
  expect(screen.queryByText("Gestionar participación")).not.toBeInTheDocument();
});
