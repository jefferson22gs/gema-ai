import "server-only";

/**
 * Leitura centralizada de variáveis de ambiente do servidor.
 * Nenhuma variável é obrigatória para o build: integrações sem chave ficam "Não configurado".
 */
function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  appUrl: () => read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  supabaseUrl: () => read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => read("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: () => read("GEMINI_API_KEY"),
  geminiModel: () => read("GEMINI_MODEL") ?? "gemini-2.5-flash",
  geminiMaxMonthlyUsd: () => Number(read("GEMINI_MAX_MONTHLY_USD") ?? "50"),
  resendApiKey: () => read("RESEND_API_KEY"),
  resendWebhookSecret: () => read("RESEND_WEBHOOK_SECRET"),
  brevoApiKey: () => read("BREVO_API_KEY"),
  brevoWebhookSecret: () => read("BREVO_WEBHOOK_SECRET"),
  emailFrom: () => read("EMAIL_FROM"),
  emailPrimaryProvider: (): "resend" | "brevo" => (read("EMAIL_PRIMARY_PROVIDER") === "brevo" ? "brevo" : "resend"),
  evolutionApiUrl: () => read("EVOLUTION_API_URL"),
  evolutionApiKey: () => read("EVOLUTION_API_KEY"),
  evolutionInstance: () => read("EVOLUTION_INSTANCE"),
  evolutionWebhookSecret: () => read("EVOLUTION_WEBHOOK_SECRET"),
  metaPhoneNumberId: () => read("META_WABA_PHONE_NUMBER_ID"),
  metaAccessToken: () => read("META_WHATSAPP_ACCESS_TOKEN"),
  metaAppSecret: () => read("META_APP_SECRET"),
  metaVerifyToken: () => read("META_WEBHOOK_VERIFY_TOKEN"),
  whaileysApiUrl: () => read("WHAILEYS_API_URL"),
  whaileysInstance: () => read("WHAILEYS_INSTANCE"),
  whaileysToken: () => read("WHAILEYS_TOKEN"),
  whaileysWebhookSecret: () => read("WHAILEYS_WEBHOOK_SECRET"),
  googleClientId: () => read("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => read("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: () => read("GOOGLE_OAUTH_REDIRECT_URI"),
  oauthEncryptionKey: () => read("OAUTH_ENCRYPTION_KEY"),
  cronSecret: () => read("CRON_SECRET"),
  billingProvider: () => read("BILLING_PROVIDER"),
  billingWebhookSecret: () => read("BILLING_WEBHOOK_SECRET"),
  vapidPublicKey: () => read("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
  vapidPrivateKey: () => read("VAPID_PRIVATE_KEY"),
  sentryDsn: () => read("SENTRY_DSN"),
};

export type IntegrationKey =
  | "supabase"
  | "gemini"
  | "resend"
  | "brevo"
  | "evolution"
  | "meta_cloud"
  | "baileys_whaileys"
  | "google"
  | "billing"
  | "push"
  | "agendafacil365";

export interface IntegrationConfigStatus {
  key: IntegrationKey;
  label: string;
  configured: boolean;
  missing: string[];
  note?: string;
}

function status(key: IntegrationKey, label: string, vars: Record<string, string | undefined>, note?: string): IntegrationConfigStatus {
  const missing = Object.entries(vars)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return { key, label, configured: missing.length === 0, missing, note };
}

/** Estado de configuração (por variáveis de ambiente) de cada integração da plataforma. */
export function integrationConfig(): IntegrationConfigStatus[] {
  return [
    status("supabase", "Supabase", {
      NEXT_PUBLIC_SUPABASE_URL: env.supabaseUrl(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.supabaseAnonKey(),
      SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceRoleKey(),
    }),
    status("gemini", "Gemini API", { GEMINI_API_KEY: env.geminiApiKey() }),
    status("resend", "Resend", { RESEND_API_KEY: env.resendApiKey(), EMAIL_FROM: env.emailFrom() }),
    status("brevo", "Brevo", { BREVO_API_KEY: env.brevoApiKey(), EMAIL_FROM: env.emailFrom() }),
    status("evolution", "WhatsApp — Evolution API", {
      EVOLUTION_API_URL: env.evolutionApiUrl(),
      EVOLUTION_API_KEY: env.evolutionApiKey(),
      EVOLUTION_INSTANCE: env.evolutionInstance(),
      EVOLUTION_WEBHOOK_SECRET: env.evolutionWebhookSecret(),
    }, "Requer host persistente externo (Docker). Não roda na Vercel."),
    status("meta_cloud", "WhatsApp — Cloud API (Meta)", {
      META_WABA_PHONE_NUMBER_ID: env.metaPhoneNumberId(),
      META_WHATSAPP_ACCESS_TOKEN: env.metaAccessToken(),
      META_APP_SECRET: env.metaAppSecret(),
      META_WEBHOOK_VERIFY_TOKEN: env.metaVerifyToken(),
    }),
    status("baileys_whaileys", "WhatsApp — Whaileys (botões e listas)", {
      WHAILEYS_API_URL: env.whaileysApiUrl(),
      WHAILEYS_INSTANCE: env.whaileysInstance(),
      WHAILEYS_TOKEN: env.whaileysToken(),
      WHAILEYS_WEBHOOK_SECRET: env.whaileysWebhookSecret(),
    }, "Motor próprio em host persistente. Conector não oficial do WhatsApp."),
    status("google", "Google Calendar e Contatos", {
      GOOGLE_CLIENT_ID: env.googleClientId(),
      GOOGLE_CLIENT_SECRET: env.googleClientSecret(),
      GOOGLE_OAUTH_REDIRECT_URI: env.googleRedirectUri(),
      OAUTH_ENCRYPTION_KEY: env.oauthEncryptionKey(),
    }),
    status("billing", "Cobrança (BillingProvider)", {
      BILLING_PROVIDER: env.billingProvider(),
      BILLING_WEBHOOK_SECRET: env.billingWebhookSecret(),
    }, "Nenhum provedor de pagamento escolhido ainda."),
    status("push", "Push PWA (VAPID)", {
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: env.vapidPublicKey(),
      VAPID_PRIVATE_KEY: env.vapidPrivateKey(),
    }),
    {
      key: "agendafacil365",
      label: "AgendaFácil365",
      configured: false,
      missing: [],
      note: "Aguardando API oficial do AgendaFácil365. Ver docs/AGENDA_FACIL_CONNECTOR.md.",
    },
  ];
}

export function isConfigured(key: IntegrationKey): boolean {
  return integrationConfig().find((i) => i.key === key)?.configured ?? false;
}
