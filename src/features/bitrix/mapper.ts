import { serviceTitle } from "@/features/leads/services";
import type { IntegrationSettings, Lead } from "@/features/leads/types";
import { dateTimeFull } from "@/lib/format";
import { ORIGINATOR_ID, type BitrixLeadFields } from "./client";

/** `assigneeBitrixUserId` is the responsible person's Bitrix24 user ID; without one the portal-wide default from Settings is used. */
export function toBitrixLead(lead: Lead, settings: IntegrationSettings, assigneeBitrixUserId?: number): BitrixLeadFields {
  // Bitrix24 sets DATE_CREATE itself and does not accept it, so the form's date travels in the comment.
  const note = [
    `Услуга: ${serviceTitle(lead.serviceId)}`,
    lead.comment && `Комментарий: ${lead.comment}`,
    `Дата заявки: ${dateTimeFull(lead.createdAt)} (МСК)`,
    `Заявка LeadFlow: ${lead.id}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    TITLE: `${lead.source === "website" ? "Заявка с сайта" : "Заявка"}: ${serviceTitle(lead.serviceId)}`,
    NAME: lead.name,
    PHONE: [{ VALUE: lead.phone, VALUE_TYPE: "WORK" }],
    EMAIL: lead.email ? [{ VALUE: lead.email, VALUE_TYPE: "WORK" }] : [],
    COMMENTS: note,
    SOURCE_ID: settings.sourceId,
    SOURCE_DESCRIPTION: lead.source === "website" ? "Форма на сайте" : "Создана вручную",
    STATUS_ID: settings.statusMap[lead.status],
    ASSIGNED_BY_ID: assigneeBitrixUserId ?? settings.responsibleId,
    ORIGINATOR_ID,
    ORIGIN_ID: lead.id,
  };
}

/** Rows for the field-mapping table on the integration page. */
export const FIELD_MAP: { from: string; to: keyof BitrixLeadFields; note: string }[] = [
  { from: "Имя", to: "NAME", note: "Имя контакта" },
  { from: "Телефон", to: "PHONE", note: "Нормализуется к +7XXXXXXXXXX" },
  { from: "Email", to: "EMAIL", note: "Рабочий адрес" },
  { from: "Услуга", to: "TITLE", note: "Название лида: «Заявка с сайта: …»" },
  { from: "Услуга, комментарий, дата заявки", to: "COMMENTS", note: "Текст для менеджера: Битрикс24 не принимает дату создания, она идёт текстом" },
  { from: "Источник", to: "SOURCE_ID", note: "Код из настроек" },
  { from: "Тип источника", to: "SOURCE_DESCRIPTION", note: "«Форма на сайте»" },
  { from: "Статус", to: "STATUS_ID", note: "По таблице соответствия из настроек; при смене статуса уходит crm.lead.update" },
  { from: "Ответственный", to: "ASSIGNED_BY_ID", note: "ID пользователя Битрикс24 у сотрудника; иначе значение по умолчанию из настроек" },
  { from: "ID заявки LeadFlow", to: "ORIGIN_ID", note: "Вместе с ORIGINATOR_ID=leadflow защищает от дублей при повторной отправке" },
];
