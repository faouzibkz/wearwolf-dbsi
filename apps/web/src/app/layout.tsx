import type { Metadata } from "next";
import "../styles/globals.css";
import { AccountProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Loup-Garou — Compagnon de jeu",
  description: "Application compagnon pour animer vos parties de Loup-Garou.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <body className="antialiased">
        <AccountProvider>{children}</AccountProvider>
      </body>
    </html>
  );
}
