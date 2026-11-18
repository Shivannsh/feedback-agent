import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "First Listener — Hear how your pitch lands",
  description: "A fresh perspective on the picture your pitch creates.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
