import { notFound } from "next/navigation";
import { connection } from "next/server";
import DemoClient from "./demo-client";

/**
 * Kök adres: ürünün web portalı.
 *
 * Uygulama anahtarı olmadan imzalı çerezle çalışıyor (src/lib/webid.ts).
 * Kanal kapalıyken düğmeleri çalışmayacağı için sayfa da gösterilmiyor;
 * yalnızca TRYIT_WEB_ENABLED=1 iken açılıyor.
 *
 * Bayrak istek anında okunuyor (connection): derlemede okunsa Docker build
 * bayraksız olduğu için sayfa statik 404 olarak pişerdi.
 */
export default async function Page() {
  await connection();
  if (process.env.TRYIT_WEB_ENABLED !== "1") notFound();
  return <DemoClient />;
}
