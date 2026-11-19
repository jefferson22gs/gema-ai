import type { Metadata } from "next";
import { Alert } from "@/components/ui/primitives";
import { ProsePage } from "@/components/site/prose-page";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function Termos() {
  return (
    <ProsePage eyebrow="Termos" title="Termos de Uso" intro="Versão 2026-11 · minuta para revisão jurídica.">
      <Alert tone="warning" title="Documento em revisão">Minuta técnica a ser revisada por assessoria jurídica antes do lançamento comercial.</Alert>
      <section>
        <h2>O serviço</h2>
        <p>O GEMA AI é uma ferramenta de organização pessoal e profissional assistida por IA. Não presta consultoria financeira, jurídica ou contábil regulamentada.</p>
      </section>
      <section>
        <h2>Responsabilidades do usuário</h2>
        <ul>
          <li>Revisar ações propostas pelo assistente antes de confirmá-las.</li>
          <li>Usar o WhatsApp conforme os termos da Meta e não enviar mensagens em massa não solicitadas.</li>
          <li>Manter a confidencialidade das credenciais de acesso.</li>
        </ul>
      </section>
      <section>
        <h2>Limitações</h2>
        <ul>
          <li>Respostas de IA podem conter erros; ações sensíveis exigem confirmação.</li>
          <li>Disponibilidade de integrações de terceiros depende desses fornecedores.</li>
          <li>Não garantimos disponibilidade ininterrupta.</li>
        </ul>
      </section>
      <section>
        <h2>Planos e cobrança</h2>
        <p>Limites de uso conforme o plano contratado. Condições de cobrança, cancelamento e reembolso serão publicadas antes da ativação de pagamentos.</p>
      </section>
    </ProsePage>
  );
}
