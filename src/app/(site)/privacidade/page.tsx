import type { Metadata } from "next";
import { Alert } from "@/components/ui/primitives";
import { ProsePage } from "@/components/site/prose-page";

export const metadata: Metadata = { title: "Política de Privacidade" };

export default function Privacidade() {
  return (
    <ProsePage eyebrow="LGPD" title="Política de Privacidade" intro="Versão 2026-11 · minuta para revisão jurídica.">
      <Alert tone="warning" title="Documento em revisão">Este texto é uma minuta técnica e deve ser revisado por assessoria jurídica antes do lançamento comercial.</Alert>
      <section>
        <h2>Dados tratados</h2>
        <ul>
          <li>Cadastro: nome, e-mail, telefone (quando verificado), fuso horário e preferências.</li>
          <li>Conteúdo que você registra: compromissos, lançamentos financeiros, tarefas, contatos, documentos e conversas com o assistente.</li>
          <li>Dados técnicos: registros de acesso e auditoria, minimizados e com retenção limitada.</li>
        </ul>
      </section>
      <section>
        <h2>Finalidades e bases legais</h2>
        <ul>
          <li>Execução do contrato: prestar o serviço de organização e assistência.</li>
          <li>Consentimento: WhatsApp, notificações push, memória do assistente e comunicações de marketing — revogáveis a qualquer momento.</li>
          <li>Legítimo interesse e obrigações legais: segurança, prevenção a fraudes e registros exigidos por lei.</li>
        </ul>
      </section>
      <section>
        <h2>Operadores</h2>
        <p>
          Supabase (banco e armazenamento), Vercel (hospedagem), Google (Gemini API e, se você conectar, Agenda/Contatos), Resend e Brevo (e-mail),
          provedor de WhatsApp configurado pelo operador. Conteúdo enviado ao assistente é processado pela Gemini API apenas para atender ao seu pedido.
        </p>
      </section>
      <section>
        <h2>Seus direitos</h2>
        <p>Acesso, correção, portabilidade (exportação), eliminação, revogação de consentimento e informação sobre compartilhamento — em Configurações ou pelo canal do encarregado.</p>
      </section>
      <section>
        <h2>Retenção</h2>
        <p>Histórico de conversas segue a retenção configurada no workspace (padrão 90 dias). Dados são excluídos após o encerramento da conta, salvo obrigação legal.</p>
      </section>
      <section>
        <h2>Encarregado (DPO)</h2>
        <p>Contato disponível na página de contato. Dados do encarregado a serem definidos pelo controlador.</p>
      </section>
    </ProsePage>
  );
}
