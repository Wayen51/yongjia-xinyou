/**
 * 把豆包资源包拷入前端 public/assets，并把 wiki 封面 / 3D poster 转成 WebP。
 * 运行：pnpm sync-assets（需已 pnpm i，使用 sharp）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const SRC = path.join(REPO, "资源生成_豆包工作区");
const WEB_ASSETS = path.join(ROOT, "apps", "web", "public", "assets");
const SERVER_SEED = path.join(ROOT, "apps", "server", "src", "db", "seed");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  if (!fs.existsSync(from)) {
    console.warn("  [缺失]", from);
    return false;
  }
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  console.log("  [拷贝]", path.relative(ROOT, to));
  return true;
}

async function jpgToWebp(from, to, maxKb = 150) {
  if (!fs.existsSync(from)) {
    console.warn("  [缺失]", from);
    return;
  }
  ensureDir(path.dirname(to));
  let quality = 82;
  let buf = await sharp(from).resize({ width: 1200, withoutEnlargement: true }).webp({ quality }).toBuffer();
  while (buf.length > maxKb * 1024 && quality > 40) {
    quality -= 8;
    buf = await sharp(from).resize({ width: 1200, withoutEnlargement: true }).webp({ quality }).toBuffer();
  }
  fs.writeFileSync(to, buf);
  console.log(`  [webp] ${path.relative(ROOT, to)} (${Math.round(buf.length / 1024)}KB q=${quality})`);
}

const WIKI_COVERS = [
  "poi-003", "poi-004", "poi-005", "poi-006", "poi-007", "poi-009",
  "poi-011", "poi-012", "poi-017", "poi-028", "poi-029",
  "cul-001", "cul-005",
  "biz-003", "biz-005", "biz-011", "biz-015", "biz-029",
];

async function main() {
  console.log("== 同步永嘉新游静态资源 ==");
  ensureDir(WEB_ASSETS);
  ensureDir(SERVER_SEED);

  copyFile(path.join(SRC, "品牌设计", "brand", "logo.svg"), path.join(WEB_ASSETS, "brand", "logo.svg"));
  copyFile(path.join(SRC, "品牌设计", "brand", "logo-mark.svg"), path.join(WEB_ASSETS, "brand", "logo-mark.svg"));
  copyFile(path.join(SRC, "品牌设计", "brand", "favicon.png"), path.join(WEB_ASSETS, "brand", "favicon.png"));
  copyFile(path.join(SRC, "品牌设计", "brand", "og-cover.jpg"), path.join(WEB_ASSETS, "brand", "og-cover.jpg"));
  copyFile(path.join(SRC, "品牌设计", "brand", "favicon.png"), path.join(ROOT, "apps", "web", "public", "favicon.png"));

  copyFile(path.join(SRC, "游戏素材", "tileset.png"), path.join(WEB_ASSETS, "game", "tileset.png"));
  copyFile(path.join(SRC, "游戏素材", "sprite-player.png"), path.join(WEB_ASSETS, "game", "sprite-player.png"));
  copyFile(path.join(SRC, "游戏素材", "sprite-npc-scholar.png"), path.join(WEB_ASSETS, "game", "sprite-npc-scholar.png"));
  copyFile(path.join(SRC, "游戏素材", "sprite-npc-villager.png"), path.join(WEB_ASSETS, "game", "sprite-npc-villager.png"));
  copyFile(path.join(SRC, "游戏素材", "sprite-npc-craftsman.png"), path.join(WEB_ASSETS, "game", "sprite-npc-craftsman.png"));

  const processed = path.join(SRC, "图片加工", "输出", "assets");
  copyFile(path.join(processed, "img", "hero-bg.webp"), path.join(WEB_ASSETS, "hero", "hero-nanxi.webp"));
  copyFile(path.join(processed, "img", "dashboard-bg.webp"), path.join(WEB_ASSETS, "img", "dashboard-bg.webp"));
  copyFile(path.join(processed, "game", "game-scene-shiweiyan.webp"), path.join(WEB_ASSETS, "game", "game-scene-shiweiyan.webp"));

  for (const name of ["poi-001-cover.webp", "poi-010-cover.webp", "biz-001-cover.webp", "biz-016-cover.webp"]) {
    copyFile(path.join(processed, "img", "kb", name), path.join(WEB_ASSETS, "img", "kb", name));
  }
  for (const name of ["poi-cover.webp", "culture-cover.webp", "business-cover.webp"]) {
    copyFile(path.join(processed, "img", "placeholders", name), path.join(WEB_ASSETS, "img", "placeholders", name));
    copyFile(path.join(processed, "img", "placeholders", name), path.join(WEB_ASSETS, "wiki", name === "poi-cover.webp" ? "placeholder.webp" : name));
  }

  const wikiDir = path.join(SRC, "图片素材", "wiki封面");
  if (fs.existsSync(wikiDir)) {
    const files = fs.readdirSync(wikiDir);
    for (const prefix of WIKI_COVERS) {
      const hit = files.find((f) => f.toLowerCase().startsWith(prefix + "-") || f.toLowerCase().startsWith(prefix + "."));
      if (!hit) {
        console.warn("  [缺失封面]", prefix);
        continue;
      }
      await jpgToWebp(path.join(wikiDir, hit), path.join(WEB_ASSETS, "img", "kb", `${prefix}-cover.webp`), 150);
    }
  }

  await jpgToWebp(
    path.join(SRC, "3D素材", "shiwei-poster.jpg"),
    path.join(WEB_ASSETS, "3d", "shiwei-poster.webp"),
    300,
  );

  const seeds = [
    ["知识库/归一化/knowledge_seed_v3.json", "knowledge_seed_v3.json"],
    ["智能体/mock_agent_script.json", "mock_agent_script.json"],
    ["智能体/booking_voucher_template.json", "booking_voucher_template.json"],
    ["知识库/agent_shortcuts.json", "agent_shortcuts.json"],
    ["知识库/rain_replan_script.json", "rain_replan_script.json"],
    ["游戏内容/treasure_quests.json", "treasure_quests.json"],
    ["游戏内容/npc_dialogues.json", "npc_dialogues.json"],
    ["演示数据/dashboard_demo_data.json", "dashboard_demo_data.json"],
    ["3D素材/pano_hotspots.json", "pano_hotspots.json"],
  ];
  for (const [rel, dest] of seeds) {
    copyFile(path.join(SRC, ...rel.split("/")), path.join(SERVER_SEED, dest));
    if (["treasure_quests.json", "npc_dialogues.json", "pano_hotspots.json"].includes(dest)) {
      copyFile(path.join(SRC, ...rel.split("/")), path.join(WEB_ASSETS, dest.includes("pano") ? "3d" : "game", dest));
    }
  }

  console.log("完成。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
