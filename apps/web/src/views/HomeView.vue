<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";

/* 3D 全景工具链相对较重（three.js），首页按需异步加载，不拖慢首屏 */
const PanoramaHero = defineAsyncComponent(() => import("@/components/space/PanoramaHero.vue"));

/* 首屏主视觉：真实 360° 实景全景。与 /space 共用同一份场景索引，不另维护数据 */
interface HeroScene {
  id: string;
  name: string;
  poi_id: string;
  panorama: string;
  mobile_panorama?: string;
  description: string;
  thumbnail: string;
}

/** 索引拉取失败时的兜底场景：石桅岩，永嘉最有记忆点的一处 */
const FALLBACK_SCENE: HeroScene = {
  id: "shiwei-rock",
  name: "石桅岩",
  poi_id: "POI-001",
  panorama: "/assets/pano/pano-shiweiyan.webp",
  mobile_panorama: "/assets/pano/pano-shiweiyan-mobile.webp",
  description: "浙南天柱石桅岩 306 米孤峰",
  thumbnail: "/assets/img/kb/poi-001-cover.webp",
};

const router = useRouter();
const heroScenes = ref<HeroScene[]>([]);
const heroIndex = ref(0);
const heroScene = computed<HeroScene>(() => heroScenes.value[heroIndex.value] ?? FALLBACK_SCENE);

async function loadHeroScenes() {
  try {
    const res = await fetch("/assets/3d/pano_scenes_index.json");
    const body = (await res.json()) as { scenes?: HeroScene[] };
    heroScenes.value = body.scenes ?? [];
  } catch {
    heroScenes.value = [];
  }
}

/** 深链进 3D 云游并直接落到指定场景（SpaceView 读 ?scene=） */
function openScene(id: string) {
  void router.push({ path: "/space", query: { scene: id } });
}

/* 知识库底座规模（真实取自 /api/knowledge，未拉到就不展示，不硬编码） */
const kbStats = ref<{ total: number; poi: number; culture: number; business: number } | null>(null);
onMounted(async () => {
  try {
    const [poi, culture, business] = await Promise.all([
      api.searchKnowledge({ domain: "poi", limit: 1 }),
      api.searchKnowledge({ domain: "culture", limit: 1 }),
      api.searchKnowledge({ domain: "business", limit: 1 }),
    ]);
    kbStats.value = { total: poi.total + culture.total + business.total, poi: poi.total, culture: culture.total, business: business.total };
  } catch {
    kbStats.value = null;
  }
  loadHomeCampaigns();
  void loadHeroScenes();
});

/* 节日运营位：由活动库 campaigns/index.json 的 home 字段驱动。
   运营新增/下架一场活动时只改 JSON，首页入口自动出现/消失，无需改代码。 */
interface HomeCampaign {
  id: string;
  name: string;
  tag: string;
  desc: string;
  home?: { image?: string; btn?: string };
  failed?: boolean;
}
const homeCampaigns = ref<HomeCampaign[]>([]);
async function loadHomeCampaigns() {
  try {
    const res = await fetch("/assets/game/campaigns/index.json");
    const body = (await res.json()) as { campaigns?: HomeCampaign[] };
    homeCampaigns.value = (body.campaigns ?? []).filter((c) => c.home?.image);
  } catch {
    homeCampaigns.value = [];
  }
}

/* 平台向 v2：入口按「公众服务 / 政务入口」两端区分；文化寻宝并入 3D 云游 */
interface Mod {
  to?: string;
  icon: string;
  gov: boolean;
  tag: string;
  name: string;
  desc: string;
  accent: string;
  soon?: boolean;
}
const modules: Mod[] = [
  {
    to: "/video",
    icon: "film",
    gov: true,
    tag: "板块一 · AIGC 生产",
    name: "视频生成工坊",
    desc: "运营输入一句话：自动匹配永嘉智库、生成分镜脚本、逐镜头生成并拼接成片——为投放获客批量造内容。",
    accent: "#F0B90B",
  },
  {
    to: "/ar",
    icon: "map",
    gov: true,
    tag: "板块二 · 互动留存",
    name: "AR 互动寻宝",
    desc: "运营按节日模板创建 → AI 生成剧情谜题 → 地图打点发布；玩家走到点位进入围栏，虚拟物浮现、答题领券。当前演示场：石桅岩文化寻宝。",
    accent: "#4ADE80",
  },
  {
    to: "/agent",
    icon: "chat",
    gov: false,
    tag: "板块三 · 智能伴侣",
    name: "智能伴侣 · 楠楠",
    desc: "平台生成的第一位 Agent：对话规划行程、讲解溯源知识库，突降暴雨自动重排，还会按位置与节日推荐美食。",
    accent: "#2DD4BF",
  },
  {
    to: "/dashboard",
    icon: "chart",
    gov: true,
    tag: "政务入口",
    name: "数据看板",
    desc: "视频产出、AR 参与、券核销、消费转化——三板块运营效果一张屏掌握。",
    accent: "#A78BFA",
  },
  {
    to: "/space",
    icon: "3d",
    gov: false,
    tag: "公众体验",
    name: "3D 云游",
    desc: "6 处实景 360° 全景 + 摄影测量三维模型，还能切到大屏巡航自动讲解。",
    accent: "#34D399",
  },
  {
    to: "/wiki",
    icon: "book",
    gov: false,
    tag: "内容底座",
    name: "永嘉知识库",
    desc: "106 条县域文化、山水、烟火内容——视频分镜与智能伴侣共同的唯一事实源。",
    accent: "#F59E0B",
  },
];

/* 六大板块图标：豆包交付（资源生成_豆包工作区/板块图标/），48×48 viewBox、
   stroke-width 2.5 线条风，与移动 TabBar 同源；描边色按板块主色写死。 */
const svgs: Record<string, string> = {
  /* 视频生成工坊：电影胶片 + 播放键 #F0B90B */
  film: '<rect x="6" y="12" width="36" height="24" rx="3" stroke="#F0B90B"/><rect x="6" y="12" width="6" height="24" rx="1" stroke="#F0B90B"/><rect x="36" y="12" width="6" height="24" rx="1" stroke="#F0B90B"/><line x1="12" y1="18" x2="36" y2="18" stroke="#F0B90B" stroke-dasharray="3,2"/><line x1="12" y1="30" x2="36" y2="30" stroke="#F0B90B" stroke-dasharray="3,2"/><path d="M21 20.5 L28 24 L21 27.5 Z" fill="#F0B90B" stroke="none"/>',
  /* AR 互动寻宝：地图定位 + 十字星 #4ADE80 */
  map: '<path d="M24 6 C16 6, 8 12, 8 22 C8 32, 24 42, 24 42 C24 42, 40 32, 40 22 C40 12, 32 6, 24 6 Z" stroke="#4ADE80"/><circle cx="24" cy="21" r="5" stroke="#4ADE80"/><circle cx="36" cy="10" r="3.5" fill="#4ADE80" stroke="none"/><path d="M34.5 10 L37.5 10 M36 8.5 L36 11.5" stroke="#1a1a2e" stroke-width="1.5"/>',
  /* 智能伴侣：对话气泡 + 三点 #2DD4BF */
  chat: '<rect x="6" y="10" width="36" height="24" rx="10" stroke="#2DD4BF"/><path d="M18 34 L14 40 L24 34" stroke="#2DD4BF"/><circle cx="18" cy="22" r="2.2" fill="#2DD4BF" stroke="none"/><circle cx="24" cy="22" r="2.2" fill="#2DD4BF" stroke="none"/><circle cx="30" cy="22" r="2.2" fill="#2DD4BF" stroke="none"/>',
  /* 数据看板：柱状图 + 趋势线 #A78BFA */
  chart: '<line x1="8" y1="40" x2="40" y2="40" stroke="#A78BFA"/><line x1="8" y1="40" x2="8" y2="8" stroke="#A78BFA"/><rect x="14" y="26" width="6" height="14" rx="1" stroke="#A78BFA"/><rect x="24" y="18" width="6" height="22" rx="1" stroke="#A78BFA"/><rect x="34" y="12" width="6" height="28" rx="1" stroke="#A78BFA"/><path d="M14 20 L22 14 L30 18 L38 10" stroke="#A78BFA"/>',
  /* 3D 云游：六面体 #34D399 */
  "3d": '<path d="M24 8 L40 16 L40 32 L24 40 L8 32 L8 16 Z" stroke="#34D399"/><path d="M24 8 L24 24 L8 16" stroke="#34D399"/><path d="M24 24 L40 16" stroke="#34D399"/><path d="M24 24 L24 40" stroke="#34D399"/><circle cx="24" cy="24" r="2" fill="#34D399" stroke="none"/>',
  /* 永嘉知识库：翻开的书本 #F59E0B */
  book: '<path d="M10 8 C14 6, 20 6, 24 9 C28 6, 34 6, 38 8 L38 38 C34 36, 28 36, 24 39 C20 36, 14 36, 10 38 Z" stroke="#F59E0B"/><line x1="24" y1="9" x2="24" y2="39" stroke="#F59E0B"/><line x1="14" y1="15" x2="20" y2="15" stroke="#F59E0B"/><line x1="14" y1="21" x2="20" y2="21" stroke="#F59E0B"/><line x1="28" y1="15" x2="34" y2="15" stroke="#F59E0B"/><line x1="28" y1="21" x2="34" y2="21" stroke="#F59E0B"/>',
};

const wheel = [
  "内容生产",
  "增量游客",
  "数字体验",
  "AI Agent",
  "真实旅游",
  "消费转化",
  "数据沉淀",
  "AI 决策",
];

const wheelIcons = ["🎬", "🧳", "🏞", "🤖", "🚣", "🛍", "📊", "🧠"];
</script>

<template>
  <div class="home">
    <!-- Hero -->
    <section class="hero">
      <div class="hero__bgwrap">
        <!-- 兜底层：WebGL 不可用且海报缺失时的静态山水 -->
        <svg class="hero__fallback" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <linearGradient id="fbg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#101C30" />
              <stop offset="100%" stop-color="#0A1220" />
            </linearGradient>
            <linearGradient id="fpeak" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2b5f64" stop-opacity="0.5" />
              <stop offset="100%" stop-color="#16263f" stop-opacity="0" />
            </linearGradient>
          </defs>
          <rect width="1440" height="760" fill="url(#fbg)" />
          <circle cx="1130" cy="200" r="90" fill="none" stroke="#E8B84B" stroke-opacity="0.5" stroke-width="2" />
          <circle cx="1130" cy="200" r="46" fill="#E8B84B" fill-opacity="0.25" />
          <polygon points="60,760 500,210 720,520 980,120 1380,760" fill="url(#fpeak)" stroke="#3EC6B8" stroke-opacity="0.35" stroke-width="2" />
          <polyline points="0,640 220,620 460,650 720,600 1040,648 1440,610" fill="none" stroke="#3EC6B8" stroke-opacity="0.45" stroke-width="3" />
        </svg>

        <!-- 首屏主视觉：真实 360° 实景全景，慢速横移 + 指针视差；WebGL 不可用则退到上面这层静态山水 -->
        <div class="hero__pano">
          <PanoramaHero
            :panorama="heroScene.panorama"
            :mobile-panorama="heroScene.mobile_panorama"
            poster="/assets/hero/hero-nanxi.webp"
            :speed="2.4"
            :pitch="-3"
            :fov="84"
          />
        </div>
      </div>

      <div class="page hero__content">
        <span class="hero__badge">AI×OPC 2026 · 永嘉农商杯 · 永嘉文旅 AI-Agent 平台</span>
        <h1 class="hero__title">
          永嘉<span class="hero__grad">新游</span>
        </h1>
        <p class="hero__slogan">
          让管理更精准 · 让游客更想来 · 让来了更会玩
        </p>
        <p class="hero__sub">
          面向管委会与文旅局的 Agent 生成平台：零代码生产「获客视频 · AR 互动 · AI 伴游」，
          以永嘉知识库为底座，为县域文旅造一个会思考的数字分身。
        </p>

        <div class="hero__cta">
          <RouterLink to="/space" class="yj-btn yj-btn--primary yj-btn--lg">进入 3D 云游</RouterLink>
          <RouterLink to="/agent" class="yj-btn yj-btn--ghost yj-btn--lg">体验智能伴侣 · 楠楠</RouterLink>
          <RouterLink to="/video" class="yj-btn yj-btn--ghost yj-btn--lg">视频生成工坊</RouterLink>
        </div>

        <div v-if="kbStats" class="hero__stats yj-fade-up">
          <div class="hero__stat">
            <b>{{ kbStats.total }}</b><span>知识条目</span>
          </div>
          <div class="hero__stat">
            <b>{{ kbStats.culture }}</b><span>文化·非遗</span>
          </div>
          <div class="hero__stat">
            <b>{{ kbStats.poi }}</b><span>山水景点</span>
          </div>
          <div class="hero__stat">
            <b>{{ kbStats.business }}</b><span>烟火商家</span>
          </div>
        </div>
      </div>

      <!-- 全景场景快切：首屏就能换掉「眼前这片山水」 -->
      <div v-if="heroScenes.length > 1" class="page hero__sceneswrap">
        <div class="hero__scenes">
          <span class="hero__scenes-label">实景全景 · 点选切换</span>
          <div class="hero__chips">
            <button
              v-for="(s, i) in heroScenes"
              :key="s.id"
              class="hero__chip"
              :class="{ 'is-on': i === heroIndex }"
              type="button"
              @click="heroIndex = i"
            >
              {{ s.name }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 模块入口 -->
    <section class="page home__modules">
      <h2 class="section-title font-maobi">一套平台，两端用户</h2>
      <p class="section-sub">政务侧零代码生成获客内容与互动游戏；游客侧智能伴游、云游寻宝触手可及——共用一份本地知识库。</p>
      <div class="mod-grid">
        <template v-for="m in modules" :key="m.name">
          <RouterLink
            v-if="!m.soon"
            :to="m.to ?? '/'"
            class="yj-card yj-card--hover mod-card"
            :style="{ '--acc': m.accent }"
          >
            <div class="mod-card__icon"><svg viewBox="0 0 48 48" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" v-html="svgs[m.icon]"></svg></div>
            <div class="mod-card__main">
              <span class="mod-card__tag" :class="m.gov ? 'mod-card__tag--gov' : 'mod-card__tag--pub'">{{ m.tag }}</span>
              <h3 class="mod-card__name">{{ m.name }}</h3>
              <p class="mod-card__desc">{{ m.desc }}</p>
            </div>
            <span class="mod-card__arrow">→</span>
          </RouterLink>

          <div
            v-else
            class="yj-card mod-card mod-card--soon"
            :style="{ '--acc': m.accent }"
          >
            <div class="mod-card__icon"><svg viewBox="0 0 48 48" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" v-html="svgs[m.icon]"></svg></div>
            <div class="mod-card__main">
              <span class="mod-card__tag mod-card__tag--gov">{{ m.tag }}</span>
              <h3 class="mod-card__name">{{ m.name }}</h3>
              <p class="mod-card__desc">{{ m.desc }}</p>
            </div>
            <span class="mod-card__soon">建设中</span>
          </div>
        </template>
      </div>
    </section>

    <!-- 3D 数字山河：把「以 3D 为主」的技术亮点单独亮出来 -->
    <section class="page home__space">
      <h2 class="section-title font-maobi">3D 数字山河</h2>
      <p class="section-sub">
        6 处永嘉实景 360° 全景、1 组摄影测量三维模型、1 套大屏巡航演示——把山水搬进浏览器，先种草再出发。
      </p>

      <div class="space-hl">
        <RouterLink to="/space" class="yj-card space-hl__card">
          <span class="space-hl__ic">◉</span>
          <h3 class="space-hl__name">720° 全景漫游</h3>
          <p class="space-hl__desc">
            Three.js 内翻球体承载 6 处实景全景，拖拽环视、滚轮变焦、手机陀螺仪可用，画面热点直连景点知识。
          </p>
          <span class="space-hl__go">进入云游 →</span>
        </RouterLink>

        <RouterLink to="/space" class="yj-card space-hl__card">
          <span class="space-hl__ic">◈</span>
          <h3 class="space-hl__name">实景三维模型</h3>
          <p class="space-hl__desc">
            手机摄影测量生成的建筑群实景模型：原始 945 万面，离线减面到桌面 50 万 / 移动 6.8 万面，WebGL 直接跑。
          </p>
          <span class="space-hl__go">看模型 →</span>
        </RouterLink>

        <RouterLink to="/cruise" class="yj-card space-hl__card">
          <span class="space-hl__ic">▷</span>
          <h3 class="space-hl__name">大屏巡航演示</h3>
          <p class="space-hl__desc">
            全屏无干扰自动巡航，逐镜转向配解说字幕，键盘一按即可接管控场——现场投屏就能开演。
          </p>
          <span class="space-hl__go">开始巡航 →</span>
        </RouterLink>
      </div>

      <div v-if="heroScenes.length" class="space-wall">
        <button
          v-for="s in heroScenes"
          :key="s.id"
          class="space-wall__card"
          type="button"
          @click="openScene(s.id)"
        >
          <img :src="s.thumbnail" :alt="s.name" loading="lazy" decoding="async" />
          <span class="space-wall__veil"></span>
          <span class="space-wall__poi">{{ s.poi_id }}</span>
          <span class="space-wall__body">
            <b>{{ s.name }}</b>
            <small>{{ s.description }}</small>
          </span>
        </button>
      </div>
    </section>

    <!-- 节日运营位（登记于活动库即自动出现） -->
    <section v-if="homeCampaigns.length" class="page home__campaign">
      <h2 class="section-title font-maobi">节日限定 · 运营加场</h2>
      <p class="section-sub">
        运营在活动库登记一场新游戏，首页即自动亮出入口——换题库、换素材、上新玩法都不用改代码。
      </p>
      <div class="campaign-grid">
        <RouterLink
          v-for="c in homeCampaigns"
          :key="c.id"
          :to="`/treasure?campaign=${c.id}`"
          class="campaign-card"
          :style="{ '--acc': '#E8B84B' }"
        >
          <img
            v-if="c.home?.image && !c.failed"
            :src="c.home.image"
            :alt="c.name"
            class="campaign-card__img"
            @error="c.failed = true"
          />
          <div class="campaign-card__veil"></div>
          <div class="campaign-card__body">
            <span class="campaign-card__tag">{{ c.tag }}</span>
            <h3 class="campaign-card__title">{{ c.name }}</h3>
            <p class="campaign-card__desc">{{ c.desc }}</p>
            <span class="campaign-card__btn">{{ c.home?.btn ?? "进入专场" }}</span>
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- 增长飞轮 -->
    <section class="page home__wheel">
      <h2 class="section-title font-maobi">县域文旅增长飞轮</h2>
      <p class="section-sub">一套「数据—内容—体验」自增强引擎，让每一份本地内容都流向下一次增长。</p>

      <div class="yj-card wheel-card">
        <div class="wheel">
          <template v-for="(w, i) in wheel" :key="w">
            <div class="wheel__node">
              <span class="wheel__ic">{{ wheelIcons[i] }}</span>
              <span class="wheel__name">{{ w }}</span>
            </div>
            <svg v-if="i < wheel.length - 1" class="wheel__arrow" viewBox="0 0 24 24"><path d="M4 12h15m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </template>
        </div>
        <div class="wheel__loop">内容回流 · AI 决策反哺生产 —— 循环往复，越转越快</div>
      </div>
    </section>

    <!-- Killer demo strip -->
    <section class="page home__demo">
      <div class="yj-card demo-strip">
        <div class="demo-strip__badge">
          <span>演示主打</span>
          <span class="yj-tag yj-tag--indoor">☂ 突发暴雨</span>
        </div>
        <div class="demo-strip__main">
          <h3>AI Agent 现场重规划，30 秒演示永不翻车</h3>
          <p>
            行程玩到一半突降暴雨？楠楠自动识别户外项目，从知识库 14 个室内替代点中重排行程，
            变更红删绿增，预算实时复检——全部可在演示台一键触发，不赌真实天气。
          </p>
        </div>
        <RouterLink to="/agent" class="yj-btn yj-btn--primary">进 Agent 体验</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  min-height: 92vh;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.hero__bgwrap {
  position: absolute;
  inset: 0;
}
.hero__fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 主视觉容器：与上层静态山水同处 positioned 层，靠 DOM 顺序压在它上面 */
.hero__pano {
  position: absolute;
  inset: 0;
}
/* 全景场景快切：钉在首屏底部，与主视觉同处一个视觉平面 */
.hero__sceneswrap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: var(--space-6);
  z-index: 3;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}
.hero__scenes {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  max-width: 100%;
}
.hero__scenes-label {
  font-size: var(--fs-caption);
  letter-spacing: 0.14em;
  color: var(--color-text-tertiary);
}
.hero__chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}
.hero__chip {
  font: inherit;
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
  background: rgba(10, 18, 32, 0.55);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-pill);
  padding: 6px 14px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.hero__chip:hover {
  color: var(--color-text-primary);
  border-color: var(--color-brand-500);
}
.hero__chip.is-on {
  color: var(--color-text-inverse);
  background: var(--color-brand-500);
  border-color: var(--color-brand-500);
}
/* 窄屏首屏已被文字占满，场景快切让位给下方的场景墙 */
@media (max-width: 760px) {
  .hero__sceneswrap {
    display: none;
  }
}
.hero__content {
  position: relative;
  z-index: 2;
  padding-top: 40px;
  padding-bottom: 60px;
}
.hero__badge {
  display: inline-block;
  font-size: 13px;
  letter-spacing: 0.16em;
  color: var(--primary);
  border: 1px solid rgba(62, 198, 184, 0.35);
  background: rgba(10, 18, 32, 0.5);
  border-radius: 999px;
  padding: 6px 16px;
}
.hero__title {
  font-size: clamp(56px, 9vw, 104px);
  font-weight: 700;
  letter-spacing: 0.06em;
  margin: 22px 0 6px;
  line-height: 1.05;
}
.hero__grad {
  background: linear-gradient(100deg, var(--primary) 10%, #7df2e2 45%, var(--accent) 95%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero__slogan {
  font-size: clamp(17px, 2.2vw, 22px);
  color: var(--text-primary);
  letter-spacing: 0.18em;
  margin: 0 0 14px;
  opacity: 0.92;
}
.hero__sub {
  color: var(--text-secondary);
  font-size: 16px;
  margin: 0 0 26px;
  max-width: 560px;
  line-height: 1.7;
}
.hero__cta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.hero__stats {
  display: flex;
  gap: 26px;
  margin-top: 46px;
  flex-wrap: wrap;
}
.hero__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 92px;
}
.hero__stat b {
  font-family: "JetBrains Mono", monospace;
  font-size: 30px;
  color: var(--primary);
}
.hero__stat span {
  font-size: 13px;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
}

/* ---------- 模块入口 ---------- */
.home__modules {
  margin-top: 20px;
}
.mod-grid {
  margin-top: 18px;
  display: grid;
  /* 交付规范：桌面 3 列 × 2 行；平板 2 列；手机 1 列 × 6 行 */
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
@media (max-width: 900px) {
  .mod-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 560px) {
  .mod-grid {
    grid-template-columns: 1fr;
  }
}
.mod-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  position: relative;
  padding: 20px;
  overflow: hidden;
}
/* 模块色顶部装饰条（对应 ModuleCard 高保真稿） */
.mod-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: var(--acc);
  border-radius: var(--radius-card) var(--radius-card) 0 0;
}
.mod-card:hover {
  border-color: color-mix(in srgb, var(--acc) 60%, transparent);
}
.mod-card__icon {
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: var(--acc);
  background: color-mix(in srgb, var(--acc) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--acc) 30%, transparent);
}
.mod-card__icon svg {
  width: 28px;
  height: 28px;
}
.mod-card__main {
  flex: 1;
  min-width: 0;
}
/* tag chip 跟随模块强调色，而非固定公众/政务色 */
.mod-card__tag {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  border: 1px solid color-mix(in srgb, var(--acc) 40%, transparent);
  margin-bottom: 6px;
}
.mod-card__tag--pub,
.mod-card__tag--gov {
  color: var(--acc);
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.mod-card--soon {
  border-style: dashed;
  cursor: default;
}
.mod-card--soon .mod-card__icon {
  opacity: 0.5;
  filter: grayscale(0.4);
}
.mod-card__soon {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--text-dim);
  border: 1px dashed var(--border);
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
}
.mod-card__name {
  font-size: 17px;
  font-weight: 700;
  margin: 0 0 6px;
}
.mod-card__desc {
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-secondary);
  margin: 0;
}
.mod-card__arrow {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
  font-size: 20px;
  opacity: 0;
  transition: all 0.2s ease;
}
.mod-card:hover .mod-card__arrow {
  opacity: 1;
  right: 12px;
  color: var(--acc);
}

/* ---------- 飞轮 ---------- */
.home__wheel {
  margin-top: 56px;
}
.wheel-card {
  margin-top: 18px;
  padding: 28px 22px;
}
.wheel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 4px;
  justify-content: center;
}
.wheel__node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: linear-gradient(160deg, rgba(62, 198, 184, 0.07), rgba(22, 38, 63, 0.5));
  border: 1px solid rgba(62, 198, 184, 0.2);
  min-width: 88px;
}
.wheel__ic {
  font-size: 22px;
  filter: drop-shadow(0 0 8px rgba(62, 198, 184, 0.3));
}
.wheel__name {
  font-size: 13px;
  color: var(--text-primary);
}
.wheel__arrow {
  width: 26px;
  height: 20px;
  color: rgba(62, 198, 184, 0.55);
  flex: none;
}
.wheel__loop {
  margin-top: 18px;
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 0.1em;
}

/* ---------- killer strip ---------- */
.home__demo {
  margin-top: 30px;
}
.demo-strip {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  border-color: rgba(232, 184, 75, 0.3);
  background: linear-gradient(120deg, rgba(232, 184, 75, 0.06), var(--bg-panel) 45%);
}
.demo-strip__badge {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 0.12em;
}
.demo-strip__main {
  flex: 1;
  min-width: 260px;
}
.demo-strip__main h3 {
  margin: 0 0 6px;
  font-size: 17px;
}
.demo-strip__main p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* ---------- 节日运营位 ---------- */
/* ---------- 3D 数字山河 ---------- */
.home__space {
  margin-top: 56px;
}
.space-hl {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-4);
}
.space-hl__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  border-color: rgba(124, 143, 245, 0.28);
  background: linear-gradient(150deg, rgba(124, 143, 245, 0.1), var(--bg-panel) 52%);
  transition: transform var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out);
}
.space-hl__card:hover {
  transform: translateY(-3px);
  border-color: var(--color-module-space);
}
.space-hl__ic {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  font-size: var(--fs-body-lg);
  color: var(--color-module-space);
  border: 1px solid rgba(124, 143, 245, 0.4);
  background: rgba(124, 143, 245, 0.12);
}
.space-hl__name {
  margin: 0;
  font-size: var(--fs-h4);
  color: var(--color-text-primary);
}
.space-hl__desc {
  margin: 0;
  flex: 1;
  font-size: var(--fs-body-sm);
  line-height: var(--lh-normal);
  color: var(--color-text-secondary);
}
.space-hl__go {
  font-size: var(--fs-body-sm);
  color: var(--color-module-space);
}

/* 场景缩略墙：把 6 处实景素材直接铺出来当门面 */
.space-wall {
  margin-top: var(--space-5);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}
.space-wall__card {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  transition: border-color var(--dur-base) var(--ease-out);
}
.space-wall__card:hover {
  border-color: var(--color-module-space);
}
.space-wall__card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--dur-slow) var(--ease-out);
}
.space-wall__card:hover img {
  transform: scale(1.06);
}
.space-wall__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 38%, rgba(10, 18, 32, 0.88) 100%);
}
.space-wall__poi {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  background: rgba(10, 18, 32, 0.55);
  backdrop-filter: blur(4px);
}
.space-wall__body {
  position: absolute;
  left: var(--space-3);
  right: var(--space-3);
  bottom: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.space-wall__body b {
  font-size: var(--fs-body);
  color: var(--color-text-primary);
}
.space-wall__body small {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home__campaign {
  margin-top: 56px;
}
.campaign-grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}
.campaign-card {
  position: relative;
  min-height: 210px;
  overflow: hidden;
  border-radius: var(--radius-card);
  border: 1px solid color-mix(in srgb, var(--acc) 45%, transparent);
  background:
    linear-gradient(120deg, rgba(232, 184, 75, 0.1), var(--bg-panel) 55%),
    var(--bg-panel);
  display: flex;
  align-items: stretch;
  transition: all 0.2s ease;
}
.campaign-card:hover {
  border-color: var(--acc);
  transform: translateY(-2px);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.32);
}
.campaign-card__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.campaign-card__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgba(10, 18, 32, 0.92) 0%,
    rgba(10, 18, 32, 0.68) 46%,
    rgba(10, 18, 32, 0.18) 100%
  );
}
.campaign-card__body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 22px;
  max-width: 70%;
}
.campaign-card__tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--acc);
  border: 1px solid color-mix(in srgb, var(--acc) 45%, transparent);
  background: rgba(10, 18, 32, 0.6);
  border-radius: var(--radius-pill);
  padding: 3px 10px;
}
.campaign-card__title {
  margin: 0;
  font-size: 21px;
  font-weight: 800;
}
.campaign-card__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-secondary);
}
.campaign-card__btn {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 700;
  color: #0a1220;
  background: var(--acc);
  border-radius: var(--radius-pill);
  padding: 6px 16px;
}

@media (max-width: 720px) {
  .hero {
    min-height: 80vh;
  }
  .campaign-card__body {
    max-width: 100%;
  }
}
</style>
