import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Criar conta" };

export default function CadastroPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Crie sua conta</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Período de teste sem cartão.</p>
      <SignUpForm
        configured={Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)}
        googleEnabled={process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true"}
      />
    </>
  );
}
