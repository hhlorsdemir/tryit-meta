#!/usr/bin/env node
/**
 * Olay günlüğünü okunur bir rapora çevirir.
 *
 * Sunucuda:
 *   docker compose -f deploy/docker-compose.yml exec app node scripts/rapor.mjs
 *
 * Tek bir gün için:
 *   ... node scripts/rapor.mjs 2026-09-22
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.TRYIT_DATA_DIR || ".data";
const only = process.argv[2];

function load() {
  let names;
  try {
    names = readdirSync(dir).filter((n) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort();
  } catch {
    console.log(`Günlük dizini yok: ${dir}`);
    process.exit(0);
  }
  if (only) names = names.filter((n) => n.includes(only));

  const rows = [];
  for (const name of names) {
    const day = name.slice(7, 17);
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (!line) continue;
      try {
        rows.push({ day, ...JSON.parse(line) });
      } catch {
        // Yarım satır.
      }
    }
  }
  return rows;
}

function table(title, pairs) {
  if (!pairs.length) return;
  console.log(`\n${title}`);
  const width = Math.max(...pairs.map(([k]) => String(k).length));
  for (const [k, v] of pairs) console.log(`  ${String(k).padEnd(width)}  ${v}`);
}

function count(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = key(row);
    if (value === undefined || value === null) continue;
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map].sort((a, b) => b[1] - a[1]);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const rows = load();
if (!rows.length) {
  console.log("Henüz olay yok.");
  process.exit(0);
}

const days = [...new Set(rows.map((r) => r.day))].sort();
console.log(`${rows.length} olay, ${days.length} gün (${days[0]} .. ${days.at(-1)})`);
console.log(`${new Set(rows.filter((r) => r.device).map((r) => r.device)).size} farklı cihaz`);

// Huni: kaç cihaz hangi adıma kadar geldi.
const reached = (event) => new Set(rows.filter((r) => r.event === event && r.ok).map((r) => r.device));
const avatar = reached("avatar");
const resolve = reached("resolve");
const tryon = reached("tryon");
table("Huni (başaran cihaz sayısı)", [
  ["avatar oluşturdu", avatar.size],
  ["link ekledi", resolve.size],
  ["kombin üretti", tryon.size],
]);

// Adım adım başarı oranı ve süre.
console.log("\nAdımlar");
for (const event of ["avatar", "resolve", "tryon"]) {
  const all = rows.filter((r) => r.event === event);
  if (!all.length) continue;
  const ok = all.filter((r) => r.ok);
  const rate = ((ok.length / all.length) * 100).toFixed(0);
  const ms = median(ok.map((r) => r.ms));
  console.log(
    `  ${event.padEnd(8)} ${String(all.length).padStart(5)} istek  ${rate.padStart(3)}% başarılı  ortanca ${(ms / 1000).toFixed(1)}sn`,
  );
}

table(
  "Başarısızlık nedenleri",
  count(rows.filter((r) => !r.ok), (r) => `${r.event}/${r.code ?? "?"}`),
);

table(
  "Çözülemeyen siteler",
  count(rows.filter((r) => r.event === "resolve" && !r.ok && r.host), (r) => r.host),
);

table(
  "Çözülen siteler",
  count(rows.filter((r) => r.event === "resolve" && r.ok && r.host), (r) => r.host),
);

table("Kombin büyüklüğü", count(rows.filter((r) => r.event === "tryon" && r.ok), (r) => r.detail));

// Para: üretilen her kombin motor faturasına yazılıyor.
const generated = rows.filter((r) => r.event === "tryon" && r.ok).length;
console.log(`\nÜretilen kombin: ${generated}  (yaklaşık $${(generated * 0.08).toFixed(2)})`);

// En çok tüketen cihazlar. Sınırların doğru yerde olup olmadığını gösterir.
table(
  "En çok kombin üreten cihazlar",
  count(rows.filter((r) => r.event === "tryon" && r.ok), (r) => r.device.slice(0, 8)).slice(0, 10),
);
