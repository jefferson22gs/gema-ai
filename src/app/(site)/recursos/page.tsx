import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose-page";

export const metadata: Metadata = { title: "Recursos", description: "Agenda, finanças, tarefas, contatos, documentos, briefings e automações." };

export default function Recursos() {
  return (
    <ProsePage eyebrow="Recursos" title="Tudo o que um assessor executivo organiza" intro="Cada recurso funciona no painel e, quando o canal está configurado e seu número verificado, também pelo WhatsApp.">
      <section>
        <h2>Agenda executiva</h2>
        <ul>
          <li>Visões de dia, semana e mês com fuso horário do usuário (padrão America/Sao_Paulo).</li>
          <li>Detecção de conflitos: nada é criado “por cima” de outro compromisso sem sua confirmação.</li>
          <li>Integração opcional com Google Agenda via OAuth, com identificador externo e deduplicação.</li>
        </ul>
      </section>
      <section>
        <h2>Finanças pessoais</h2>
        <ul>
          <li>Receitas e despesas em centavos exatos, categorias, status pago/pendente e vencimentos.</li>
          <li>Orçamento mensal por categoria, comparação com o mês anterior e exportação CSV.</li>
          <li>Ferramenta de organização — não é consultoria financeira regulamentada. Open Finance apenas futuramente, com parceiro autorizado.</li>
        </ul>
      </section>
      <section>
        <h2>Tarefas, projetos e lembretes</h2>
        <ul>
          <li>Prioridades, prazos, projetos e lembretes recorrentes que mantêm o horário local mesmo com horário de verão.</li>
          <li>Automações prontas: briefing diário, conta a vencer, resumo semanal, tarefa atrasada e compromisso chegando.</li>
        </ul>
      </section>
      <section>
        <h2>Contatos e documentos</h2>
        <ul>
          <li>Contatos com telefone validado (E.164) e deduplicação; gravação no Google Contatos só após confirmação.</li>
          <li>Documentos em armazenamento privado, com links temporários e extração revisada antes de virar lançamento.</li>
        </ul>
      </section>
      <section>
        <h2>Briefing Executivo 360°</h2>
        <p>Um resumo do seu dia que separa fatos registrados de sugestões, mostra a origem de cada dado e indica quando não há informação — sem inventar números.</p>
      </section>
    </ProsePage>
  );
}
