/** Contrato do gateway Google usado pelas ferramentas de IA e telas (implementação real em ./gateway.ts). */
export interface GoogleEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

export interface GoogleContactInput {
  name: string;
  phoneE164?: string | null;
  email?: string | null;
  company?: string | null;
}

export interface GoogleGateway {
  /** true somente se há token válido armazenado para o produto (calendar/contacts). */
  isConnected(userId: string, workspaceId: string, product: "calendar" | "contacts"): Promise<boolean>;
  createCalendarEvent(userId: string, workspaceId: string, event: GoogleEventInput): Promise<{ id: string; etag?: string; htmlLink?: string }>;
  createContact(userId: string, workspaceId: string, contact: GoogleContactInput): Promise<{ resourceName: string }>;
}
