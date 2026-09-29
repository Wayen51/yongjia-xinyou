<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "@/lib/toast";
import SpriteSheet from "@/components/common/SpriteSheet.vue";
import { npcSpriteUrl } from "@/lib/npc";
import QuizGame from "@/components/treasure/QuizGame.vue";
import JigsawGame from "@/components/treasure/JigsawGame.vue";
import MemoryGame from "@/components/treasure/MemoryGame.vue";
import MazeGame from "@/components/treasure/MazeGame.vue";
import PoemOrderGame from "@/components/treasure/PoemOrderGame.vue";
import LinkMatchGame from "@/components/treasure/LinkMatchGame.vue";
import HiddenObjectGame from "@/components/treasure/HiddenObjectGame.vue";
import ClozeGame from "@/components/treasure/ClozeGame.vue";
import type { GameResult } from "@/components/treasure/types";
import type { Component } from "vue";

/* ================= 站点（由活动 bundle 提供） ================= */
interface Station {
  id: string;
  name: string;
  x: number;
  y: number;
  kw: string[];
  emoji: string;
  desc: string;
}

/* ================= 游戏配置（由活动 bundle 提供） ================= */
interface StationGame {
  stationId: string;
  type: string;
  title: string;
  npc: string;
  locationDetail: string;
  intro: string;
  solvedMsg: string;
  reward: string;
  related_culture_id?: string;
  data: Record<string, any>;
}

/* ================= 活动模板化：运营换一套 bundle JSON 即开新主题 ================= */
interface CampaignMeta {
  id: string;
  name: string;
  tag: string;
  emoji: string;
  desc: string;
  bundle: string;
}

interface TreasureBundle {
  game: string;
  description: string;
  mapImage: string;
  mapTip: string;
  stations: Station[];
  edges: Array<[number, number]>;
  games: StationGame[];
}

const router = useRouter();
const route = useRoute();

const GAME_COMPONENTS: Record<string, Component> = {
  quiz: QuizGame,
  jigsaw: JigsawGame,
  memory: MemoryGame,
  maze: MazeGame,
  poem: PoemOrderGame,
  link: LinkMatchGame,
  hidden: HiddenObjectGame,
  cloze: ClozeGame,
};

const campaigns = ref<CampaignMeta[]>([]);
const activeCampaign = ref<CampaignMeta | null>(null);
const bundle = ref<TreasureBundle | null>(null);
const loading = ref(true);
const loadError = ref(false);

const stations = computed<Station[]>(() => bundle.value?.stations ?? []);
const edges = computed<Array<[number, number]>>(() => bundle.value?.edges ?? []);
const gamesById = computed(() => {
  const map = new Map<string, StationGame>();
  for (const g of bundle.value?.games ?? []) map.set(g.stationId, g);
  return map;
});

function stationGame(i: number): StationGame | null {
  const s = stations.value[i];
  return s ? (gamesById.value.get(s.id) ?? null) : null;
}

async function loadCampaign(c: CampaignMeta) {
  if (activeCampaign.value?.id === c.id && bundle.value) return;
  loading.value = true;
  loadError.value = false;
  try {
    const res = await fetch(c.bundle);
    if (!res.ok) throw new Error(`bundle http ${res.status}`);
    const b = (await res.json()) as TreasureBundle;
    if (!Array.isArray(b.stations) || !Array.isArray(b.games)) throw new Error("bundle 结构不完整");
    bundle.value = b;
    activeCampaign.value = c;
    /* 重置本场进度 */
    stationSolved.splice(0, stationSolved.length, ...Array(b.stations.length).fill(false));
    rewards.value = [];
    playerAt.value = 0;
    activeStationIndex.value = null;
    activePhase.value = "intro";
    lastResult.value = null;
    if (route.query.campaign !== c.id) {
      router.replace({ query: { campaign: c.id } });
    }
    if (c.id !== "culture") toast(`已切换主题：${c.name}（演示：仅替换了活动 JSON）`, "success");
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const res = await fetch("/assets/game/campaigns/index.json");
    if (!res.ok) throw new Error(`campaigns http ${res.status}`);
    const meta = (await res.json()) as { default?: string; campaigns: CampaignMeta[] };
    campaigns.value = meta.campaigns ?? [];
    const want = String(route.query.campaign || meta.default || "");
    const target = campaigns.value.find((c) => c.id === want) || campaigns.value[0];
    if (!target) throw new Error("无可用活动");
    await loadCampaign(target);
  } catch {
    loadError.value = true;
    loading.value = false;
  }
});

/* ================= 状态 ================= */
const stationSolved = reactive<boolean[]>([]);
const rewards = ref<string[]>([]);
const playerAt = ref(0);
const moving = ref(false);
const activeStationIndex = ref<number | null>(null);
const activePhase = ref<"intro" | "playing" | "solved">("intro");
const lastResult = ref<GameResult | null>(null);

const solvedCount = computed(() => stationSolved.filter(Boolean).length);
const progressPct = computed(() =>
  stations.value.length ? Math.round((solvedCount.value / stations.value.length) * 100) : 0
);

const activeGame = computed(() =>
  activeStationIndex.value !== null ? stationGame(activeStationIndex.value) : null
);
const activeComponent = computed(() =>
  activeGame.value ? GAME_COMPONENTS[activeGame.value.type] : null
);
const dialogLine = computed(() => {
  if (!activeGame.value) return "";
  if (activePhase.value === "solved") return activeGame.value.solvedMsg;
  if (activePhase.value === "intro") return activeGame.value.intro;
  return activeGame.value.title;
});

function openStation(i: number) {
  if (moving.value) return;
  const g = stationGame(i);
  if (!g) return;
  moving.value = true;
  playerAt.value = i;
  setTimeout(() => (moving.value = false), 650);

  activeStationIndex.value = i;
  lastResult.value = null;
  activePhase.value = stationSolved[i] ? "solved" : "intro";
}

function startGame() {
  activePhase.value = "playing";
}

function onSolved(result: GameResult) {
  const i = activeStationIndex.value;
  if (i === null) return;
  if (!stationSolved[i]) {
    stationSolved[i] = true;
    rewards.value.push(activeGame.value?.reward || result.reward);
    toast(`解锁彩蛋：${result.reward}`, "success");
  }
  lastResult.value = result;
  activePhase.value = "solved";
}

function closeModal() {
  activeStationIndex.value = null;
  activePhase.value = "intro";
  lastResult.value = null;
}

/** 人物 sprite：统一走 lib/npc 的规则表（含未落盘素材回落兜底） */
function npcSprite(name: string) {
  return npcSpriteUrl(name);
}

const gameProps = computed(() => {
  const g = activeGame.value;
  if (!g) return {};
  const base = {
    reward: g.reward,
    related_culture_id: g.related_culture_id,
  };
  switch (g.type) {
    case "quiz":
      return { ...base, questions: g.data.questions };
    case "jigsaw":
      return { ...base, image: g.data.image, rows: g.data.rows, cols: g.data.cols };
    case "memory":
      return { ...base, pairs: g.data.pairs };
    case "maze":
      return { ...base, grid: g.data.grid };
    case "poem":
      return { ...base, lines: g.data.lines, title: g.data.title };
    case "link":
      return { ...base, pairs: g.data.pairs };
    case "hidden":
      return { ...base, image: g.data.image, items: g.data.items };
    case "cloze":
      return { ...base, sentence: g.data.sentence, answers: g.data.answers, options: g.data.options };
    default:
      return base;
  }
});
</script>

<template>
  <div class="trs page page-wide">
    <div class="trs__head">
      <div>
        <h1 class="trs__title font-serif-sc">{{ activeCampaign?.name || "永嘉文化寻宝" }}</h1>
        <p class="trs__sub">{{ bundle?.description || "" }}</p>
      </div>
      <div v-if="stations.length" class="trs__progress">
        <span class="trs__progressnum">{{ solvedCount }} / {{ stations.length }}</span>
        <div class="trs__bar"><i :style="{ width: progressPct + '%' }"></i></div>
      </div>
    </div>

    <!-- 主题场次：对应运营侧的 campaign bundle -->
    <div v-if="campaigns.length" class="trs__campaigns">
      <span class="trs__campaigns-title"><img class="trs__ic" src="/assets/icons/quest.svg" alt="" />主题场次</span>
      <button
        v-for="c in campaigns"
        :key="c.id"
        class="trs__campaign"
        :class="{ 'trs__campaign--on': activeCampaign?.id === c.id }"
        :disabled="loading"
        @click="loadCampaign(c)"
      >
        <span class="trs__campaign-emoji">{{ c.emoji }}</span>
        <span class="trs__campaign-body">
          <b>{{ c.name }}</b>
          <em>{{ c.tag }}</em>
        </span>
      </button>
      <span class="trs__campaign-hint">运营侧换一套活动 JSON 即开新主题（演示）</span>
    </div>

    <div v-if="loadError" class="trs__loaderr">
      寻宝活动数据未就绪，请确认 assets/game/campaigns/*.json 已同步。
    </div>
    <div v-else-if="loading" class="trs__loaderr">
      <span class="yj-spinner" style="width: 16px; height: 16px; vertical-align: -3px"></span>
      &nbsp;正在点亮花灯…
    </div>

    <template v-else-if="bundle && stations.length">
      <!-- 地图 -->
      <div class="trs__mapwrap">
        <div class="trs__map">
          <img
            :src="bundle.mapImage"
            alt=""
            class="trs__mapimg"
          />
          <div class="trs__mapveil"></div>

          <!-- 路线 -->
          <svg class="trs__edges">
            <line
              v-for="(e, i) in edges"
              :key="i"
              :x1="stations[e[0]].x"
              :y1="stations[e[0]].y"
              :x2="stations[e[1]].x"
              :y2="stations[e[1]].y"
            />
          </svg>

          <!-- 站点 -->
          <button
            v-for="(s, i) in stations"
            :key="s.id"
            class="trs__node"
            :class="{ 'trs__node--here': playerAt === i, 'trs__node--done': stationSolved[i] }"
            :style="{ left: s.x + '%', top: s.y + '%' }"
            :title="s.name"
            @click="openStation(i)"
          >
            <span class="trs__nodepin">
              <img v-if="stationSolved[i]" class="trs__nodepin-check" src="/assets/icons/check-circle.svg" alt="" />
              <template v-else>{{ s.emoji }}</template>
            </span>
            <span class="trs__nodename">{{ s.name }}</span>
          </button>

          <!-- 玩家 -->
          <div
            class="trs__player"
            :style="{ left: stations[playerAt].x + '%', top: stations[playerAt].y + '%' }"
          >
            <SpriteSheet
              src="/assets/game/sprite-player.png"
              :frame-width="32"
              :frame-height="32"
              :total-frames="8"
              :start-frame="moving ? 2 : 0"
              :frame-count="moving ? 4 : 2"
              :fps="moving ? 6 : 2"
              :scale="1.5"
              alt="玩家"
            />
            <span class="trs__player-dot"></span>
          </div>

          <div class="trs__maptip">{{ bundle.mapTip }}</div>
        </div>

        <div class="trs__stations">
          <div class="trs__stations-title"><img class="trs__ic" src="/assets/icons/location-pin.svg" alt="" />驿站一览</div>
          <div class="trs__stationlist">
            <button
              v-for="(s, i) in stations"
              :key="s.id"
              class="trs__station"
              :class="{ 'trs__station--done': stationSolved[i], 'trs__station--on': playerAt === i }"
              @click="openStation(i)"
            >
              <span class="trs__station-mark">
                <img v-if="stationSolved[i]" class="trs__station-mark-check" src="/assets/icons/check-circle.svg" alt="" />
                <template v-else>{{ s.emoji }}</template>
              </span>
              <div class="trs__stationbody">
                <b>{{ s.name }}</b>
                <small>{{ stationGame(i)?.title || "加载中…" }}</small>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- 彩蛋背包 -->
      <div class="trs__bag">
        <span class="trs__bagtitle"><img class="trs__ic" src="/assets/icons/treasure-chest.svg" alt="" />彩蛋背包</span>
        <template v-if="rewards.length">
          <span v-for="(r, i) in rewards" :key="i" class="yj-tag yj-tag--accent">{{ r }}</span>
        </template>
        <span v-else class="trs__bagempty">尚未获得彩蛋——去驿站挑战吧</span>
      </div>

      <!-- 游戏浮层 -->
      <Transition name="quiz">
        <div
          v-if="activeStationIndex !== null && activeGame"
          class="quiz-mask"
          @click.self="closeModal"
        >
          <div class="quiz">
            <div class="quiz__left">
              <SpriteSheet
                class="quiz__npcimg"
                :src="npcSprite(activeGame.npc)"
                :frame-width="32"
                :frame-height="32"
                :total-frames="2"
                :frame-count="2"
                :fps="2"
                :scale="3"
                :alt="activeGame.npc"
              />
              <b class="quiz__npcname">{{ activeGame.npc }}</b>
              <span class="quiz__place">{{ activeGame.locationDetail }}</span>
            </div>
            <div class="quiz__right">
              <div class="quiz__balloon">{{ dialogLine }}</div>

              <!-- 介绍页 -->
              <div v-if="activePhase === 'intro'" class="game-intro">
                <h3 class="game-intro__title">{{ activeGame.title }}</h3>
                <p class="game-intro__desc">通关奖励：{{ activeGame.reward }}</p>
                <button class="yj-btn yj-btn--primary" @click="startGame">开始挑战</button>
              </div>

              <!-- 游戏本体 -->
              <component
                :is="activeComponent"
                v-else-if="activePhase === 'playing'"
                v-bind="gameProps"
                @solved="onSolved"
              />

              <!-- 完成页 -->
              <div v-else class="game-result">
                <div class="game-result__icon"><img src="/assets/icons/treasure-chest.svg" alt="" /></div>
                <div class="game-result__title">挑战成功</div>
                <div class="game-result__reward">获得彩蛋：{{ activeGame.reward }}</div>
                <p v-if="lastResult?.explanation" class="game-result__explain">
                  {{ lastResult.explanation }}
                </p>
                <button class="yj-btn yj-btn--primary" @click="closeModal">继续探索</button>
              </div>
            </div>
            <button class="quiz__x" @click="closeModal">✕</button>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.trs {
  padding-top: 24px;
}
.trs__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.trs__title {
  margin: 0;
  font-size: 26px;
}
.trs__sub {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 6px 0 0;
}
.trs__progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.trs__progressnum {
  font-family: "JetBrains Mono", monospace;
  font-size: 14px;
  color: var(--accent);
}
.trs__bar {
  width: 160px;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  overflow: hidden;
}
.trs__bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--accent));
  border-radius: 3px;
  transition: width 0.4s ease;
}
.trs__loaderr {
  text-align: center;
  color: var(--text-dim);
  padding: 60px 0;
}

/* 主题场次切换 */
/* AR 游戏图标集（assets/icons/*.svg）接入：标题行内图标，替代装饰性 emoji */
.trs__campaigns-title,
.trs__stations-title,
.trs__bagtitle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.trs__ic {
  width: 15px;
  height: 15px;
  flex: none;
}
.trs__campaigns {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 9px 14px;
}
.trs__campaigns-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-right: 2px;
}
.trs__campaign {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 13px 5px 7px;
  color: var(--text-primary);
  transition: all 0.16s ease;
}
.trs__campaign:hover:not(:disabled) {
  border-color: rgba(62, 198, 184, 0.5);
}
.trs__campaign:disabled {
  opacity: 0.6;
  cursor: default;
}
.trs__campaign--on {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px rgba(62, 198, 184, 0.4), var(--glow-primary);
}
.trs__campaign-emoji {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(62, 198, 184, 0.14);
  font-size: 13px;
}
.trs__campaign-body {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.trs__campaign-body b {
  font-size: 13.5px;
}
.trs__campaign-body em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-dim);
}
.trs__campaign-hint {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--text-dim);
  border: 1px dashed rgba(62, 198, 184, 0.35);
  border-radius: 999px;
  padding: 4px 11px;
}

/* 地图 */
.trs__mapwrap {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 14px;
  align-items: stretch;
}
.trs__map {
  position: relative;
  aspect-ratio: 1440 / 540;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: #0f1c30;
  min-height: 300px;
}
.trs__mapimg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.trs__mapveil {
  position: absolute;
  inset: 0;
  background: linear-gradient(200deg, rgba(10, 18, 32, 0.32), rgba(10, 18, 32, 0.72));
  pointer-events: none;
}
.trs__edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.trs__edges line {
  stroke: rgba(62, 198, 184, 0.35);
  stroke-width: 1.4;
  stroke-dasharray: 4 5;
}
.trs__node {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: transparent;
  border: none;
  cursor: pointer;
  z-index: 3;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.45));
}
.trs__nodepin {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 19px;
  background: rgba(16, 28, 48, 0.9);
  border: 2px solid rgba(62, 198, 184, 0.75);
  box-shadow: 0 0 14px rgba(62, 198, 184, 0.35);
  transition: all 0.18s ease;
}
.trs__nodepin img {
  width: 20px;
  height: 20px;
}
.trs__node:hover .trs__nodepin {
  transform: scale(1.14);
  box-shadow: 0 0 20px rgba(62, 198, 184, 0.7);
}
.trs__node--here .trs__nodepin {
  border-color: var(--accent);
  box-shadow: 0 0 18px rgba(232, 184, 75, 0.6);
}
.trs__node--done .trs__nodepin {
  background: rgba(22, 60, 40, 0.9);
  border-color: var(--success);
}
.trs__nodename {
  font-size: 11px;
  color: var(--text-primary);
  background: rgba(10, 18, 32, 0.75);
  padding: 1px 8px;
  border-radius: 999px;
  white-space: nowrap;
  backdrop-filter: blur(3px);
}
.trs__player {
  position: absolute;
  z-index: 4;
  transform: translate(-50%, -88%);
  transition: left 0.65s cubic-bezier(0.3, 0.8, 0.3, 1), top 0.65s cubic-bezier(0.3, 0.8, 0.3, 1);
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.trs__player-dot {
  width: 10px;
  height: 3px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  margin-top: 2px;
}
.trs__maptip {
  position: absolute;
  left: 12px;
  bottom: 10px;
  z-index: 3;
  font-size: 11.5px;
  color: rgba(234, 242, 251, 0.72);
  background: rgba(10, 18, 32, 0.62);
  padding: 5px 12px;
  border-radius: 999px;
  backdrop-filter: blur(3px);
}

/* 站点列表 */
.trs__stations {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  overflow: hidden;
}
.trs__stations-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}
.trs__stationlist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  padding-right: 4px;
}
.trs__station {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 7px 10px;
  color: var(--text-primary);
  transition: all 0.16s ease;
}
.trs__station:hover {
  border-color: rgba(62, 198, 184, 0.45);
}
.trs__station--on {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px rgba(62, 198, 184, 0.3);
}
.trs__station--done {
  opacity: 0.75;
}
.trs__station--done > span {
  color: var(--success);
}
.trs__station-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
}
.trs__station-mark img {
  width: 17px;
  height: 17px;
}
.trs__stationbody {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.trs__stationbody b {
  font-size: 13.5px;
}
.trs__stationbody small {
  font-size: 11px;
  color: var(--text-dim);
}

/* 彩蛋背包 */
.trs__bag {
  margin-top: 14px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.trs__bagtitle {
  font-size: 13px;
  font-weight: 700;
  margin-right: 4px;
}
.trs__bagempty {
  font-size: 12.5px;
  color: var(--text-dim);
}

/* 游戏浮层 */
.quiz-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(6, 10, 18, 0.66);
  backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 18px;
}
.quiz {
  position: relative;
  width: min(760px, 100%);
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 18px;
  background: linear-gradient(160deg, #16263f, #101c30);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}
.quiz__left {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  padding-top: 6px;
}
.quiz__npcimg {
  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.5));
}
.quiz__npcname {
  font-size: 15px;
  font-family: "Noto Serif SC", serif;
}
.quiz__place {
  font-size: 11px;
  color: var(--text-dim);
}
.quiz__right {
  min-width: 0;
}
.quiz__balloon {
  position: relative;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px 12px 12px 4px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
  min-height: 48px;
  margin-bottom: 14px;
}
.game-intro,
.game-result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.game-intro__title {
  margin: 0;
  font-size: 18px;
}
.game-intro__desc {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.game-result__icon {
  font-size: 36px;
}
.game-result__icon img {
  width: 46px;
  height: 46px;
}
.game-result__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--success);
}
.game-result__reward {
  font-size: 15px;
  color: var(--accent);
}
.game-result__explain {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin: 0;
}
.quiz__x {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: rgba(10, 18, 32, 0.5);
  color: var(--text-secondary);
  cursor: pointer;
}
.quiz__x:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.quiz-enter-active,
.quiz-leave-active {
  transition: opacity 0.2s ease;
}
.quiz-enter-active .quiz,
.quiz-leave-active .quiz {
  transition: transform 0.2s ease;
}
.quiz-enter-from,
.quiz-leave-to {
  opacity: 0;
}
.quiz-enter-from .quiz,
.quiz-leave-to .quiz {
  transform: translateY(14px);
}

@media (max-width: 960px) {
  .trs__mapwrap {
    grid-template-columns: 1fr;
  }
  .quiz {
    grid-template-columns: 1fr;
  }
  .quiz__left {
    flex-direction: row;
    justify-content: flex-start;
    padding: 0;
  }
  .trs__campaign-hint {
    margin-left: 0;
    width: 100%;
    text-align: center;
  }
}
</style>
