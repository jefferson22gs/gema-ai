import type { Metadata } from "next";
import Link from "next/link";
import { ResetRequestForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function RecuperarSenha() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Recuperar senha</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Enviaremos um link de redefinição.</p>
      <ResetRequestForm />
      <Link href="/entrar" className="mt-6 block text-center text-sm text-muted hover:text-fg">Voltar para o login</Link>
    </>
  );
}
