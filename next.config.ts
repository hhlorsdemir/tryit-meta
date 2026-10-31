import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ürün görselleri rastgele e-ticaret CDN'lerinden geliyor, bu yüzden
  // next/image yerine düz <img> kullanıyoruz ve optimizasyonu atlıyoruz.
  reactStrictMode: true,
  // Playwright kendi ikili dosyalarını çalışma anında açıyor; paketlenirse
  // yolları kayboluyor. Sunucu tarafında olduğu gibi bırakıyoruz.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
