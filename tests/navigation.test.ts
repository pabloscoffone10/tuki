import { describe, expect, it } from "vitest";
import { isActiveRoute } from "@/lib/navigation";
describe("navegación", () => {
  it("solo marca el resumen como activo en la raíz", () => {
    expect(isActiveRoute("/", "/")).toBe(true);
    expect(isActiveRoute("/grupos", "/")).toBe(false);
  });
  it("identifica subrutas sin confundir prefijos", () => {
    expect(isActiveRoute("/grupos/viaje", "/grupos")).toBe(true);
    expect(isActiveRoute("/grupos", "/grupos")).toBe(true);
    expect(isActiveRoute("/grupos-archivados", "/grupos")).toBe(false);
  });
});
