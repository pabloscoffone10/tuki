import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, registerSchema } from "@/features/auth/schemas";
import { isPublicPath, loginDestination, safeNext } from "@/features/auth/redirects";

describe("validaciones de autenticación", () => {
  it("valida registro y coincidencia sin recortar contraseñas", () => {
    const input = { displayName: " Ana ", email: " ana@example.com ", password: " una clave segura ", confirmPassword: " una clave segura " };
    const result = registerSchema.parse(input);
    expect(result.displayName).toBe("Ana");
    expect(result.email).toBe("ana@example.com");
    expect(result.password).toBe(input.password);
    expect(registerSchema.safeParse({ ...input, confirmPassword: "otra contraseña" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, password: "corta" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, email: "inválido" }).success).toBe(false);
  });
  it("admite contraseña de acceso existente y exige seguridad al cambiarla", () => {
    expect(loginSchema.safeParse({ email: "ana@example.com", password: "anterior" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ password: "corta", confirmPassword: "corta" }).success).toBe(false);
  });
});

describe("destinos seguros", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/grupos/%2f%2fevil", "/login", "/auth/callback", "/grupos?next=//evil", "/\n/evil", "/grupos/../login", "/grupos//otro"])("rechaza %s", (path) => {
    expect(safeNext(path)).toBe("/");
  });
  it("solo permite rutas privadas internas y excluye rutas públicas por coincidencia exacta", () => {
    expect(safeNext("/grupos/viaje")).toBe("/grupos/viaje");
    expect(safeNext("/actualizar-contrasena")).toBe("/actualizar-contrasena");
    expect(loginDestination("/pagos")).toBe("/login?next=%2Fpagos");
    expect(isPublicPath("/registro")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/login/privado")).toBe(false);
    expect(isPublicPath("/actualizar-contrasena")).toBe(false);
  });
});
