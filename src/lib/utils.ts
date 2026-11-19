import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Mascara e-mail/telefone para logs e telas administrativas (minimização LGPD). */
export function maskPii(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return value.length > 4 ? `${"*".repeat(value.length - 4)}${value.slice(-4)}` : "****";
}
