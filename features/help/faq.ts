export const faqs = [
  { category: "Grupos e invitados", question: "¿Puedo compartir con personas que no tienen cuenta?", answer: "Sí. En un grupo podés agregar invitados o invitar a personas con cuenta mediante un enlace de invitación." },
  { category: "Gastos", question: "¿Cómo puedo repartir un gasto?", answer: "Al registrar el gasto elegís quién pagó y quiénes participan. Podés repartir por partes iguales, porcentajes, importes personalizados en UYU o cantidades proporcionales. Antes de guardar, revisá la vista previa del reparto." },
  { category: "Gastos", question: "¿En qué moneda quedan los importes finales?", answer: "Los importes finales y los balances se expresan en pesos uruguayos (UYU)." },
  { category: "Balances y pagos", question: "¿Tuki realiza transferencias bancarias?", answer: "No. Tuki permite registrar pagos realizados fuera de la aplicación y confirmar su recepción. La transferencia se realiza por fuera de Tuki." },
  { category: "Balances y pagos", question: "¿Puedo registrar un pago parcial?", answer: "Sí. Podés registrar pagos parciales o completos. La deuda se reduce con la confirmación autorizada del pago y se conserva su historial." },
  { category: "Cuenta y acceso", question: "¿Cómo recupero mi contraseña?", answer: "En la pantalla de inicio de sesión elegí la opción para recuperar la contraseña e ingresá tu correo para solicitar el enlace de recuperación." },
  { category: "Ayuda y sugerencias", question: "¿Cómo envío una sugerencia o informo un error?", answer: "Usá Enviar sugerencia. Elegí una categoría y describí lo ocurrido; el correo es opcional. No incluyas contraseñas ni datos bancarios sensibles. La confirmación indica que recibimos el reporte, sin garantizar una respuesta inmediata." },
] as const;
export const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
export function searchFaq(query: string) { const words = normalizeSearch(query).trim().split(/\s+/); return faqs.filter(faq => words.every(word => normalizeSearch(`${faq.category} ${faq.question} ${faq.answer}`).includes(word))); }
