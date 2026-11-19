import type { Metadata } from "next";
import { NewPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Nova senha" };

export default function RedefinirSenha() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Defina uma nova senha</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Use uma senha longa e exclusiva.</p>
      <NewPasswordForm />
    </>
  );
}
