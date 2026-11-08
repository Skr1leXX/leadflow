/** Human names for the Bitrix24 REST methods that appear in the sync journal. */
export const eventTypeLabel: Record<string, string> = {
  "crm.lead.add": "Создание лида",
  "crm.lead.update": "Обновление лида",
  "crm.timeline.comment.add": "Комментарий в ленте",
};

export const eventTypeName = (method: string) => eventTypeLabel[method] ?? method;
