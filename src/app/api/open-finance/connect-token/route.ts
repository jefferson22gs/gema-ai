import { env } from "@/lib/env";
import { errorResponse, json, rateLimit, sameOrigin } from "@/server/http";
import { bankProvider } from "@/server/runtime";
import { getSession } from "@/server/session";

/**
 * Token curto (30 min) para abrir o widget oficial da Pluggy no navegador. O GEMA nunca recebe a senha bancária.
 * `clientUserId` = id do usuário: usado para associar o item ao titular no retorno.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida." }, 403);
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const provider = bankProvider();
  if (!provider) return json({ error: "Open Finance não configurado (Pluggy)." }, 503);
  if (!(await rateLimit(`of:token:${s.userId}`, 10, 600))) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  const body = (await req.json().catch(() => ({}))) as { itemId?: unknown };
  try {
    const appUrl = env.appUrl();
    const webhookUrl = appUrl.startsWith("https://") ? `${appUrl}/api/webhooks/pluggy` : undefined; // Pluggy só aceita HTTPS público
    const r = await provider.createConnectToken({
      clientUserId: s.userId,
      itemId: typeof body.itemId === "string" ? body.itemId : undefined,
      webhookUrl,
    });
    return json({ token: r.token, includeSandbox: env.pluggyIncludeSandbox() });
  } catch (e) {
    return errorResponse(e);
  }
}
