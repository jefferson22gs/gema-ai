import { z } from "zod";
import { db } from "@/lib/db";
import { cancelExecution, confirmExecution } from "@/server/ai/executor";
import { MAX_TEXT_CHARS, handleUserMessage } from "@/server/ai/orchestrator";
import { clientIp, errorResponse, json, rateLimit, sameOrigin } from "@/server/http";
import { aiModel, googleGateway } from "@/server/runtime";
import { actorContext, getSession } from "@/server/session";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("message"),
    clientMessageId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    text: z.string().max(MAX_TEXT_CHARS).optional(),
    media: z.object({ mimeType: z.string().max(100), base64: z.string().max(12_000_000) }).optional(),
  }),
  z.object({ action: z.literal("confirm"), executionId: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), executionId: z.string().uuid() }),
]);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida." }, 403);
  const session = await getSession();
  if (!session) return json({ error: "Não autenticado." }, 401);
  if (!(await rateLimit(`chat:user:${session.userId}`, 30)) || !(await rateLimit(`chat:ip:${clientIp(req)}`, 60))) {
    return json({ error: "Muitas mensagens em pouco tempo. Aguarde um instante." }, 429);
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requisição inválida." }, 400);

  const ctx = actorContext(session);
  const google = googleGateway();
  try {
    const input = parsed.data;
    if (input.action === "confirm") return json({ outcome: await confirmExecution({ db, ctx, google }, input.executionId) });
    if (input.action === "cancel") return json({ cancelled: await cancelExecution({ db, ctx, google }, input.executionId) });
    if (!input.text?.trim() && !input.media) return json({ error: "Mensagem vazia." }, 400);
    const result = await handleUserMessage(
      { db, ctx, model: aiModel(), google, assistantName: session.profile.assistant_name },
      { text: input.text, media: input.media, provider: "dashboard", providerMessageId: `${session.userId}:${input.clientMessageId}`, conversationId: input.conversationId },
    );
    return json(result);
  } catch (e) {
    if (e instanceof Error && /mídia|grande|vazia|suportado/.test(e.message)) return json({ error: e.message }, 422);
    return errorResponse(e);
  }
}
