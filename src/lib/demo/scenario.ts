import {
  billAt,
  detectRecurring,
  financialHealth,
  goalProgress,
  periodTotals,
  projectCashflow,
  simulatePayoff,
  type CardCycle,
  type CashflowEvent,
  type LedgerEntry,
} from "@/server/finance/engine";

/**
 * Cenário de DEMONSTRAÇÃO (UX-03). Pessoa, valores e compromissos são fictícios, montados em memória a partir da
 * data de hoje — nada vem do banco nem sai para a rede. Os números exibidos são calculados pelo mesmo motor
 * financeiro do produto, para que a demo mostre o comportamento real, não números decorativos.
 */
export const DEMO_PERSONA = "Marina (personagem fictícia)";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dayOfMonth(today: string, day: number, monthOffset = 0): string {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
}

export const DEMO_CARD: { name: string; cycle: CardCycle; limitCents: number } = {
  name: "Cartão Exemplo",
  cycle: { closingDay: 3, dueDay: 10 },
  limitCents: 800_000,
};

export function buildDemoScenario(today: string) {
  const balanceCents = 845_000;
  const transactions: (LedgerEntry & { description: string; category: string })[] = [
    { kind: "income", status: "paid", amountCents: 980_000, date: dayOfMonth(today, 5), description: "Salário", category: "Renda" },
    { kind: "expense", status: "paid", amountCents: 280_000, date: dayOfMonth(today, 6), description: "Aluguel", category: "Moradia" },
    { kind: "expense", status: "paid", amountCents: 64_350, date: dayOfMonth(today, 8), description: "Supermercado", category: "Alimentação" },
    { kind: "expense", status: "paid", amountCents: 8_500, date: dayOfMonth(today, 9), description: "Almoço", category: "Alimentação" },
    { kind: "expense", status: "paid", amountCents: 22_000, date: dayOfMonth(today, 11), description: "Combustível", category: "Transporte" },
    { kind: "card_payment", status: "paid", amountCents: 187_420, date: dayOfMonth(today, 10), description: "Pagamento da fatura", category: "Cartão" },
    { kind: "refund", status: "paid", amountCents: 12_990, date: dayOfMonth(today, 12), description: "Estorno de compra", category: "Compras" },
    { kind: "expense", status: "cancelled", amountCents: 45_000, date: dayOfMonth(today, 13), description: "Compra cancelada", category: "Compras" },
    { kind: "expense", status: "pending", amountCents: 15_990, date: dayOfMonth(today, 25), description: "Internet", category: "Moradia" },
  ];
  const totals = periodTotals(transactions);

  const byCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.kind === "expense" && (t.status === "paid" || t.status === "reconciled")) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amountCents);
  }
  const categories = [...byCategory].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents);

  // Histórico de 4 meses para a detecção de recorrências (mesmo algoritmo do produto).
  const history = [0, 1, 2, 3].flatMap((i) => [
    { description: "Streaming de vídeo", amountCents: i === 0 ? 4_490 : 3_990, date: dayOfMonth(today, 15, -i) },
    { description: "Academia", amountCents: 11_990, date: dayOfMonth(today, 2, -i) },
    { description: "Farmácia", amountCents: 3_000 + i * 2_700, date: dayOfMonth(today, 7 + i * 5, -i) },
  ]);
  const recurring = detectRecurring(history);

  const bill = billAt(+dayOfMonth(today, 1, 1).slice(0, 4), +dayOfMonth(today, 1, 1).slice(5, 7), DEMO_CARD.cycle);
  const openBillCents = 213_780;
  const cardUsedCents = 341_200;

  const events: CashflowEvent[] = ([
    { date: dayOfMonth(today, 25), deltaCents: -15_990, label: "Internet", source: "pending" },
    { date: bill.dueDate, deltaCents: -openBillCents, label: `Fatura ${DEMO_CARD.name}`, source: "card_bill" },
    { date: dayOfMonth(today, 5, 1), deltaCents: 980_000, label: "Salário", source: "recurring" },
    { date: dayOfMonth(today, 6, 1), deltaCents: -280_000, label: "Aluguel", source: "recurring" },
    { date: dayOfMonth(today, 2, 1), deltaCents: -11_990, label: "Academia", source: "recurring" },
  ] satisfies CashflowEvent[]).filter((e) => e.date > today);
  const cashflow = projectCashflow(balanceCents, addDays(today, 1), 45, events);

  const goals = [
    { name: "Reserva de emergência", ...goalProgress(3_000_000, 1_250_000, today, dayOfMonth(today, 1, 10)) },
    { name: "Viagem de férias", ...goalProgress(900_000, 610_000, today, dayOfMonth(today, 1, 5)) },
  ];

  const debts = [
    { id: "cheque", name: "Cheque especial", balanceCents: 120_000, monthlyRate: 0.08, minPaymentCents: 15_000 },
    { id: "emprestimo", name: "Empréstimo pessoal", balanceCents: 900_000, monthlyRate: 0.025, minPaymentCents: 45_000 },
  ];
  const payoff = { snowball: simulatePayoff(debts, 100_000, "snowball"), avalanche: simulatePayoff(debts, 100_000, "avalanche") };

  const health = financialHealth({
    monthlyIncomeCents: 980_000,
    monthlyExpenseCents: 720_000,
    liquidReserveCents: 1_250_000,
    debtPaymentsCents: 60_000,
    creditCardUsagePct: Math.round((cardUsedCents / DEMO_CARD.limitCents) * 100),
    monthsWithPositiveResult: 5,
    monthsObserved: 6,
  });

  const agenda = [
    { when: `${addDays(today, 1)}T10:00`, title: "Reunião com fornecedor", place: "Videochamada" },
    { when: `${addDays(today, 1)}T10:30`, title: "Dentista", place: "Consultório" },
    { when: `${addDays(today, 2)}T19:00`, title: "Aniversário da Ana", place: "Casa" },
    { when: `${addDays(today, 4)}T08:00`, title: "Renovar seguro do carro", place: "Lembrete" },
  ];
  const tasks = [
    { title: "Enviar comprovante do aluguel", due: addDays(today, 1), priority: "alta" },
    { title: "Revisar orçamento de dezembro", due: addDays(today, 3), priority: "média" },
    { title: "Agendar revisão do carro", due: addDays(today, 7), priority: "baixa" },
  ];

  return {
    today,
    balanceCents,
    transactions,
    totals,
    categories,
    recurring,
    card: { ...DEMO_CARD, usedCents: cardUsedCents, availableCents: DEMO_CARD.limitCents - cardUsedCents, openBillCents, bill },
    cashflow,
    goals,
    debts,
    payoff,
    health,
    agenda,
    tasks,
  };
}

export type DemoScenario = ReturnType<typeof buildDemoScenario>;

/** Roteiro fixo do assistente (sem IA real): mostra roteamento por agente, confirmação e limites de risco. */
export const DEMO_SCRIPT: { prompt: string; agent: string; reply: string; confirm?: boolean; blocked?: boolean }[] = [
  { prompt: "Gastei 85 no almoço e 40 de combustível", agent: "Agente Financeiro", reply: "Registrei 2 despesas, total R$ 125,00: Almoço R$ 85,00 (Alimentação) e Combustível R$ 40,00 (Transporte)." },
  { prompt: "Marca reunião com o fornecedor amanhã às 10", agent: "Agente de Agenda", reply: "Há conflito com “Dentista” às 10:30. Quer que eu crie mesmo assim?", confirm: true },
  { prompt: "Posso comprar um notebook de 4.800 em 6x?", agent: "Agente Financeiro", reply: "Simulei no seu cartão: 6 parcelas de R$ 800,00. O limite comporta a compra; o saldo projetado continua positivo nas próximas faturas. Veja o detalhe em Finanças → Simulador." },
  { prompt: "Transfere 2.000 para a conta da Ana", agent: "Central de Aprovações", reply: "Transferências e pagamentos não são executados pela IA. Posso registrar um lembrete para você fazer no app do seu banco.", blocked: true },
];
