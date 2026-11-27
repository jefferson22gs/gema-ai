import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getDefaultModel } from "./ai/model";
import { GoogleApiGateway } from "./integrations/google/gateway";
import type { GoogleOAuthConfig } from "./integrations/google/oauth";
import { EvolutionProvider } from "./messaging/evolution";
import { MetaCloudProvider } from "./messaging/meta";
import type { MessagingProvider } from "./messaging/types";
import { WhaileysProvider } from "./messaging/whaileys";
import { PluggyProvider } from "./open-finance/pluggy";

/** Composição das dependências reais de produção (cada uma null quando não configurada). */
export function googleConfig(): GoogleOAuthConfig | null {
  const clientId = env.googleClientId();
  const clientSecret = env.googleClientSecret();
  const redirectUri = env.googleRedirectUri();
  const encryptionKey = env.oauthEncryptionKey();
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) return null;
  return { clientId, clientSecret, redirectUri, encryptionKey };
}

export function googleGateway() {
  const cfg = googleConfig();
  return cfg ? new GoogleApiGateway(db, cfg) : null;
}

export function evolutionProvider(): EvolutionProvider | null {
  const baseUrl = env.evolutionApiUrl();
  const instanceToken = env.evolutionInstanceToken();
  const instance = env.evolutionInstance();
  const webhookSecret = env.evolutionWebhookSecret();
  if (!baseUrl || !instanceToken || !instance || !webhookSecret) return null;
  return new EvolutionProvider({ baseUrl, instanceToken, instance, webhookSecret, interactiveEnabled: process.env.EVOLUTION_INTERACTIVE === "true" });
}

export function metaProvider(): MetaCloudProvider | null {
  const phoneNumberId = env.metaPhoneNumberId();
  const accessToken = env.metaAccessToken();
  const appSecret = env.metaAppSecret();
  if (!phoneNumberId || !accessToken || !appSecret) return null;
  return new MetaCloudProvider({ phoneNumberId, accessToken, appSecret });
}

export function bankProvider(): PluggyProvider | null {
  const clientId = env.pluggyClientId();
  const clientSecret = env.pluggyClientSecret();
  if (!clientId || !clientSecret) return null;
  return new PluggyProvider({ clientId, clientSecret, webhookSecret: env.pluggyWebhookSecret() ?? null });
}

export function whaileysProvider(): WhaileysProvider | null {
  const apiUrl = env.whaileysApiUrl();
  const instance = env.whaileysInstance();
  const token = env.whaileysToken();
  const webhookSecret = env.whaileysWebhookSecret();
  if (!apiUrl || !instance || !token || !webhookSecret) return null;
  return new WhaileysProvider({ apiUrl, instance, token, webhookSecret });
}

/**
 * Canal WhatsApp para saída. Ordem: Meta Cloud API (oficial) > Whaileys > Evolution.
 * Cada número verificado fica vinculado ao provedor que enviou o código (channel_accounts.provider).
 */
export function primaryWhatsApp(): MessagingProvider | null {
  return metaProvider() ?? whaileysProvider() ?? evolutionProvider();
}

export function aiModel() {
  return getDefaultModel();
}
