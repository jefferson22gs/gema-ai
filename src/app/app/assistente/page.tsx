import type { Metadata } from "next";
import { Suspense } from "react";
import { AssistantChat } from "@/components/app/assistant-chat";
import { PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/env";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Assistente" };

async function Chat({ searchParams }: { searchParams: PageProps<"/app/assistente">["searchParams"] }) {
  const sp = await searchParams;
  const s = await requireSession();
  const history = await db.asUser(s.userId, (q) =>
    q.query<{ id: string; role: "user" | "assistant"; content: string }>(
      `select m.id, m.role, m.content from messages m
       join conversations c on c.id = m.conversation_id
       where c.workspace_id = $1 and c.owner_id = $2 and c.channel = 'dashboard' and m.role in ('user', 'assistant')
       order by m.created_at desc limit 20`,
      [s.workspace.id, s.userId],
    ),
  );
  return (
    <AssistantChat
      initialMessages={history.reverse().map((m) => ({ id: m.id, role: m.role, text: m.content }))}
      initialQuery={typeof sp.q === "string" ? sp.q.slice(0, 4000) : undefined}
      assistantName={s.profile.assistant_name}
      aiConfigured={isConfigured("gemini")}
    />
  );
}

export default function AssistentePage(props: PageProps<"/app/assistente">) {
  return (
    <>
      <PageHeader title="Assistente" description="Ações sensíveis sempre pedem confirmação. Cada pedido mostra o status real de execução." />
      <Suspense fallback={<Skeleton className="h-[60vh]" />}><Chat searchParams={props.searchParams} /></Suspense>
    </>
  );
}
