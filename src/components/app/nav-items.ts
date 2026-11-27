export const APP_NAV = [
  { href: "/app", label: "Início", icon: "home" },
  { href: "/app/assistente", label: "Assistente", icon: "sparkles" },
  { href: "/app/conversas", label: "Conversas", icon: "messages" },
  { href: "/app/aprovacoes", label: "Aprovações", icon: "shield" },
  { href: "/app/agenda", label: "Agenda", icon: "calendar" },
  { href: "/app/financas", label: "Finanças", icon: "wallet" },
  { href: "/app/tarefas", label: "Tarefas", icon: "check" },
  { href: "/app/projetos", label: "Projetos", icon: "folder" },
  { href: "/app/contatos", label: "Contatos", icon: "users" },
  { href: "/app/documentos", label: "Documentos", icon: "file" },
  { href: "/app/briefings", label: "Briefings", icon: "sunrise" },
  { href: "/app/automacoes", label: "Automações", icon: "zap" },
  { href: "/app/integracoes", label: "Integrações", icon: "plug" },
  { href: "/app/notificacoes", label: "Notificações", icon: "bell" },
] as const;

export const APP_NAV_SECONDARY = [
  { href: "/app/membros", label: "Membros", icon: "users" },
  { href: "/app/configuracoes", label: "Configurações", icon: "settings" },
  { href: "/app/assinatura", label: "Assinatura", icon: "credit" },
  { href: "/app/ajuda", label: "Ajuda", icon: "help" },
] as const;

/** Barra inferior mobile: Início · Finanças · GEMA (central) · Agenda · Mais. */
export const MOBILE_NAV = [
  { href: "/app", label: "Início", icon: "home" },
  { href: "/app/financas", label: "Finanças", icon: "wallet" },
  { href: "/app/assistente", label: "GEMA AI", icon: "sparkles", primary: true },
  { href: "/app/agenda", label: "Agenda", icon: "calendar" },
  { href: "/app/mais", label: "Mais", icon: "menu" },
] as const;
