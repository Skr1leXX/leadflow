import type { Lead } from "@/features/leads/types";

export interface Client {
  id: string;
  name: string;
  /** Empty for a client known only by phone. */
  email: string;
  phone: string;
  leadsCount: number;
  lastLeadAt: string;
  lastServiceId: string;
  /** Bitrix24 lead IDs of this client's synced leads. */
  bitrixIds: number[];
}

/**
 * Clients are people, so leads are grouped by email (case-insensitive). A lead without an email (a phone call) is grouped by
 * phone instead, so such leads never collapse into one nameless client. The newest lead supplies the contact details.
 */
export function clientsFromLeads(leads: Lead[]): Client[] {
  const byEmail = new Map<string, Lead[]>();
  for (const l of leads) {
    const key = l.email ? l.email.toLowerCase() : `phone:${l.phone}`;
    byEmail.set(key, [...(byEmail.get(key) ?? []), l]);
  }
  return [...byEmail.entries()]
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = sorted[0];
      return {
        id: key,
        name: latest.name,
        email: latest.email.toLowerCase(),
        phone: latest.phone,
        leadsCount: group.length,
        lastLeadAt: latest.createdAt,
        lastServiceId: latest.serviceId,
        bitrixIds: group.flatMap((l) => (l.sync.bitrixId ? [l.sync.bitrixId] : [])),
      };
    })
    .sort((a, b) => b.lastLeadAt.localeCompare(a.lastLeadAt));
}
