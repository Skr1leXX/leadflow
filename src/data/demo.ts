import { SERVICES } from "@/features/leads/services";
import type { Lead, LeadStatus, SyncEvent } from "@/features/leads/types";

/** Fictional people and companies; every address is on the reserved example.com domain. */
const PEOPLE = [
  ["Анна Воронцова", "anna.vorontsova", "+79001110201"],
  ["Дмитрий Кузнецов", "d.kuznetsov", "+79001110202"],
  ["Елена Морозова", "e.morozova", "+79001110203"],
  ["Игорь Седов", "igor.sedov", "+79001110204"],
  ["Мария Лебедева", "m.lebedeva", "+79001110205"],
  ["Павел Орлов", "p.orlov", "+79001110206"],
  ["Ольга Назарова", "o.nazarova", "+79001110207"],
  ["Сергей Ким", "s.kim", "+79001110208"],
  ["Татьяна Белова", "t.belova", "+79001110209"],
  ["Алексей Федоров", "a.fedorov", "+79001110210"],
  ["Наталья Громова", "n.gromova", "+79001110211"],
  ["Роман Ильин", "r.ilyin", "+79001110212"],
] as const;

const COMMENTS = [
  "Нужно связать сайт с Битрикс24, сейчас заявки переносим руками.",
  "Хотим новый сайт для производственной компании.",
  "",
  "Интересует автоматическое распределение заявок между менеджерами.",
  "Просим прислать примерную оценку и сроки.",
  "",
  "Нужен дашборд по конверсии из заявки в сделку.",
  "Есть сайт на WordPress, нужна доработка формы и передача в CRM.",
  "",
  "Подскажите, как у вас устроена поддержка после запуска?",
];

/** Hours back from "now" for each demo lead, newest first. Spread over about a month. */
const AGES_HOURS = [
  1, 3, 5, 9, 14, 22, 27, 31, 38, 47, 52, 60, 71, 75, 84, 96, 101, 118, 126, 143, 150, 168, 177, 196, 220, 241, 259, 288,
  310, 335, 362, 391, 420, 455, 489, 530, 566, 612, 650, 690,
];

const statusFor = (i: number): LeadStatus => {
  if (i < 5) return "new";
  if (i < 9) return i % 2 ? "in_progress" : "new";
  return (["won", "won", "in_progress", "rejected", "awaiting_reply"] as const)[i % 5];
};

/** Seeded history. Every sync outcome here is simulated, so all of it is flagged `demo`. */
/** `managerIds` are the staff the demo leads are spread across; the newest few stay unassigned. */
export function seedDemo(now: Date, managerIds: readonly string[] = []): { leads: Lead[]; events: SyncEvent[] } {
  const leads: Lead[] = [];
  const events: SyncEvent[] = [];
  let bitrixId = 4100;

  // Two failures to show the error states: one that ran out of automatic attempts, one that needs a person.
  const FAILURES: Record<number, { code: string; error: string; attempts: number }> = {
    2: { code: "QUERY_LIMIT_EXCEEDED", error: "Демо: превышен лимит запросов к REST API", attempts: 6 },
    11: { code: "INSUFFICIENT_SCOPE", error: "Демо: у вебхука нет нужных прав. Добавьте право «CRM» и повторите.", attempts: 1 },
  };

  AGES_HOURS.forEach((hours, i) => {
    const [name, local, phone] = PEOPLE[(i * 5) % PEOPLE.length];
    const createdAt = new Date(now.getTime() - hours * 3_600_000).toISOString();
    const attemptAt = new Date(new Date(createdAt).getTime() + 2_000).toISOString();
    const id = `lead-${String(AGES_HOURS.length - i).padStart(3, "0")}`;
    const failure = FAILURES[i];
    const sync: Lead["sync"] = failure
      ? { status: "failed", attempts: failure.attempts, lastAttemptAt: attemptAt, lastError: failure.error, lastErrorCode: failure.code, demo: true }
      : { status: "synced", attempts: 1, lastAttemptAt: attemptAt, bitrixId: ++bitrixId, demo: true };

    leads.push({
      id,
      name,
      phone,
      email: `${local}@example.com`,
      serviceId: SERVICES[(i * 3 + 1) % SERVICES.length].id,
      comment: COMMENTS[i % COMMENTS.length],
      status: statusFor(i),
      assigneeId: i < 3 || managerIds.length === 0 ? undefined : managerIds[i % managerIds.length],
      createdAt,
      source: "website",
      demoData: true,
      sync,
    });

    events.push({
      id: `ev-${id}-seed`,
      leadId: id,
      leadName: name,
      at: attemptAt,
      method: "crm.lead.add",
      attempt: sync.attempts,
      ok: !failure,
      bitrixId: sync.bitrixId,
      errorCode: failure?.code,
      message: failure ? failure.error : `Демо: лид создан, ID ${sync.bitrixId}`,
      durationMs: failure ? 1180 : 320 + ((i * 37) % 260),
      demo: true,
    });
  });

  return { leads, events };
}
