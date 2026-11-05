import { z } from "zod";
export const feedbackCategories = { sugerencia: "Sugerencia", error: "Error", consulta: "Consulta", otros: "Otros" } as const;
export const feedbackSchema = z.object({ category: z.enum(["sugerencia", "error", "consulta", "otros"]), description: z.string().trim().min(1, "Ingresá una descripción.").max(4000, "Usá hasta 4000 caracteres."), email: z.union([z.literal(""), z.email("Revisá el correo.").max(254)]), website: z.literal("") });
