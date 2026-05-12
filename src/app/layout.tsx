import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "44Shots",
  description: "Elite Hockey Analytics for coaches, scorers, and goalies.",
  applicationName: "44Shots",
  openGraph: {
    title: "44Shots",
    description: "Elite Hockey Analytics for coaches, scorers, and goalies.",
    siteName: "44Shots",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "44Shots",
    description: "Elite Hockey Analytics for coaches, scorers, and goalies.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
