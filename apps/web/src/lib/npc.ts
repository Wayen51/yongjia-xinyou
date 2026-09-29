/**
 * NPC 人物素材映射（唯一入口）
 *
 * 设计要点（配合后备资源组出图节奏）：
 * 1. 站点数据里的 npc 是中文字符串（如「永嘉学派传人」），素材文件按英文命名。
 * 2. 规则表按「更具体 → 更宽泛」排序，**先命中者生效**。
 * 3. 每条规则声明 `fallback`：当专属素材尚未落盘时自动回落到已有素材，
 *    因此新增角色**不会产生 404 破图**。
 * 4. 出图落盘后，只需把文件名加进 `AVAILABLE_PORTRAITS` / `AVAILABLE_SPRITES`，
 *    专属形象立即生效 —— 无需改动任何业务组件。
 */

/** 立绘目录（public 下） */
const BILLBOARD_DIR = "/assets/ar/billboard";
/** 像素 sprite 目录（public 下） */
const SPRITE_DIR = "/assets/game";

/** 兜底形象：楠楠 */
const FALLBACK_PORTRAIT = "billboard-nannan-sprite.webp";
/** 兜底 sprite */
const FALLBACK_SPRITE = "villager";

/* ===================== 立绘（assets/ar/billboard） ===================== */

/**
 * 已落盘的立绘文件名白名单。
 * ⚠️ 后备资源组每产出一张专属立绘，就把文件名加到这里（其余逻辑不用动）。
 */
export const AVAILABLE_PORTRAITS: string[] = [
  FALLBACK_PORTRAIT,
  "npc-riddle-master.webp",
  "npc-granny.webp",
  "npc-boat-lady.webp",
  "npc-village-elder.webp",
  "npc-scholar.webp",
  "npc-potter.webp",
  "npc-tea-farmer.webp",
  "npc-baker.webp",
  // ↓ G-09 批次1 已交付（2026-09-11，豆包）
  "npc-xuepai-heir.webp",
  "npc-brewer.webp",
  "npc-martial-artist.webp",
  "npc-tea-picker.webp",
  "npc-lantern-dancer.webp",
  // ↓ G-09b/G-09c 批次2+3 已交付（2026-09-11，豆包）
  //   至此 18 个角色形象全部就位，规则表内不再存在「回落」路径
  "npc-old-scholar.webp",
  "npc-opera-actor.webp",
  "npc-digital-guide.webp",
  "npc-woodcarver.webp",
  "npc-noodle-vendor.webp",
  "npc-baking-auntie.webp",
];

interface PortraitRule {
  /** 目标素材（专属形象） */
  file: string;
  /** 目标素材缺位时的回落素材（必须已落盘） */
  fallback: string;
  /** 命中关键词（对人物名做 includes 匹配，顺序敏感） */
  keys: string[];
}

/** 规则表：更具体的角色写在更前面 */
const PORTRAIT_RULES: PortraitRule[] = [
  // —— 专属形象（必须排在下方的泛化关键词之前，否则会被 npc-scholar 的
  //    「先生/向导/伶」、npc-potter 的「师傅」、npc-granny 的「大娘」抢先命中）——
  { file: "npc-old-scholar.webp", fallback: "npc-scholar.webp", keys: ["老学究"] },
  { file: "npc-opera-actor.webp", fallback: "npc-scholar.webp", keys: ["老伶", "戏班"] },
  { file: "npc-martial-artist.webp", fallback: "npc-potter.webp", keys: ["武师", "南拳", "习武"] },
  { file: "npc-digital-guide.webp", fallback: "npc-scholar.webp", keys: ["数字诗路", "数字向导", "科技向导"] },
  { file: "npc-woodcarver.webp", fallback: "npc-potter.webp", keys: ["木雕"] },
  { file: "npc-noodle-vendor.webp", fallback: "npc-granny.webp", keys: ["粉干"] },
  { file: "npc-xuepai-heir.webp", fallback: FALLBACK_PORTRAIT, keys: ["学派", "传人"] },
  { file: "npc-brewer.webp", fallback: FALLBACK_PORTRAIT, keys: ["酿酒", "老酒汗", "老司"] },
  { file: "npc-tea-picker.webp", fallback: "npc-tea-farmer.webp", keys: ["采茶女"] },
  { file: "npc-lantern-dancer.webp", fallback: "npc-potter.webp", keys: ["马灯"] },
  { file: "npc-baking-auntie.webp", fallback: "npc-baker.webp", keys: ["麦饼大娘"] },

  // —— 已具备的专属形象 ——
  { file: FALLBACK_PORTRAIT, fallback: FALLBACK_PORTRAIT, keys: ["楠楠"] },
  { file: "npc-riddle-master.webp", fallback: FALLBACK_PORTRAIT, keys: ["灯谜"] },
  { file: "npc-baker.webp", fallback: FALLBACK_PORTRAIT, keys: ["麦饼", "面点", "糕点"] },
  { file: "npc-granny.webp", fallback: FALLBACK_PORTRAIT, keys: ["阿婆", "大娘", "摊主", "晒秋"] },
  { file: "npc-boat-lady.webp", fallback: FALLBACK_PORTRAIT, keys: ["船娘", "船夫", "摇橹", "艄公"] },
  { file: "npc-village-elder.webp", fallback: FALLBACK_PORTRAIT, keys: ["族长", "村老", "里正"] },
  { file: "npc-tea-farmer.webp", fallback: FALLBACK_PORTRAIT, keys: ["采茶", "茶农", "茶女"] },
  { file: "npc-potter.webp", fallback: FALLBACK_PORTRAIT, keys: ["匠人", "制瓷", "瓯窑", "陶艺", "师傅"] },
  {
    file: "npc-scholar.webp",
    fallback: FALLBACK_PORTRAIT,
    keys: ["先生", "学子", "书生", "诗人", "学者", "学究", "向导", "伶"],
  },
];

/** 素材是否已落盘（未落盘时回落到备用素材，避免 404） */
function isPortraitReady(file: string) {
  return AVAILABLE_PORTRAITS.includes(file);
}

/** NPC 立绘文件名（未命中或素材缺位时回落） */
export function npcPortraitFile(name?: string | null): string {
  const n = (name || "").trim();
  if (!n) return FALLBACK_PORTRAIT;
  for (const rule of PORTRAIT_RULES) {
    if (rule.keys.some((k) => n.includes(k))) {
      return isPortraitReady(rule.file) ? rule.file : rule.fallback;
    }
  }
  return FALLBACK_PORTRAIT;
}

/** NPC 立绘可访问 URL（assets/ar/billboard 下，publicDir 已指向 web/public） */
export function npcPortraitUrl(name?: string | null): string {
  return `${BILLBOARD_DIR}/${npcPortraitFile(name)}`;
}

/**
 * 兼容「中文名」与「素材文件名」两种输入，统一返回可访问 URL。
 * - 站点数据里的 npc 可能是中文名（如「灯谜先生」）
 * - 创建台草稿里的 npc 是素材文件名（如「npc-scholar.webp」）
 */
export function npcPortraitSrc(nameOrFile?: string | null): string {
  const v = (nameOrFile || "").trim();
  if (/\.(webp|png|jpe?g)$/i.test(v)) return `${BILLBOARD_DIR}/${v}`;
  return npcPortraitUrl(v);
}

/* ===================== 像素 sprite（assets/game） ===================== */

/** 已落盘的 sprite 名白名单（产出专属 sprite 后把名字加进来） */
export const AVAILABLE_SPRITES: string[] = ["scholar", "villager", "craftsman"];

interface SpriteRule {
  file: string;
  fallback: string;
  keys: string[];
}

/**
 * sprite 规则：同样「更具体 → 更宽泛」。
 * ⚠️ `fallback` 刻意保持与旧版 `TreasureView.npcSprite()` 完全一致（旧版默认 villager、
 * 「大娘/阿婆/船夫/船娘/族长」→ craftsman），保证专属 sprite 未落盘时**画面零变化**。
 */
const SPRITE_RULES: SpriteRule[] = [
  { file: "old-scholar", fallback: "villager", keys: ["老学究"] },
  { file: "opera-actor", fallback: "villager", keys: ["老伶", "戏班"] },
  { file: "martial-artist", fallback: "villager", keys: ["武师", "南拳", "习武"] },
  { file: "digital-guide", fallback: "villager", keys: ["数字诗路", "数字向导", "科技向导"] },
  { file: "woodcarver", fallback: "villager", keys: ["木雕"] },
  { file: "noodle-vendor", fallback: "villager", keys: ["粉干"] },
  { file: "xuepai-heir", fallback: "villager", keys: ["学派", "传人"] },
  { file: "brewer", fallback: "villager", keys: ["酿酒", "老酒汗", "老司"] },
  { file: "tea-picker", fallback: "villager", keys: ["采茶女"] },
  { file: "lantern-dancer", fallback: "villager", keys: ["马灯"] },
  { file: "baking-auntie", fallback: "craftsman", keys: ["麦饼大娘"] },
  // —— 通用三样式（关键词与旧版逐字一致）——
  { file: "scholar", fallback: "scholar", keys: ["学者", "先生", "书生", "诗人"] },
  { file: "craftsman", fallback: "craftsman", keys: ["匠人", "大娘", "阿婆", "船夫", "船娘", "族长"] },
];

/** NPC 像素 sprite 名（未命中或素材缺位时回落通用样式） */
export function npcSpriteName(name?: string | null): string {
  const n = (name || "").trim().toLowerCase();
  if (!n) return FALLBACK_SPRITE;
  for (const rule of SPRITE_RULES) {
    if (rule.keys.some((k) => n.includes(k))) {
      return AVAILABLE_SPRITES.includes(rule.file) ? rule.file : rule.fallback;
    }
  }
  return FALLBACK_SPRITE;
}

/** NPC 像素 sprite URL */
export function npcSpriteUrl(name?: string | null): string {
  return `${SPRITE_DIR}/sprite-npc-${npcSpriteName(name)}.png`;
}

/* ===================== 创建台可选 NPC 引导员 ===================== */

/**
 * 创建台可选的 NPC 引导员。
 * file = 真实素材文件名（写入 station.npc 时会转成 label 提交），label = 展示名。
 */
export const NPC_OPTIONS: Array<{ file: string; label: string }> = [
  { file: FALLBACK_PORTRAIT, label: "楠楠" },
  { file: "npc-riddle-master.webp", label: "灯谜先生" },
  { file: "npc-granny.webp", label: "摊主阿婆" },
  { file: "npc-boat-lady.webp", label: "摇橹船娘" },
  { file: "npc-village-elder.webp", label: "村老族长" },
  { file: "npc-scholar.webp", label: "书院先生" },
  { file: "npc-potter.webp", label: "瓯窑工匠" },
  { file: "npc-tea-farmer.webp", label: "茶农阿伯" },
  { file: "npc-baker.webp", label: "麦饼师傅" },
  // ↓ G-09 专属立绘（批次 1 + 批次 2/3，2026-09-11 全部到位）
  { file: "npc-brewer.webp", label: "酿酒老司" },
  { file: "npc-xuepai-heir.webp", label: "永嘉学派传人" },
  { file: "npc-martial-artist.webp", label: "南拳武师" },
  { file: "npc-tea-picker.webp", label: "采茶女" },
  { file: "npc-lantern-dancer.webp", label: "马灯艺人" },
  { file: "npc-old-scholar.webp", label: "老学究" },
  { file: "npc-opera-actor.webp", label: "戏班老伶" },
  { file: "npc-digital-guide.webp", label: "数字诗路向导" },
  { file: "npc-woodcarver.webp", label: "木雕师傅" },
  { file: "npc-noodle-vendor.webp", label: "粉干摊主" },
  { file: "npc-baking-auntie.webp", label: "麦饼大娘" },
];
