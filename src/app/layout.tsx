import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { themeInitScript } from "@/components/theme-toggle";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "GEMA AI — Assessor Executivo Inteligente", template: "%s · GEMA AI" },
  description: "Agenda, finanças, tarefas, contatos e briefings organizados por um assessor executivo de IA, no painel e no WhatsApp.",
  applicationName: "GEMA AI",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GEMA AI", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
  openGraph: { type: "website", locale: "pt_BR", siteName: "GEMA AI" },
};

export const viewport: Viewport = {
  themeColor: "#111318",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-gold focus:px-4 focus:py-2 focus:text-on-gold">
          Pular para o conteúdo
        </a>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
