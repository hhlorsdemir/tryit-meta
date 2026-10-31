import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { APP_NAME, POWERED_BY } from "@/lib/brand";
import "./globals.css";

// iOS uygulamasıyla aynı dosya; dışarıdan font çağrısı yok.
const jakarta = localFont({
  src: "./fonts/PlusJakartaSans-Variable.ttf",
  weight: "400 700",
  display: "swap",
  variable: "--font",
});

const description = `Add one photo and product links, see the whole outfit on you. ${POWERED_BY}.`;

export const metadata: Metadata = {
  title: APP_NAME,
  description,
  openGraph: { title: APP_NAME, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Dil istemcide anahtarla değişiyor; sunucu jüri için İngilizce başlatıyor.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={jakarta.variable}>{children}</body>
    </html>
  );
}
