# Playwright'ın kendi imajı: Chromium ve onun sistem bağımlılıkları hazır
# geliyor. Sürüm, package.json'daki playwright ile aynı olmalı; uyuşmazsa
# tarayıcı ikilisi bulunamıyor.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# Zara'nın bot koruması başsız Chromium'u tanıyor, yalnızca başlıklı tarayıcı
# geçiyor. Sunucuda ekran olmadığı için Xvfb ile sanal bir ekran açıyoruz.
#
# Node, Playwright imajına NodeSource deposundan sabit bir sürümle geliyor;
# imajı yeniden kurmak onu güncellemiyor. `nodejs` burada aynı depodan son
# 24.x'e yükseltiliyor (21 Ekim 2026 güvenlik yaması 24.22.1). Depo imajda
# yoksa apt Ubuntu'nun eski Node'unu önerir ve yükseltme olmaz; alttaki
# kontrol o durumda kurulumu durduruyor, eski Node sessizce yayına çıkmıyor.
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node -e "const [a,b,c]=process.versions.node.split('.').map(Number); \
       if (a<24||(a===24&&(b<22||(b===22&&c<1)))) { \
         console.error('Node ' + process.version + ' eski, en az 24.22.1 gerekli'); process.exit(1); }" \
    && node -v

WORKDIR /app

# Bağımlılıklar önce: kaynak değiştiğinde bu katman önbellekten geliyor.
# Geliştirme bağımlılıkları da kuruluyor, `next build` TypeScript'i istiyor.
# `--ignore-scripts` playwright'ın tarayıcı indirmesini atlıyor; imajda zaten
# kurulu ve yolu PLAYWRIGHT_BROWSERS_PATH ile tanımlı.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Uygulama Xvfb'nin içinde çalışıyor, tarayıcı bu sanal ekranı kullanıyor.
# `-a` boştaki ilk ekran numarasını seçiyor; konteyner yeniden başladığında
# eski kilit dosyası yüzünden takılmasın diye.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1440x900x24 -nolisten tcp", "npm", "run", "start"]
