# Análise competitiva — Meu Assessor (meuassessor.com)

**Data da coleta:** 26/11/2026
**Objeto:** material público de https://meuassessor.com/, da central de ajuda pública e das fichas nas lojas de aplicativos.
**Uso:** benchmark para o GEMA AI. O cruzamento com o nosso produto está em [`FEATURE_MATRIX.md`](./FEATURE_MATRIX.md).

---

## 1. Metodologia

1. Só páginas públicas, buscadas com HTTP GET anônimo (`curl` com User-Agent de navegador). Não houve login, cadastro, checkout nem acesso a `app.meuassessor.com`.
2. O HTML foi convertido em texto, sem scripts nem estilos, e lido por inteiro. Os links de navegação da home serviram para descobrir as demais páginas.
3. Central de ajuda (`ajuda.meuassessor.com`): lemos a página inicial, as coleções "Outros", "Notas fiscais", "Links de cobrança" e "Integrações" (só a lista de títulos) e os artigos citados abaixo.
4. Lojas: ficha do Google Play (link do rodapé do site) e App Store, consultada pela API pública de busca da Apple (`itunes.apple.com/search`). O app aparece com o mesmo nome e um ID linkado no site.
5. Cada recurso só entrou com **URL exata e trecho curto literal** (até cerca de 20 palavras). Recurso sem trecho público seria marcado "sem evidência pública encontrada".
6. Não copiamos textos comerciais longos. As observações de posicionamento são nossas.

## 2. URLs visitadas

| # | URL | Conteúdo |
|---|---|---|
| 1 | https://meuassessor.com/ | Home: módulos, demonstração, preços, FAQ |
| 2 | https://meuassessor.com/financas | Módulo Financeiro (Martin) |
| 3 | https://meuassessor.com/agenda | Módulo Agenda (Sofi) |
| 4 | https://meuassessor.com/tarefas | Tarefas, documentos e Drive (Luna) |
| 5 | https://meuassessor.com/notas-fiscais | Fiscal (Rita) |
| 6 | https://meuassessor.com/pesquisas | Pesquisa (Ítalo) |
| 7 | https://meuassessor.com/operacao | Operação e conta compartilhada (Theo) |
| 8 | https://meuassessor.com/como-usar | Catálogo de pedidos de exemplo por assessor |
| 9 | https://meuassessor.com/assessores | Apresentação dos seis assessores |
| 10 | https://meuassessor.com/seguranca | Segurança, Open Finance, Meta |
| 11 | https://meuassessor.com/sobre | História da empresa |
| 12 | https://meuassessor.com/suporte | Suporte humano |
| 13 | https://meuassessor.com/demonstracao | Demonstração interativa (só o HTML estático) |
| 14 | https://meuassessor.com/pages/termos-de-uso | Termos de uso (cláusula de Uso Justo) |
| 15 | https://ajuda.meuassessor.com/pt-BR/ | Central de ajuda (lista de coleções e artigos em destaque) |
| 16 | https://ajuda.meuassessor.com/pt-BR/collections/19703539-outros | Coleção "Outros" (títulos) |
| 17 | https://ajuda.meuassessor.com/pt-BR/collections/19734093-notas-fiscais | Coleção "Notas fiscais" (títulos) |
| 18 | https://ajuda.meuassessor.com/pt-BR/collections/19734094-links-de-cobranca | Coleção "Links de cobrança" (títulos) |
| 19 | https://ajuda.meuassessor.com/pt-BR/collections/19797918-integracoes | Coleção "Integrações" (títulos) |
| 20 | https://ajuda.meuassessor.com/pt-BR/articles/16141030-como-conectar-seu-banco-via-open-finance | Open Finance |
| 21 | https://ajuda.meuassessor.com/pt-BR/articles/16141059-como-funcionam-as-categorias-financeiras | Categorias e orçamento |
| 22 | https://ajuda.meuassessor.com/pt-BR/articles/16140978-como-funciona-e-como-integrar-o-google-agenda | Google Agenda |
| 23 | https://ajuda.meuassessor.com/pt-BR/articles/16141010-como-navegar-pelo-painel-do-meu-assessor | Painel ("Palco" e "Mesas") |
| 24 | https://ajuda.meuassessor.com/pt-BR/articles/16141104-como-usar-os-relatorios-da-organizacao | Relatórios de tarefas em PDF e Excel |
| 25 | https://ajuda.meuassessor.com/pt-BR/articles/16733392-conheca-o-modulo-de-notas-fiscais | Módulo NFS-e |
| 26 | https://ajuda.meuassessor.com/pt-BR/articles/16748296-notas-fiscais-pelo-whatsapp-conheca-a-rita | NFS-e pelo WhatsApp |
| 27 | https://ajuda.meuassessor.com/pt-BR/articles/16733399-o-que-sao-os-links-de-cobranca | Links de cobrança |
| 28 | https://ajuda.meuassessor.com/pt-BR/articles/17827887-conecte-sua-ia-ao-meu-assessor-o-que-e-e-como-funciona-assistentes-de-inteligencia-artificial | Conector MCP ("Conecte sua IA") |
| 29 | https://play.google.com/store/apps/details?id=com.meuassessor.pro.app&hl=pt_BR | Ficha do Google Play |
| 30 | https://itunes.apple.com/search?term=meu+assessor&country=br&entity=software | API pública da App Store; ficha: https://apps.apple.com/br/app/meu-assessor-assessores-de-ia/id6812844868 |

## 3. Recursos por área, com evidência

Legenda das URLs: **H** = https://meuassessor.com/ · **FIN** = /financas · **AG** = /agenda · **TAR** = /tarefas · **NF** = /notas-fiscais · **PESQ** = /pesquisas · **OP** = /operacao · **CU** = /como-usar · **SEG** = /seguranca. Todas no domínio `https://meuassessor.com`. Os artigos da ajuda e as lojas aparecem com URL completa.

### 3.1 Financeiro

| # | Recurso | URL | Trecho (literal) |
|---|---|---|---|
| F1 | Open Finance (somente leitura) | https://meuassessor.com/seguranca | "O que chega ao Meu Assessor é uma cópia de leitura: saldo, extrato e faturas de cartão." |
| F2 | Contas bancárias (+200 bancos, contas manuais) | https://meuassessor.com/ | "+200 bancos · Suas contas · Open Finance" |
| F2b | Conta manual quando o banco não conecta | https://ajuda.meuassessor.com/pt-BR/articles/16141030-como-conectar-seu-banco-via-open-finance | "o Martin oferece criar uma conta manual na hora" |
| F3 | Saldos consolidados | https://meuassessor.com/ | "Conecte seus bancos e deixe o Martin reunir saldos, extratos e faturas." |
| F4 | Extratos | https://meuassessor.com/como-usar | "o que caiu no extrato hoje?" |
| F5 | Cartões (limite usado e disponível) | https://meuassessor.com/financas | "Contas, cartões, faturas e parcelas, na mesma visão." |
| F6 | Faturas | https://meuassessor.com/financas | "Consulte o valor da fatura, a data de vencimento e as compras parceladas." |
| F7 | Parcelamentos | https://meuassessor.com/financas | "Você pode registrar uma compra parcelada e acompanhar as parcelas previstas." |
| F8 | Categorias (criar, renomear, cor, excluir com confirmação) | https://ajuda.meuassessor.com/pt-BR/articles/16141059-como-funcionam-as-categorias-financeiras | "Pelo WhatsApp você pode criar, renomear, listar e excluir categorias conversando com o Martin" |
| F9 | Limites (orçamento) por categoria | https://meuassessor.com/financas | "Orçamento por categoria, com valor definido por você." |
| F10 | Gráficos personalizados salvos no painel e no app | https://meuassessor.com/financas | "Você pode criar gráficos personalizados, salvá-los no painel e no app" |
| F11 | Fluxo de caixa | https://meuassessor.com/ | "Fluxo deste mês / Entradas e saídas previstas para o período." |
| F12 | Projeção financeira (saldo diário projetado) | https://meuassessor.com/ | "Saldo de outubro, com projeção para os próximos dias." |
| F13 | Relatório em PDF | https://meuassessor.com/financas | "PDF para ler. Planilha para continuar o trabalho." |
| F14 | Exportação para Excel | https://meuassessor.com/como-usar | "manda um excel dos gastos por categoria" |
| F15 | Lançamento por texto, áudio e foto | https://meuassessor.com/financas | "Mande o almoço por mensagem, o abastecimento por áudio ou a foto da nota." |
| F16 | Entrada por PDF e planilha | https://meuassessor.com/ | "Mande do seu jeito: Texto / Áudio / Foto / PDF / Planilha" |
| F17 | Contas recorrentes e vencimentos | https://meuassessor.com/financas | "Contas recorrentes e vencimentos organizados." |
| F18 | Valores a receber até a baixa | https://meuassessor.com/financas | "Valores a receber acompanhados até a baixa." |
| F19 | Transferência entre contas | https://meuassessor.com/como-usar | "transferi 500 da Nubank pra Caixa" |
| F20 | Aviso de lançamentos novos vindos do banco | https://ajuda.meuassessor.com/pt-BR/articles/16141030-como-conectar-seu-banco-via-open-finance | "você recebe um resumo automático no WhatsApp com quantidade e as primeiras transações" |
| F21 | Aviso antes do vencimento da fatura | https://play.google.com/store/apps/details?id=com.meuassessor.pro.app&hl=pt_BR | "Cada compra cai na fatura certa, e o Martin avisa antes de vencer" |
| F22 | Conta PJ por CNPJ | https://meuassessor.com/como-usar | "Conecta o banco da empresa no CNPJ também." |
| F23 | Links de cobrança (Pix, cartão até 12x, boleto) | https://ajuda.meuassessor.com/pt-BR/articles/16733399-o-que-sao-os-links-de-cobranca | "escolhe como pagar — Pix, cartão de crédito ou boleto" |

### 3.2 Agenda

| # | Recurso | URL | Trecho (literal) |
|---|---|---|---|
| A1 | Google Agenda com sincronização nos dois sentidos | https://meuassessor.com/agenda | "Google Agenda, em duas vias. Marcou aqui. Apareceu lá. E o contrário também." |
| A1b | Sincronização por push do Google | https://ajuda.meuassessor.com/pt-BR/articles/16140978-como-funciona-e-como-integrar-o-google-agenda | "o que muda no Google aparece aqui sozinho (o Google avisa o Meu Assessor na hora)" |
| A2 | Transcrição de reuniões do Meet | https://meuassessor.com/ | "Google Agenda / Transcrição do Meet / Agenda pública / Recados a contatos" |
| A2b | Assistente entra na reunião, gera ata e tarefas | https://meuassessor.com/como-usar | "Sofi, entra nessa reunião: meet.google.com/abc-defg-hij" |
| A2c | Ata e tarefas por responsável | https://meuassessor.com/agenda | "Transcrição para retomar o que foi dito. Ata para encontrar as decisões." |
| A3 | Agenda pública (link de agendamento) | https://meuassessor.com/agenda | "Compartilhe sua agenda pública. A pessoa escolhe entre os horários livres e marca com você" |
| A4 | Recados a contatos por WhatsApp | https://meuassessor.com/agenda | "Diga para quem é o recado e o que precisa chegar. A Sofi cuida da mensagem pelo WhatsApp" |
| A5 | Reunião com link do Meet e convites | https://meuassessor.com/agenda | "Peça uma reunião, diga quem participa e deixe o link do Meet junto do compromisso." |
| A6 | Remarcar e avisar participantes | https://meuassessor.com/agenda | "Se o plano mudar, peça para remarcar e avisar os participantes." |
| A7 | Resumo diário em horário configurável | https://meuassessor.com/agenda | "Receba um resumo no horário que combina com sua rotina." |
| A8 | Lembretes recorrentes | https://meuassessor.com/agenda | "Uma vez, toda semana ou todo mês. Você combina a repetição." |
| A9 | PDF dos compromissos da semana | https://meuassessor.com/como-usar | "pdf dos meus compromissos da semana" |

### 3.3 Tarefas e documentos

| # | Recurso | URL | Trecho (literal) |
|---|---|---|---|
| T1 | Tarefas com prazo e prioridade | https://meuassessor.com/ | "A Luna organiza tarefas, prazos e prioridades." |
| T2 | Projetos com checklist | https://meuassessor.com/tarefas | "A pendência ganha prazo. O projeto ganha caminho." |
| T3 | Listas de compras compartilhadas | https://meuassessor.com/tarefas | "A lista do mercado, as tarefas da casa e os projetos com os sócios." |
| T4 | Drive inteligente incluído no plano | https://meuassessor.com/tarefas | "Documentos, fotos, PDFs e planilhas ficam no Meu Drive, incluído no seu plano." |
| T5 | Busca de arquivo pelo assunto | https://meuassessor.com/tarefas | "Você lembra do assunto. A Luna acha o arquivo." |
| T6 | Documentos com lembrete de renovação | https://meuassessor.com/tarefas | "Guarde o documento e combine quando quer ser avisado." |
| T7 | Link público de pasta (revogável) | https://meuassessor.com/tarefas | "peça o link de visualização da pasta. Você também pode desativar esse link" |
| T8 | Relatórios de tarefas em PDF e Excel (5 modelos) | https://ajuda.meuassessor.com/pt-BR/articles/16141104-como-usar-os-relatorios-da-organizacao | "reúne 5 modelos de organização (...) gerados em PDF ou Excel" |
| T9 | Notas (anotações) | https://ajuda.meuassessor.com/pt-BR/collections/19703539-outros | Título de artigo: "Como usar as notas" |

### 3.4 Fiscal

| # | Recurso | URL | Trecho (literal) |
|---|---|---|---|
| N1 | Emissão de NFS-e | https://ajuda.meuassessor.com/pt-BR/articles/16733392-conheca-o-modulo-de-notas-fiscais | "O meuassessor emite notas fiscais de serviço eletrônicas (NFS-e) direto do painel." |
| N2 | Cadastro e perfil fiscal a partir do cartão CNPJ | https://meuassessor.com/notas-fiscais | "Envie os dados da empresa, o cartão CNPJ ou o contrato social." |
| N3 | PDF e XML da nota | https://meuassessor.com/notas-fiscais | "a nota fica disponível em PDF e XML para consultar e compartilhar." |
| N4 | Envio da nota ao cliente | https://meuassessor.com/ | "Nota 44 autorizada. O PDF está pronto e já foi para o e-mail do Marcos." |
| N4b | Envio de nota a terceiro pelo WhatsApp | https://meuassessor.com/operacao | "Manda a nota de R$ 1.280 do Rafael para a Ana do financeiro." |
| N5 | Acompanhamento de rejeição | https://meuassessor.com/notas-fiscais | "Se houver uma rejeição, explica o motivo e o que precisa ser corrigido." |
| N6 | Cancelamento de nota | https://meuassessor.com/como-usar | "cancela a nota 42, o serviço não aconteceu" |
| N7 | Resumo fiscal e apuração levados ao fluxo de caixa | https://meuassessor.com/notas-fiscais | "O que foi apurado também segue para o Martin considerar no fluxo de caixa." |
| N8 | Nota de homologação (teste) | https://ajuda.meuassessor.com/pt-BR/collections/19734093-notas-fiscais | Título de artigo: "Homologação: a nota de teste que libera tudo" |

> **Inconsistência pública:** o artigo N1 diz "A emissão e a gestão de notas ainda não acontecem pela conversa do WhatsApp", mas o artigo 16748296 descreve "Rita, emite uma nota de R$ 500 pra Maria…" com confirmação por botão. A home avisa: "A emissão depende do cadastro e da integração fiscal da sua empresa." Não há menção pública a NF-e de produto.

### 3.5 Pesquisa

| # | Recurso | URL | Trecho (literal) |
|---|---|---|---|
| P1 | Pesquisa com fontes | https://meuassessor.com/pesquisas | "O Ítalo pesquisa, compara e volta com um resumo e as fontes para você decidir." |
| P1b | Aviso quando não dá para confirmar | https://meuassessor.com/pesquisas | "Quando uma informação não pode ser confirmada, o Ítalo sinaliza isso." |
| P2 | Pesquisa e comparação de preços | https://meuassessor.com/pesquisas | "Ítalo, pesquisa o preço médio desse notebook." |
| P3 | Passagens | https://meuassessor.com/pesquisas | "Compare opções de voo, pesquise uma hospedagem ou confira as avaliações de um lugar." |
| P4 | Hotéis | https://meuassessor.com/como-usar | "hotel em Gramado pro feriado, até 600 a diária, casal" |
| P5 | Acesso autorizado a portais (com login do usuário) | https://meuassessor.com/como-usar | "Ítalo, entra no portal do plano de saúde com meu login e pega o boleto de novembro" |
| P5b | Guarda credenciais de portal | https://meuassessor.com/como-usar | "guarda meu login do portal da prefeitura pro Ítalo usar" |
| P6 | Histórico de pesquisas no painel | https://meuassessor.com/pesquisas | "O pedido, o resumo e os links ficam na mesa de Pesquisas do painel e do app." |
| P7 | Perguntas gerais (câmbio, regras públicas) | https://meuassessor.com/como-usar | "quanto tá o euro hoje?" / "qual o teto de faturamento do MEI?" |

### 3.6 Operações

| # | Recurso | URL | Trecho (literal) |
|---|---|---|---|
| O1 | Orquestração de pedidos compostos | https://meuassessor.com/operacao | "O Theo entende os assuntos e reúne os assessores que cuidam de cada parte." |
| O2 | Pendências e próximos passos | https://meuassessor.com/operacao | "O Theo organiza as pendências e mostra o próximo passo" |
| O3 | Avisos automáticos | https://meuassessor.com/ | "Seu resumo financeiro chega sem você precisar pedir." |
| O4 | Participantes compartilhados ilimitados | https://meuassessor.com/ | "Convide sua família, seus sócios ou sua equipe, sem limite de participantes e sem cobrança por pessoa." |
| O5 | Permissões por participante | https://meuassessor.com/operacao | "O que cada um vê acompanha a permissão que você definiu." |
| O6 | Histórico de atividades | https://meuassessor.com/operacao | "Consulte os avisos e o histórico de atividades." |
| O7 | Personalização (nome, horário do resumo, fuso) | https://meuassessor.com/operacao | "O nome pelo qual você gosta de ser chamado, o horário do resumo, o fuso de onde você está." |
| O8 | Confirmação e recibo por ação | https://play.google.com/store/apps/details?id=com.meuassessor.pro.app&hl=pt_BR | "Toda ação vem com recibo: o que foi feito, quanto, quando e onde" |
| O9 | Conector MCP somente leitura para Claude, ChatGPT e Cursor | https://ajuda.meuassessor.com/pt-BR/articles/17827887-conecte-sua-ia-ao-meu-assessor-o-que-e-e-como-funciona-assistentes-de-inteligencia-artificial | "O acesso é somente leitura: nada é lançado, pago ou enviado." |
| O10 | Suporte humano (WhatsApp e e-mail) | https://meuassessor.com/ | "O suporte humano ajuda com plano, cobrança e acesso à conta pelo WhatsApp" |

### 3.7 Canais

| # | Recurso | URL | Trecho (literal) |
|---|---|---|---|
| C1 | WhatsApp como canal principal | https://meuassessor.com/ | "Você só manda uma mensagem no WhatsApp." |
| C1b | Conta comercial verificada pela Meta | https://meuassessor.com/seguranca | "O Meu Assessor é uma conta comercial verificada pela Meta" |
| C1c | Cada participante usa o próprio WhatsApp | https://meuassessor.com/financas | "Cada uma conversa pelo próprio WhatsApp e ajuda a organizar a conta conjunta." |
| C2 | Painel web | https://meuassessor.com/ | "O painel abre no navegador e o app no celular" |
| C2b | Painel com "Palco" e quatro "Mesas", atalhos de teclado | https://ajuda.meuassessor.com/pt-BR/articles/16141010-como-navegar-pelo-painel-do-meu-assessor | "o painel abre no Palco, com 4 Mesas" |
| C3 | App Android | https://play.google.com/store/apps/details?id=com.meuassessor.pro.app&hl=pt_BR | "este app é o seu painel completo: mesas de Finanças, Agenda e Organização" |
| C4 | App iOS | https://apps.apple.com/br/app/meu-assessor-assessores-de-ia/id6812844868 | Nome na App Store: "Meu Assessor: Assessores de IA" (vendedor "Meu Assessor Limitada") |

**Dados das lojas na coleta:**
- **Google Play:** nota 3,0 com 17 avaliações, "10 mil+ downloads", atualizado em 26/07/2026.
- **App Store:** nota 2,9 com 10 avaliações, versão de 21/09/2026, gratuito.

### 3.8 Planos e preços (fonte: https://meuassessor.com/, seção de preços e FAQ)

| Item | Valor público | Trecho |
|---|---|---|
| Plano anual | 12x de R$ 29,90 (R$ 358,80 por ano) | "O anual sai em 12 vezes de R$ 29,90" |
| Plano mensal | R$ 59,90 por mês | "O mensal custa R$ 59,90 por mês." |
| Promoção Black November (até 30/11) | anual em 12x de R$ 19,90 (R$ 238,80 no 1º ano); cupom `BLACKNOVEMBER` | "Black November: plano anual em 12x de R$ 19,90." |
| Garantia | 7 dias com devolução | "7 dias para testar. Não gostou? devolvemos tudo na hora." |
| Usuários | ilimitados, sem cobrança por pessoa | "Usuários compartilhados ilimitados" |
| Escopo | plano único com todos os módulos | "Mais de 140 funcionalidades / Tudo sem limites" |
| Limites reais | Política de Uso Justo nos termos | Termos, cláusula 26.1: "limites quantitativos de referência — como mensagens diárias ao assistente" |

O anual traz o selo "6 meses grátis" em comparação com o mensal. O FAQ diz que as parcelas do anual "não correspondem a uma assinatura mensal".

## 4. Observações de posicionamento (análise nossa)

- **Uma equipe de personas, não um app.** São seis assessores com nome próprio (Theo, Martin, Sofi, Luna, Ítalo, Rita), cada um ligado a um módulo. O Theo funciona como orquestrador. A marca vende delegação ("você manda uma mensagem") em vez de cadastro.
- **O WhatsApp é a interface; painel e app são para acompanhar.** A regra repetida em todas as páginas é: pedir no WhatsApp, enxergar no painel e no app. Os apps nativos têm nota baixa (cerca de 3,0) e poucos downloads diante da alegação de "+350 mil usuários", o que sugere uso concentrado no WhatsApp. A alegação de usuários não é verificável.
- **Confiança como argumento.** Open Finance somente leitura, conta verificada pela Meta, LGPD, suporte humano e "recibo" em cada ação. O GEMA AI já tem confirmação explícita e auditoria; falta comunicar isso.
- **Preço único e agressivo, usuários ilimitados.** Um só plano com todos os módulos. A Política de Uso Justo funciona como válvula de custo.
- **Amplitude acima de profundidade.** Muitos recursos aparecem como "Exemplo ilustrativo" com dados fictícios. A própria central de ajuda contradiz o marketing em pelo menos um ponto (NFS-e pelo WhatsApp).
- **Pontos de risco do concorrente que o GEMA AI pode usar como diferencial:**
  1. Guardar credenciais de portais de terceiros ("guarda meu login do portal…"), com risco jurídico e de segurança.
  2. Enviar recados por WhatsApp a terceiros que não deram consentimento.
  3. Promessas amplas ("Tudo sem limites") limitadas pelo Uso Justo nos termos.
- **Recursos de ecossistema além da lista pedida:** links de cobrança com Pix, cartão e boleto; conector MCP somente leitura para assistentes externos; contas PJ por CNPJ.

## 5. Limitações da análise

- Só vimos material público e de marketing. **Nenhum recurso foi verificado em uso**: não houve login nem teste, e várias telas são marcadas "Exemplo ilustrativo" ou "Dados ilustrativos".
- Páginas buscadas sem executar JavaScript. Conteúdo carregado por scripts (cenas da `/demonstracao`, `guided-scenes.js`) pode ter ficado de fora.
- Da central de ajuda lemos só uma amostra de artigos. As demais coleções (Agenda, Cadastros, Dashboard, Finanças, IA) foram vistas pelos títulos da página inicial.
- Não lemos a Política de Privacidade nem a Política de Uso Justo completa, que fica na central de ajuda e não foi localizada.
- A ficha da App Store veio da API pública de busca da Apple, não da página web da loja. A nota pode variar por país e versão.
- Preços, promoções e números são de **26/11/2026** e mudam com frequência (a Black November termina em 30/11).
- Números de usuários, bancos e funcionalidades ("+350 mil", "+200 bancos", "140 funcionalidades") são alegações do concorrente e não foram auditados.
