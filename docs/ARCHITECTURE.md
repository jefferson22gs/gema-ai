# Arquitetura

## Contexto (C4 nível 1)

```mermaid
flowchart LR
  U[Usuário<br/>web / PWA] -->|HTTPS| V[GEMA AI<br/>Next.js na Vercel]
  W[WhatsApp do usuário] --> M[Meta Cloud API] -->|webhook assinado| V
  W --> E[Evolution API<br/>host persistente wa.dominio] -->|webhook c/ segredo| V
  V -->|SQL c/ RLS| S[(Supabase Postgres)]
  V --> ST[(Supabase Storage<br/>bucket privado)]
  V --> A[Supabase Auth]
  V -->|function calling| G[Gemini API]
  V --> R[Resend] & B[Brevo]
  V -->|OAuth 2.0| GC[Google Calendar / People]
  C[Vercel Cron] -->|CRON_SECRET| V
  CF[Cloudflare DNS/WAF] --- V & E
```

## Contêineres (C4 nível 2)

```mermaid
flowchart TB
  subgraph Vercel
    P[Proxy: refresh de sessão + redirect otimista]
    UI[Server Components / Server Actions]
    API[Route Handlers: chat, webhooks, OAuth, cron, docs]
  end
  subgraph Domínio [src/server]
    ORC[Orquestrador IA] --> REG[Registry de ferramentas Zod]
    REG --> EXE[Executor: estados, idempotência, confirmação, auditoria]
    EXE --> SVC[Serviços de domínio]
    ING[Ingestão de canais] --> ORC
    AUT[Motor de automações] --> OUT[Outbox] --> DSP[Dispatcher multicanal]
  end
  UI & API --> Domínio
  SVC -->|asUser: role authenticated + JWT claims| DB[(Postgres + RLS)]
  ING & AUT & DSP -->|asService: role service_role| DB
```

## Decisões principais

| Decisão | Motivo |
|---|---|
| Acesso a dados via `postgres` com `set local role authenticated` + `request.jwt.claims` | RLS aplicada em **toda** consulta de usuário, transações reais e locks (`for update skip locked`). Mesmo SQL testado em PGlite. |
| IA só propõe `{tool, args}` | O modelo nunca toca o banco. Zod valida, RLS autoriza, executor registra estado e audita. |
| Datas relativas resolvidas no servidor (`relative_day`, `weekday`) | O modelo não calcula datas; timezone do usuário + relógio do servidor garantem "amanhã às 10" correto. |
| Valores em centavos (`bigint`) | Sem erro de ponto flutuante. |
| Idempotência por `idempotency_key` com `unique (workspace_id, idempotency_key)` | Webhook repetido / duplo envio não duplica lançamentos, eventos, tarefas ou execuções. |
| Outbox separado do envio | Preparação (automação) ≠ decisão de canal ≠ entrega; retries com backoff e dead-letter. |
| Evolution fora da Vercel | Sessões WhatsApp exigem processo persistente (sockets, QR). |
| Super Admin fora da RLS de cliente | Lê apenas agregados via service role, com auditoria por página. |

## Fluxo: "gastei 85 no almoço e 40 no combustível" pelo WhatsApp

```mermaid
sequenceDiagram
  participant WA as Evolution/Meta
  participant WH as /api/webhooks/*
  participant ING as ingestWebhook
  participant ORC as handleUserMessage
  participant GM as Gemini
  participant EX as executor
  WA->>WH: POST (assinatura/segredo)
  WH->>ING: verifica + replay protection
  ING->>ING: ignora fromMe; resolve titular por channel_account verificada
  ING->>ORC: mensagem (dedupe por provider_message_id)
  ORC->>GM: system + histórico (se consentido) + texto
  GM-->>ORC: create_expense{items:[85, 40]}
  ORC->>EX: executa (idempotency_key = provider:msgid:i)
  EX-->>ORC: succeeded (2 transações)
  ORC-->>ING: "✓ 2 despesas registradas, total R$ 125,00"
  ING->>WA: sendText
```
