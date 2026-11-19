import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose-page";

export const metadata: Metadata = { title: "Contato" };

export default function Contato() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  const dpo = process.env.NEXT_PUBLIC_DPO_EMAIL;
  return (
    <ProsePage eyebrow="Contato" title="Fale com a equipe GEMA AI">
      <section>
        <h2>Suporte e comercial</h2>
        <p>{email ? <a className="text-gold underline" href={`mailto:${email}`}>{email}</a> : "Canal de contato a ser publicado pelo operador (NEXT_PUBLIC_CONTACT_EMAIL)."}</p>
        <p className="mt-2">Clientes autenticados podem abrir chamados em Ajuda, dentro do painel.</p>
      </section>
      <section>
        <h2>Encarregado de dados (LGPD)</h2>
        <p>{dpo ? <a className="text-gold underline" href={`mailto:${dpo}`}>{dpo}</a> : "Contato do encarregado a ser publicado pelo controlador (NEXT_PUBLIC_DPO_EMAIL)."}</p>
      </section>
    </ProsePage>
  );
}
