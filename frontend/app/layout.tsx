import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "DrawToCloud",
  description: "Generate production-ready cloud diagrams and Terraform.",
  icons: {
    icon: "/logo-4.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
        <Toaster richColors theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
