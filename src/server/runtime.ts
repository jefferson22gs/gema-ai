import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getDefaultModel } from "./ai/model";
import { GoogleApiGateway } from "./integrations/google/gateway";
import type { GoogleOAuthConfig } from "./integrations/google/oauth";
import { EvolutionProvider } from "./messaging/evolution";
import { MetaCloudProvider } from "./messaging/meta";
import type { MessagingProvider } from "./messaging/types";

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
  const apiKey = env.evolutionApiKey();
  const instance = env.evolutionInstance();
  const webhookSecret = env.evolutionWebhookSecret();
  if (!baseUrl || !apiKey || !instance || !webhookSecret) return null;
  return new EvolutionProvider({ baseUrl, apiKey, instance, webhookSecret, interactiveEnabled: process.env.EVOLUTION_INTERACTIVE === "true" });
}

export function metaProvider(): MetaCloudProvider | null {
  const phoneNumberId = env.metaPhoneNumberId();
  const accessToken = env.metaAccessToken();
  const appSecret = env.metaAppSecret();
  if (!phoneNumberId || !accessToken || !appSecret) return null;
  return new MetaCloudProvider({ phoneNumberId, accessToken, appSecret });
}

/** Canal WhatsApp preferencial para saída: Meta Cloud API (oficial) se configurada, senão Evolution. */
export function primaryWhatsApp(): MessagingProvider | null {
  return metaProvider() ?? evolutionProvider();
}

export function aiModel() {
  return getDefaultModel();
}
