import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import AdminLoading from "@/app/admin/loading";
import { CommentForm } from "@/components/admin/comment-form";
import { LeadControls } from "@/components/admin/lead-controls";
import { SyncPanel } from "@/components/admin/sync-panel";
import { Timeline } from "@/components/admin/timeline";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditLead } from "@/features/auth/permissions";
import { requireUser } from "@/features/auth/session";
import { getLead, getSettings, getStaff, listEventsForLead, listOutbox, listStaff, listTimeline } from "@/features/leads/service";
import { serviceTitle } from "@/features/leads/services";
import { leadStatusMeta } from "@/features/leads/status-meta";
import { dateTimeFull } from "@/lib/format";

export const metadata: Metadata = { title: "Карточка заявки" };

type Params = Promise<{ id: string }>;

export default function LeadPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <LeadContent params={params} />
    </Suspense>
  );
}

async function LeadContent({ params }: { params: Params }) {
  await connection();
  const user = await requireUser();
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) notFound();

  const staff = listStaff();
  const canEdit = canEditLead(user, lead);
  const assignee = lead.assigneeId ? getStaff(lead.assigneeId) : undefined;
  const timeline = listTimeline(id);
  const hasCreatedEntry = timeline.some((e) => e.kind === "created");

  return (
    <>
      <Link href="/admin/leads" className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Все заявки
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
        <StatusBadge tone={leadStatusMeta[lead.status].tone}>{leadStatusMeta[lead.status].label}</StatusBadge>
        {lead.demoData && <StatusBadge tone="neutral">демо-запись</StatusBadge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Данные заявки</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <a href={`tel:${lead.phone}`} className="flex min-h-9 items-center gap-2 hover:text-primary">
                  <Phone className="size-4 text-muted-foreground" /> {lead.phone}
                </a>
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex min-h-9 items-center gap-2 break-all hover:text-primary">
                    <Mail className="size-4 text-muted-foreground" /> {lead.email}
                  </a>
                )}
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Услуга</dt>
                  <dd className="font-medium">{serviceTitle(lead.serviceId)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Источник</dt>
                  <dd className="font-medium">{lead.source === "website" ? "Форма на сайте" : "Создана вручную"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Создана</dt>
                  <dd className="font-medium">{dateTimeFull(lead.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Ответственный</dt>
                  <dd className="font-medium">{assignee ? assignee.name : "не назначен"}</dd>
                </div>
              </dl>
              <div>
                <p className="text-xs text-muted-foreground">Комментарий клиента</p>
                <p className="mt-0.5 break-words whitespace-pre-wrap">{lead.comment || "Без комментария"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Комментарии и история</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <CommentForm leadId={lead.id} canEdit={canEdit} />
              <Timeline entries={timeline} origin={hasCreatedEntry ? undefined : { at: lead.createdAt, text: lead.source === "website" ? "Заявка поступила с сайта" : "Заявка создана" }} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Управление</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadControls leadId={lead.id} status={lead.status} assigneeId={lead.assigneeId} staff={staff.map((s) => ({ id: s.id, name: s.name, active: s.active }))} canEdit={canEdit} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Битрикс24</CardTitle>
            </CardHeader>
            <CardContent>
              <SyncPanel lead={lead} events={listEventsForLead(id)} outbox={listOutbox(id)} canEdit={canEdit} mode={getSettings().mode} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
