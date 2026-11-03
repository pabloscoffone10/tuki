// Keep the browser, proxy and server adapters on the same cookie policy.
// httpOnly stays at the SSR default: browser clients need cookie access.
export const supabaseCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
