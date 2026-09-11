import type { Metadata } from "next";
import "./globals.css";
import ClickSpark from "@/components/ClickSpark";

export const metadata: Metadata = {
  title: "Mizan · Hybrid Deployment Orchestrator",
  description: "Policy-based routing of AI workloads across cloud, on-prem and air-gapped environments.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ClickSpark sparkColor="#3ba6f1" sparkSize={9} sparkRadius={13} sparkCount={9} duration={380}>
          {children}
        </ClickSpark>
      </body>
    </html>
  );
}
