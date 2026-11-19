import type { Metadata } from "next";
import { GemaMark } from "@/components/brand";

export const metadata: Metadata = { title: "Sem conexão", robots: { index: false } };

export default function Offline() {
  return (
    <main id="conteudo" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <GemaMark className="size-12 text-gold" />
      <h1 className="text-xl font-semibold">Você está sem conexão</h1>
      <p className="text-sm text-muted">Por segurança, seus dados não ficam salvos no dispositivo. Reconecte-se para continuar.</p>
    </main>
  );
}
