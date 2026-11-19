import "server-only";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { BrevoProvider, ResendProvider, type EmailProvider } from "./providers";
import { sendEmail, type SendEmailRequest } from "./service";

export function configuredEmailProviders(): EmailProvider[] {
  const resend: EmailProvider | null = env.resendApiKey() ? new ResendProvider(env.resendApiKey()!) : null;
  const brevo: EmailProvider | null = env.brevoApiKey() ? new BrevoProvider(env.brevoApiKey()!) : null;
  const ordered = env.emailPrimaryProvider() === "brevo" ? [brevo, resend] : [resend, brevo];
  return ordered.filter((p): p is EmailProvider => p !== null);
}

export function sendTransactionalEmail(req: SendEmailRequest) {
  return sendEmail({ db, providers: configuredEmailProviders(), from: env.emailFrom() ?? null, appUrl: env.appUrl() }, req);
}
