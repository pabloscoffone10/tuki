import { expect, it } from "vitest";
import { feedbackSchema } from "@/features/feedback/schema";
import { searchFaq } from "@/features/help/faq";
import { isPublicPath } from "@/features/auth/redirects";
it("validates descriptions, categories, email and honeypot", () => {
 const valid = { category:"sugerencia", description:"Una idea",email:"",website:"" };
 expect(feedbackSchema.safeParse(valid).success).toBe(true);
 for(const changes of [{description:"  "},{description:"a".repeat(4001)},{category:"admin"},{email:"wrong"},{website:"spam"}]) expect(feedbackSchema.safeParse({...valid,...changes}).success).toBe(false);
});
it("searches accents, categories and multiple words", () => {
 expect(searchFaq("CONTRASENA").some(f => f.question.includes("contraseña"))).toBe(true);
 expect(searchFaq("pagos parcial")).toHaveLength(1);
 expect(searchFaq("nonexistent")).toHaveLength(0);
 expect(isPublicPath("/ayuda")).toBe(true); expect(isPublicPath("/feedback")).toBe(true); expect(isPublicPath("/feedback/private")).toBe(false);
});
