import { z } from "zod";
import { SERVICES } from "./services";

/** Digits only; 10 digits get a +7 prefix, a leading 8 or 7 is read as the country code. Returns null for anything else. */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) digits = digits.slice(1);
  return digits.length === 10 ? `+7${digits}` : null;
}

const serviceIds = SERVICES.map((s) => s.id) as [string, ...string[]];

export const leadInputSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя, минимум 2 символа").max(80, "Слишком длинное имя"),
  phone: z
    .string()
    .trim()
    .refine((v) => normalizePhone(v) !== null, "Введите телефон в формате +7 900 123-45-67")
    .transform((v) => normalizePhone(v) as string),
  email: z.string().trim().max(120, "Слишком длинный адрес").pipe(z.email("Проверьте адрес почты")),
  serviceId: z.enum(serviceIds, "Выберите услугу"),
  comment: z.string().trim().max(1000, "Не больше 1000 символов"),
});

export type LeadInput = z.input<typeof leadInputSchema>;
export type LeadData = z.output<typeof leadInputSchema>;
export type LeadFieldErrors = Partial<Record<keyof LeadInput, string>>;

export type ParseResult = { ok: true; data: LeadData } | { ok: false; errors: LeadFieldErrors };

/** One entry point for the form and the API route, so both reject the same inputs. */
export function parseLeadInput(input: unknown): ParseResult {
  const res = leadInputSchema.safeParse(input);
  if (res.success) return { ok: true, data: res.data };
  const fieldErrors = z.flattenError(res.error).fieldErrors as Record<string, string[] | undefined>;
  const errors: LeadFieldErrors = {};
  for (const [k, v] of Object.entries(fieldErrors)) if (v?.[0]) errors[k as keyof LeadInput] = v[0];
  return { ok: false, errors };
}

/** Anti-spam and idempotency fields the form sends next to the lead fields. */
export const submissionMetaSchema = z.object({
  /** Generated once per form fill: resending the same fill (double click, network retry) returns the same lead. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** Honeypot: hidden from people, so any value means a bot. */
  website: z.string().max(200).optional(),
  /** Epoch ms when the form was shown. */
  startedAt: z.number().optional(),
});

/** A lead typed in by staff: the email may be empty (phone calls), and a responsible person can be chosen. */
export const manualLeadSchema = leadInputSchema.extend({
  email: z
    .string()
    .trim()
    .max(120, "Слишком длинный адрес")
    .refine((v) => v === "" || z.email().safeParse(v).success, "Проверьте адрес почты"),
  assigneeId: z.string().trim().max(60).optional(),
});

export type ManualLeadData = z.output<typeof manualLeadSchema>;
