const publicPaths = new Set(["/ayuda", "/feedback", "/login", "/registro", "/recuperar-contrasena"]);

export function isPublicPath(pathname: string) {
  return publicPaths.has(pathname) || pathname === "/auth/callback" || pathname === "/auth/confirm";
}

// Only known private destinations. Never trust a return URL supplied by a user.
export function safeNext(value: unknown): string {
  if (typeof value === "string" && /^\/invitaciones\/[a-f0-9]{64}$/.test(value)) return value;
  if (typeof value !== "string" || !/^\/(?:$|grupos(?:\/|$)|gastos(?:\/|$)|personas(?:\/|$)|notificaciones(?:\/|$)|balances(?:\/|$)|pagos(?:\/|$)|actividad(?:\/|$)|configuracion(?:\/|$)|ayuda(?:\/|$)|actualizar-contrasena$)/.test(value)) return "/";
  if (/[\\\u0000-\u0020%?#]/.test(value) || value.includes("//") || value.split("/").some((part) => part === "." || part === "..")) return "/";
  return value;
}

export function loginDestination(pathname: string) {
  const next = safeNext(pathname);
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
