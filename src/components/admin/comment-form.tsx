"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/shared/toaster";
import { addCommentAction } from "@/features/leads/actions";

export function CommentForm({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      toast.error("Введите текст комментария");
      return;
    }
    start(async () => {
      const r = await addCommentAction(leadId, text);
      toast.result(r);
      if (r.ok) setText("");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="comment" className="sr-only">
        Новый комментарий
      </label>
      <Textarea id="comment" rows={3} value={text} maxLength={2000} disabled={!canEdit || pending} placeholder={canEdit ? "Комментарий для команды: он попадёт в историю и в Битрикс24" : "Комментировать может ответственный сотрудник или администратор"} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" className="h-10" disabled={!canEdit || pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />} Добавить комментарий
      </Button>
    </form>
  );
}
