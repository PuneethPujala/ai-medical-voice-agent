import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { StrandsBackground } from "@/components/StrandsBackground";
import { Navbar } from "./_components/Navbar";
import { PageTransition } from "@/components/navigation/PageTransition";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AI Medical Voice Agent | Intelligent Patient Care & Triage",
  description: "Deliver instant, accurate medical assistance through natural voice conversations. Automate scheduling, symptom triage, and follow-up care 24/7.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${jakarta.variable} ${jetbrains.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col font-sans bg-[#F7F9FC] text-slate-900 relative">
          <StrandsBackground />
          <Navbar />
          <PageTransition>
            {children}
          </PageTransition>
        </body>
      </html>
    </ClerkProvider>
  );
}

