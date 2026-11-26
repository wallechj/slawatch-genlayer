import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLAWatch — Trustless Uptime SLA Adjudicator on GenLayer",
  description:
    "Neutral multi-validator SLA breach adjudication powered by GenLayer Intelligent Contracts and live Atlassian Statuspage v2 evidence.",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
