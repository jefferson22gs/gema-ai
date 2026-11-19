"use client";

import { Alert, Button } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dbMissing = error.message.includes("DATABASE_URL");
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16">
      <h1 className="text-xl font-semibold">Não foi possível carregar esta tela</h1>
      <Alert tone={dbMissing ? "warning" : "danger"} title={dbMissing ? "Banco de dados: Não configurado" : "Erro inesperado"}>
        {dbMissing
          ? "Defina DATABASE_URL (conexão Postgres do Supabase) no ambiente do servidor e aplique as migrations."
          : `Tente novamente. Se persistir, abra um chamado em Ajuda${error.digest ? ` informando o código ${error.digest}` : ""}.`}
      </Alert>
      <Button variant="secondary" onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
