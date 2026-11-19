import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose-page";

export const metadata: Metadata = { title: "Segurança" };

export default function Seguranca() {
  return (
    <ProsePage eyebrow="Segurança" title="Segurança como premissa, não como recurso" intro="Práticas implementadas no produto. Não afirmamos certificações que ainda não possuímos.">
      <section>
        <h2>Isolamento de dados</h2>
        <ul>
          <li>Row Level Security no PostgreSQL em todas as tabelas expostas, com testes automatizados de vazamento entre contas.</li>
          <li>Workspace pessoal nunca é visível a membros de um workspace de família ou empresa.</li>
          <li>Conversas com o assistente são privadas ao titular mesmo em workspaces compartilhados.</li>
        </ul>
      </section>
      <section>
        <h2>Integrações</h2>
        <ul>
          <li>OAuth com escopos mínimos, proteção anti-CSRF e PKCE; tokens criptografados (AES-256-GCM) e revogáveis.</li>
          <li>Webhooks com verificação de assinatura, proteção contra repetição e registro de tentativas inválidas.</li>
          <li>WhatsApp aceita comandos apenas de números com posse comprovada por código.</li>
        </ul>
      </section>
      <section>
        <h2>Inteligência artificial</h2>
        <ul>
          <li>O modelo propõe ações; o sistema valida parâmetros, permissões e pede confirmação para o que é sensível.</li>
          <li>Conteúdo de terceiros (documentos, mensagens encaminhadas) é tratado como dado, nunca como comando.</li>
          <li>Seus contatos e dados não são usados para treinar modelos nem para marketing.</li>
        </ul>
      </section>
      <section>
        <h2>Operação</h2>
        <ul>
          <li>Administração da plataforma separada dos dados dos clientes; acesso de suporte só com autorização e trilha de auditoria.</li>
          <li>Limites de uso, rate limiting e cabeçalhos de segurança (CSP, HSTS, proteção contra clickjacking).</li>
        </ul>
      </section>
    </ProsePage>
  );
}
