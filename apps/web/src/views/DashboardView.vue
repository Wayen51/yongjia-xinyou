<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "@/api/client";
import type { DemoDashboard, DemoInsight } from "@/types/api";
import EChart from "@/components/common/EChart.vue";
import type { EChartsOption } from "echarts";

const dash = ref<DemoDashboard | null>(null);
const loading = ref(true);
const spotlight = ref<DemoInsight | null>(null);
const latestDate = ref<string | null>(null);
const regenerating = ref(false);

const C_PRIMARY = "#3ec6b8";
const C_GOLD = "#e8b84b";
const C_TEXT = "#9fb0c7";
const C_DIM = "#64748f";
const C_GRID = "#23364f";

const AXIS = {
  axisLine: { lineStyle: { color: C_GRID } },
  axisLabel: { color: C_DIM, fontSize: 11 },
  splitLine: { lineStyle: { color: C_GRID, opacity: 0.55 } },
};
const TOOLTIP = {
  backgroundColor: "#16263f",
  borderColor: "#23364f",
  textStyle: { color: "#eaf2fb", fontSize: 12 },
};

const CAT_CN: Record<string, string> = {
  video: "板块一 · 视频",
  ar: "板块二 · AR",
  coupon: "板块二 · 券核销",
  companion: "板块三 · 伴侣",
  overview: "全局运营",
};

async function loadInsight() {
  try {
    const ins = await api.dashboardInsight();
    spotlight.value = ins?.insight ?? null;
    latestDate.value = ins?.latestDate ?? null;
  } catch {
    /* 保留上一次结论 */
  }
}

async function regenerate() {
  if (regenerating.value) return;
  regenerating.value = true;
  await loadInsight();
  await new Promise((r) => setTimeout(r, 480)); // 最小动效时长，模拟一轮重新归因
  regenerating.value = false;
}

onMounted(async () => {
  try {
    dash.value = await api.dashboardOverview();
  } catch {
    dash.value = null;
  } finally {
    loading.value = false;
  }
  loadInsight();
});

const num = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n));
const kpiCards = computed(() => {
  if (!dash.value) return [];
  const k = dash.value.kpi;
  return [
    { label: "内容曝光", value: num(k.total_exposure), note: `日均 ${num(k.avg_daily_exposure)}` },
    { label: "AI 伴游用户", value: num(k.total_visitors), note: "启用 Agent 的新游客" },
    { label: "行程规划次数", value: num(k.total_plannings), note: "由 AI 生成的行程" },
    { label: "带动 GMV", value: `¥${num(k.total_gmv)}`, note: `客单 ¥${k.avg_order_value}` },
    { label: "内容→消费转化", value: `${(k.conversion_rate * 100).toFixed(1)}%`, note: "全链路漏斗底部" },
  ];
});

/* 板块一 · 平台 AI 生产侧（视频工坊实时统计，来自 video_projects 表） */
const STYLE_CN: Record<string, string> = {
  documentary: "纪实纪录片",
  ancient: "古风",
  vlog: "旅行 Vlog",
  aerial: "航拍",
  creative: "宣传片",
};
const videoStats = computed(() => dash.value?.video_stats ?? null);
const videoStyleRows = computed(() =>
  (videoStats.value?.by_style ?? []).map((s) => ({ ...s, cn: STYLE_CN[s.style] || s.style })),
);
const videoStylePct = (count: number) =>
  videoStats.value?.total ? Math.max(6, Math.round((count / videoStats.value.total) * 100)) : 0;

const trendOption = computed<EChartsOption>(() => {
  const d = dash.value?.daily_data ?? [];
  return {
    tooltip: { ...TOOLTIP, trigger: "axis" },
    legend: { data: ["内容曝光", "带动 GMV"], textStyle: { color: C_TEXT, fontSize: 12 }, top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 34, bottom: 0, containLabel: true },
    xAxis: { type: "category", data: d.map((x) => x.date.slice(5)), ...AXIS },
    yAxis: [
      { type: "value", name: "曝光", nameTextStyle: { color: C_DIM }, ...AXIS, axisLabel: { color: C_DIM, fontSize: 10, formatter: (v: number) => num(v) } },
      { type: "value", name: "GMV", nameTextStyle: { color: C_DIM }, splitLine: { show: false }, axisLabel: { color: C_DIM, fontSize: 10, formatter: (v: number) => `¥${num(v)}` } },
    ],
    series: [
      {
        name: "内容曝光",
        type: "line",
        smooth: true,
        symbol: "none",
        data: d.map((x) => x.exposure),
        lineStyle: { width: 2, color: C_PRIMARY },
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(62,198,184,0.28)" }, { offset: 1, color: "rgba(62,198,184,0)" }] } },
      },
      { name: "带动 GMV", type: "line", smooth: true, symbol: "none", yAxisIndex: 1, data: d.map((x) => x.gmv), lineStyle: { width: 2, color: C_GOLD }, itemStyle: { color: C_GOLD } },
    ],
  };
});

const funnelOption = computed<EChartsOption>(() => {
  const f = dash.value?.conversion_funnel ?? [];
  return {
    tooltip: TOOLTIP,
    series: [
      {
        type: "funnel",
        left: 0,
        right: 0,
        top: 8,
        bottom: 8,
        width: "100%",
        sort: "descending",
        gap: 2,
        label: { color: "#ffffff", fontSize: 11, fontWeight: 700, formatter: (p: { name: string }) => p.name },
        labelLine: { show: false },
        itemStyle: { borderWidth: 0 },
        color: ["#3ec6b8", "#54cf9d", "#e8b84b", "#e29a55", "#e07a5f"],
        data: f.map((x) => ({ name: x.stage, value: x.value })),
      },
    ],
  };
});

const citiesOption = computed<EChartsOption>(() => {
  const c = dash.value?.source_cities_top10 ?? [];
  return {
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 8, top: 6, bottom: 0, containLabel: true },
    xAxis: { type: "value", ...AXIS, splitLine: { lineStyle: { color: C_GRID, opacity: 0.5 } }, axisLabel: { color: C_DIM, fontSize: 10 } },
    yAxis: { type: "category", data: c.map((x) => x.city), ...AXIS, splitLine: { show: false }, axisLabel: { color: C_TEXT, fontSize: 11 } },
    series: [
      {
        type: "bar",
        data: c.map((x) => x.visitors),
        barWidth: 11,
        itemStyle: { borderRadius: 6, color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "rgba(62,198,184,0.25)" }, { offset: 1, color: C_PRIMARY }] } },
        label: { show: true, position: "right", color: C_DIM, fontSize: 10, formatter: (p: { value: number }) => num(p.value) },
      },
    ],
  } as EChartsOption;
});

const contentOption = computed<EChartsOption>(() => {
  const c = dash.value?.content_effect ?? [];
  return {
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: unknown) => {
      const arr = ps as Array<{ name: string; dataIndex: number; value: number }>;
      const it = c[arr[0]?.dataIndex];
      if (!it) return "";
      return `${it.type}<br/>曝光 ${num(it.exposure)} · 点击 ${num(it.clicks)}<br/>转化率 <b>${it.conversion_rate}%</b>`;
    } },
    grid: { left: 8, right: 8, top: 6, bottom: 0, containLabel: true },
    xAxis: { type: "value", max: 6, ...AXIS, axisLabel: { color: C_DIM, fontSize: 10, formatter: "{value}%" } },
    yAxis: { type: "category", data: c.map((x) => x.type), ...AXIS, splitLine: { show: false }, axisLabel: { color: C_TEXT, fontSize: 11 } },
    series: [
      {
        type: "bar",
        data: c.map((x) => x.conversion_rate),
        barWidth: 11,
        itemStyle: { borderRadius: 6, color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "rgba(232,184,75,0.2)" }, { offset: 1, color: C_GOLD }] } },
        label: { show: true, position: "right", color: C_DIM, fontSize: 10, formatter: "{c}%" },
      },
    ],
  };
});

const heatOption = computed<EChartsOption>(() => {
  const h = dash.value?.scenic_heat ?? [];
  return {
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 8, top: 6, bottom: 0, containLabel: true },
    xAxis: { type: "value", ...AXIS, axisLabel: { color: C_DIM, fontSize: 10, formatter: (v: number) => num(v) } },
    yAxis: { type: "category", data: h.map((x) => x.name), ...AXIS, splitLine: { show: false }, axisLabel: { color: C_TEXT, fontSize: 11 } },
    series: [
      {
        type: "bar",
        data: h.map((x) => x.visitors),
        barWidth: 11,
        itemStyle: { borderRadius: 6, color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "rgba(124,143,245,0.2)" }, { offset: 1, color: "#7c8ff5" }] } },
        label: { show: true, position: "right", color: C_DIM, fontSize: 10, formatter: (p: { value: number }) => num(p.value) },
      },
    ],
  } as EChartsOption;
});

const insights = computed(() => dash.value?.ai_insights ?? []);

/* ---------- 平台运营口径 · 三板块（seed v2.0-platform-extended，B 端视角） ---------- */
const vm = computed(() => dash.value?.video_metrics ?? null);
const am = computed(() => dash.value?.ar_metrics ?? null);
const cm = computed(() => dash.value?.coupon_metrics ?? null);
const xm = computed(() => dash.value?.companion_metrics ?? null);

const platformKpiCards = computed(() => {
  const k = dash.value?.platform_kpi;
  if (!k) return [];
  return [
    { label: "板块一 · 视频产出", value: num(k.video_total), note: `本周新增 ${k.video_this_week} 条 · 分风格占比见下` },
    { label: "板块二 · AR 参与", value: num(k.ar_participants), note: `${k.ar_games_active} 场在办 · 平均完成率 ${Math.round(k.ar_completion_rate * 100)}%` },
    { label: "优惠券核销率", value: `${(k.coupon_redeem_rate * 100).toFixed(1)}%`, note: `已核销 ${num(k.coupons_redeemed)} / 发放 ${num(k.coupons_issued)}` },
    { label: "伴侣会话量", value: num(k.companion_chats), note: `人均 ${k.companion_avg_msg} 轮 · 出行即对话` },
    { label: "三板块带动 GMV", value: `¥${num(k.total_gmv_platform)}`, note: `税收带动估值 ¥${num(k.tax_contribution_est)}` },
  ];
});

const videoOpsOption = computed<EChartsOption>(() => {
  const t = vm.value?.weekly_trend ?? [];
  if (!t.length) return {};
  return {
    tooltip: { ...TOOLTIP, trigger: "axis" },
    legend: { data: ["生成视频", "播放量"], textStyle: { color: C_TEXT, fontSize: 11 }, top: 0 },
    grid: { left: 8, right: 8, top: 30, bottom: 0, containLabel: true },
    xAxis: { type: "category", data: t.map((x) => x.week), ...AXIS },
    yAxis: [
      { type: "value", name: "条数", nameTextStyle: { color: C_DIM }, ...AXIS, axisLabel: { color: C_DIM, fontSize: 10 } },
      { type: "value", name: "播放", nameTextStyle: { color: C_DIM }, splitLine: { show: false }, axisLabel: { color: C_DIM, fontSize: 10, formatter: (v: number) => num(v) } },
    ],
    series: [
      { name: "生成视频", type: "bar", data: t.map((x) => x.videos), barWidth: 10, itemStyle: { borderRadius: 4, color: C_GOLD } },
      { name: "播放量", type: "line", yAxisIndex: 1, smooth: true, symbol: "none", data: t.map((x) => x.views), lineStyle: { width: 2, color: C_PRIMARY } },
    ],
  };
});

const arOpsOption = computed<EChartsOption>(() => {
  const g = am.value?.games_list ?? [];
  if (!g.length) return {};
  return {
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: unknown) => {
      const arr = ps as Array<{ dataIndex: number; value: number }>;
      const it = g[arr[0]?.dataIndex];
      return it ? `${it.name}（${it.festival}）<br/>完成率 ${Math.round(it.completion * 100)}% · 参与 ${num(it.participants)} · ${it.points} 点位` : "";
    } },
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    xAxis: { type: "value", max: 100, ...AXIS, axisLabel: { color: C_DIM, fontSize: 10, formatter: "{value}%" } },
    yAxis: { type: "category", data: g.map((x) => x.name), ...AXIS, splitLine: { show: false }, axisLabel: { color: C_TEXT, fontSize: 11 } },
    series: [{ type: "bar", data: g.map((x) => Math.round(x.completion * 100)), barWidth: 10, itemStyle: { borderRadius: 5, color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "rgba(84,207,157,0.2)" }, { offset: 1, color: "#54cf9d" }] } }, label: { show: true, position: "right", color: C_DIM, fontSize: 10, formatter: "{c}%" } }],
  };
});

const couponOpsOption = computed<EChartsOption>(() => {
  const t = cm.value?.by_type ?? [];
  if (!t.length) return {};
  return {
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: unknown) => {
      const arr = ps as Array<{ seriesName: string; dataIndex: number; value: number }>;
      const it = t[arr[0]?.dataIndex];
      if (!it) return "";
      return `${it.type}<br/>发放 ${num(it.issued)} · 核销 ${num(it.redeemed)}<br/>核销率 <b>${(it.redeem_rate * 100).toFixed(1)}%</b> · 均价 ¥${it.avg_value}`;
    } },
    legend: { data: ["发放", "核销"], textStyle: { color: C_TEXT, fontSize: 11 }, top: 0 },
    grid: { left: 8, right: 8, top: 28, bottom: 0, containLabel: true },
    xAxis: { type: "category", data: t.map((x) => x.type), ...AXIS },
    yAxis: { type: "value", ...AXIS, axisLabel: { color: C_DIM, fontSize: 10, formatter: (v: number) => num(v) } },
    series: [
      { name: "发放", type: "bar", data: t.map((x) => x.issued), barWidth: 9, itemStyle: { borderRadius: 4, color: "#5470c6" } },
      { name: "核销", type: "bar", data: t.map((x) => x.redeemed), barWidth: 9, itemStyle: { borderRadius: 4, color: C_GOLD } },
    ],
  };
});

const xmOpsOption = computed<EChartsOption>(() => {
  const d = xm.value?.daily_chats ?? [];
  if (!d.length) return {};
  return {
    tooltip: { ...TOOLTIP, trigger: "axis" },
    legend: { data: ["会话量", "满意度(5分制)"], textStyle: { color: C_TEXT, fontSize: 11 }, top: 0 },
    grid: { left: 8, right: 8, top: 30, bottom: 0, containLabel: true },
    xAxis: { type: "category", data: d.map((x) => x.date.slice(5)), ...AXIS },
    yAxis: [
      { type: "value", name: "会话", nameTextStyle: { color: C_DIM }, ...AXIS, axisLabel: { color: C_DIM, fontSize: 10, formatter: (v: number) => num(v) } },
      { type: "value", name: "满意分", min: 0, max: 5, nameTextStyle: { color: C_DIM }, splitLine: { show: false }, axisLabel: { color: C_DIM, fontSize: 10, formatter: (v: number) => v.toFixed(1) } },
    ],
    series: [
      { name: "会话量", type: "line", smooth: true, symbol: "none", data: d.map((x) => x.chats), lineStyle: { width: 2, color: C_PRIMARY }, areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(62,198,184,0.25)" }, { offset: 1, color: "rgba(62,198,184,0)" }] } } },
      { name: "满意度(5分制)", type: "line", yAxisIndex: 1, smooth: true, symbol: "none", data: d.map((x) => x.satisfaction), lineStyle: { width: 2, color: C_GOLD }, itemStyle: { color: C_GOLD } },
    ],
  };
});
</script>

<template>
  <div class="dash page page-wide">
    <div class="dash__head">
      <div>
        <h1 class="dash__title font-serif-sc">永嘉文旅 · 运行驾驶舱</h1>
        <p class="dash__sub" v-if="dash?.meta?.period">近 30 天 · 模拟数据 · 统计周期 {{ dash.meta.period }} · 数据经 Agent 归因</p>
      </div>
      <div class="dash__chips">
        <span class="demo-chip">演示数据 · DEMO</span>
        <span v-if="dash?.meta?.generated_at" class="yj-tag">生成于 {{ dash.meta.generated_at }}</span>
      </div>
    </div>

    <div v-if="loading" class="dash__loading">
      <div class="yj-skeleton" style="height: 90px"></div>
      <div class="yj-skeleton" style="height: 300px"></div>
    </div>

    <template v-else-if="dash">
      <!-- KPI（对齐高保真稿 #5：label 上 / 数字 40px 大字 / note 下） -->
      <div class="kpi">
        <div v-for="c in kpiCards" :key="c.label" class="yj-card kpi__card">
          <span class="kpi__label">{{ c.label }}</span>
          <b class="kpi__value">{{ c.value }}</b>
          <span class="kpi__note">{{ c.note }}</span>
        </div>
      </div>

      <!-- 平台 AI 生产侧：视频工坊实时统计 -->
      <div v-if="videoStats" class="vprod yj-card">
        <div class="vprod__head">
          <div>
            <div class="section-title" style="font-size: 16px">平台 AI 生产侧 · 视频工坊</div>
            <p class="section-sub">来自 video_projects 库的实时统计（生成过程为演示模拟）</p>
          </div>
          <RouterLink to="/video" class="yj-btn yj-btn--ghost yj-btn--sm">进入工坊 →</RouterLink>
        </div>
        <div class="vprod__grid">
          <div class="vprod__cell">
            <b>{{ videoStats.total }}</b>
            <span>视频项目总数</span>
          </div>
          <div class="vprod__cell">
            <b style="color: var(--accent)">{{ videoStats.done }}</b>
            <span>已完成模拟成片</span>
          </div>
          <div class="vprod__cell">
            <b>{{ videoStats.generating }}</b>
            <span>正在生成</span>
          </div>
          <div class="vprod__cell">
            <b>{{ Math.round(videoStats.total_duration_sec / 60) }}m</b>
            <span>成片累计时长</span>
          </div>
          <div class="vprod__styles">
            <div v-for="s in videoStyleRows" :key="s.style" class="vprod__style">
              <span class="text-xs text-secondary" style="min-width: 84px">{{ s.cn }}</span>
              <div class="vprod__bar">
                <i :style="{ width: videoStylePct(s.count) + '%' }" />
              </div>
              <span class="font-mono-sc text-xs text-dim" style="min-width: 22px; text-align: right">{{ s.count }}</span>
            </div>
            <span v-if="!videoStyleRows.length" class="text-xs text-dim">暂无分镜记录</span>
          </div>
        </div>
      </div>

      <!-- 平台运营口径 · 三板块（B 端视角，来自 dashboard_demo_data.json v2.0-platform-extended） -->
      <template v-if="platformKpiCards.length">
        <div class="ops">
          <div class="ops__head">
            <div>
              <div class="section-title" style="font-size: 16px">平台运营口径 · 三板块</div>
              <p class="section-sub">板块一 · AIGC 视频产出 ｜ 板块二 · AR 互动与券核销 ｜ 板块三 · 智能伴侣会话（演示数据）</p>
            </div>
            <span class="demo-chip">政务视角</span>
          </div>
          <div class="kpi kpi--ops">
            <div v-for="c in platformKpiCards" :key="c.label" class="yj-card kpi__card">
              <span class="kpi__label">{{ c.label }}</span>
              <b class="kpi__value kpi__value--ops">{{ c.value }}</b>
              <span class="kpi__note">{{ c.note }}</span>
            </div>
          </div>
          <div class="ops__grid">
            <div class="yj-card chart">
              <div class="chart__title">板块一 · 视频周产与播放</div>
              <EChart v-if="videoOpsOption.series" :option="videoOpsOption" height="190px" />
              <p v-else class="chart__empty">暂无视频周报数据</p>
            </div>
            <div class="yj-card chart">
              <div class="chart__title">板块二 · AR 游戏完成率</div>
              <EChart v-if="arOpsOption.series" :option="arOpsOption" height="190px" />
              <p v-else class="chart__empty">暂无 AR 游戏数据</p>
            </div>
            <div class="yj-card chart">
              <div class="chart__title">板块二 · 优惠券发放 / 核销</div>
              <EChart v-if="couponOpsOption.series" :option="couponOpsOption" height="190px" />
              <p v-else class="chart__empty">暂无券数据</p>
            </div>
            <div class="yj-card chart">
              <div class="chart__title">板块三 · 伴侣会话与满意度</div>
              <EChart v-if="xmOpsOption.series" :option="xmOpsOption" height="190px" />
              <p v-else class="chart__empty">暂无会话数据</p>
            </div>
          </div>
          <div class="ops__grid ops__grid--lists">
            <div class="yj-card ops__mini">
              <div class="chart__title">板块一 · 热门成片</div>
              <ul class="ops__list">
                <li v-for="v in (vm?.top_videos ?? []).slice(0, 4)" :key="v.title">
                  <b>{{ v.title }}</b>
                  <span class="ops__muted">{{ v.style }} · 播放 {{ num(v.views) }} · 转化 {{ v.conversion }}%</span>
                </li>
                <li v-if="!(vm?.top_videos ?? []).length" class="ops__muted">暂无</li>
              </ul>
            </div>
            <div class="yj-card ops__mini">
              <div class="chart__title">板块二 · AR 点位热度 TOP</div>
              <ul class="ops__list">
                <li v-for="p in (am?.point_heat ?? []).slice(0, 4)" :key="p.poi">
                  <b>{{ p.poi }}</b>
                  <span class="ops__muted">打卡 {{ num(p.checkins) }} · 均停留 {{ p.avg_time_min }}min</span>
                </li>
                <li v-if="!(am?.point_heat ?? []).length" class="ops__muted">暂无</li>
              </ul>
            </div>
            <div class="yj-card ops__mini">
              <div class="chart__title">板块三 · 热门意图</div>
              <ul class="ops__list">
                <li v-for="t in (xm?.top_intents ?? []).slice(0, 4)" :key="t.intent">
                  <b>{{ t.intent }}</b>
                  <span class="ops__muted">{{ t.pct }}% · {{ num(t.count) }} 次</span>
                </li>
                <li v-if="!(xm?.top_intents ?? []).length" class="ops__muted">暂无</li>
              </ul>
            </div>
            <div class="yj-card ops__mini">
              <div class="chart__title">板块二 · 券核销 TOP 点位</div>
              <ul class="ops__list">
                <li v-for="c in (cm?.top_redeem_poi ?? []).slice(0, 4)" :key="c.poi">
                  <b>{{ c.poi }}</b>
                  <span class="ops__muted">核销 {{ num(c.redeemed) }} · 带动 GMV ¥{{ num(c.gmv) }}</span>
                </li>
                <li v-if="!(cm?.top_redeem_poi ?? []).length" class="ops__muted">暂无</li>
              </ul>
            </div>
          </div>
        </div>
      </template>

      <!-- 图表 -->
      <div class="charts">
        <div class="yj-card chart chart--big">
          <div class="chart__title">30 天增长趋势</div>
          <EChart :option="trendOption" height="280px" />
        </div>
        <div class="yj-card chart">
          <div class="chart__title">消费转化漏斗</div>
          <EChart :option="funnelOption" height="280px" />
        </div>
        <div class="yj-card chart">
          <div class="chart__title">客源城市 Top10</div>
          <EChart :option="citiesOption" height="230px" />
        </div>
        <div class="yj-card chart">
          <div class="chart__title">景点热度</div>
          <EChart :option="heatOption" height="230px" />
        </div>
        <div class="yj-card chart">
          <div class="chart__title">内容类型效果（转化率）</div>
          <EChart :option="contentOption" height="230px" />
        </div>
      </div>

      <!-- Agent 今日分析：结论 → 依据信号 → 建议动作，结论可溯源可复核 -->
      <div class="insight">
        <div v-if="spotlight" class="yj-card insight__spot" :key="spotlight.id">
          <div class="insight__head">
            <div class="insight__who">
              <span class="insight__avatar">🧠</span>
              <div>
                <div class="insight__titleline">
                  <span class="insight__ai">Agent 今日分析</span>
                  <span class="insight__cat">{{ CAT_CN[spotlight.category ?? "overview"] }}</span>
                </div>
                <span class="insight__meta">{{ spotlight.date }} 运营数据 · 每晨自动归因 · 结论可复核</span>
              </div>
            </div>
            <div class="insight__tools">
              <span class="insight__confchip">置信度 {{ Math.round(spotlight.confidence * 100) }}%</span>
              <button
                class="yj-btn yj-btn--ghost yj-btn--sm insight__regen"
                :class="{ 'is-run': regenerating }"
                :disabled="regenerating"
                @click="regenerate"
              >
                ↻ {{ regenerating ? "分析中" : "重新分析" }}
              </button>
            </div>
          </div>

          <div class="insight__conclusion">
            <span class="insight__id">{{ spotlight.id }}</span>
            <p class="insight__title font-serif-sc">{{ spotlight.title }}</p>
            <p class="insight__text">{{ spotlight.insight }}</p>
          </div>

          <div v-if="spotlight.signals?.length" class="insight__section">
            <div class="insight__sectiontitle">依据信号 <span class="insight__sectionnote">（与上方图表同源）</span></div>
            <div class="sig">
              <div v-for="(s, si) in spotlight.signals" :key="si" class="sig__card">
                <span class="sig__dir" :class="`sig__dir--${s.dir ?? 'flat'}`">{{ s.dir === "up" ? "▲" : s.dir === "down" ? "▼" : "◆" }}</span>
                <div class="sig__txt">
                  <b>{{ s.label }}</b>
                  <div class="sig__vals">
                    <strong>{{ s.value }}</strong>
                    <em v-if="s.delta">{{ s.delta }}</em>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="spotlight.actions?.length" class="insight__section">
            <div class="insight__sectiontitle">给运营者的建议动作</div>
            <ul class="insight__acts">
              <li v-for="(a, ai) in spotlight.actions" :key="ai">
                <span class="insight__actno">{{ ai + 1 }}</span>
                <span>{{ a }}</span>
              </li>
            </ul>
          </div>

          <div class="insight__foot">
            <span class="insight__footlabel">归因置信度</span>
            <div class="insight__gauge">
              <i :style="{ width: Math.round(spotlight.confidence * 100) + '%' }" />
            </div>
            <b>{{ Math.round(spotlight.confidence * 100) }}%</b>
            <span class="insight__footnote">基于 {{ latestDate || spotlight.date }} 全量指标 · Agent 决策链可溯源（演示）</span>
          </div>
        </div>

        <div v-if="insights.length" class="insight__list">
          <div class="insight__listtitle">历史分析 · {{ insights.length }} 期</div>
          <button
            v-for="i in insights"
            :key="i.id"
            class="insight__item"
            :class="{ 'is-on': spotlight?.id === i.id }"
            :title="i.insight"
            @click="spotlight = i"
          >
            <span class="insight__itembadge">{{ i.id }}</span>
            <span class="insight__itemdate">{{ i.date }}</span>
            <p>{{ i.title || i.insight }}</p>
          </button>
        </div>
      </div>
    </template>

    <div v-else class="dash__err">看板数据加载失败，请确认服务端 seed 已就绪。</div>
  </div>
</template>

<style scoped>
.dash {
  padding-top: 24px;
}
.dash__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}
.dash__title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
}
.dash__sub {
  color: var(--text-secondary);
  font-size: var(--fs-body-sm);
  margin: 6px 0 0;
}
.dash__chips {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dash__loading {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.kpi {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}
/* StatChip 对齐稿 #5：label 上 / 大字数字 / note 下 */
.kpi__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 16px 18px 14px;
}
/* §9 P3：KPI 数字升 --fs-h1（40px）主色白，可远读可投屏 */
.kpi__value {
  font-size: var(--fs-h1);
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
  line-height: var(--lh-tight);
  white-space: nowrap;
  margin-top: 4px;
}
.kpi__label {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
}
.kpi__note {
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  margin-top: 4px;
}

.vprod {
  margin-top: 14px;
  border-color: rgba(232, 184, 75, 0.35);
  background: linear-gradient(135deg, rgba(232, 184, 75, 0.06), var(--bg-panel) 55%);
}
.vprod__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.vprod__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr)) 1.6fr;
  gap: 12px;
}
.vprod__cell {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-base);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.vprod__cell b {
  font-size: 22px;
  font-family: var(--font-mono);
  color: var(--primary);
}
.vprod__cell span {
  font-size: 12px;
  color: var(--text-dim);
}
.vprod__styles {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  padding: 0 2px;
}
.vprod__style {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vprod__bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  overflow: hidden;
}
.vprod__bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), #f4cd74);
}

.charts {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
}
.chart {
  padding: 14px;
  min-width: 0;
}
.chart--big {
  grid-row: span 2;
}
.chart__title {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 600;
  margin-bottom: 4px;
  letter-spacing: 0.04em;
}

.insight {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 12px;
  align-items: start;
}
.insight__spot {
  padding: 16px;
  background: linear-gradient(135deg, rgba(62, 198, 184, 0.07), var(--bg-panel) 58%);
  border-color: rgba(62, 198, 184, 0.32);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}
.insight__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.insight__who {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.insight__avatar {
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 19px;
  background: rgba(62, 198, 184, 0.12);
  border: 1px solid rgba(62, 198, 184, 0.35);
}
.insight__titleline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.insight__ai {
  font-size: 15px;
  font-weight: 800;
  color: var(--primary);
}
.insight__cat {
  font-size: 10.5px;
  color: var(--primary);
  background: var(--primary-soft);
  border: 1px solid rgba(62, 198, 184, 0.28);
  border-radius: 999px;
  padding: 1px 8px;
}
.insight__meta {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 3px;
}
.insight__tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.insight__confchip {
  font-size: 11.5px;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  background: rgba(10, 18, 32, 0.5);
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}
.insight__confchip b,
.insight__confchip {
  font-weight: 600;
}
.insight__regen.is-run {
  opacity: 0.7;
  pointer-events: none;
}
.insight__conclusion {
  position: relative;
  background: rgba(10, 18, 32, 0.42);
  border: 1px solid rgba(62, 198, 184, 0.18);
  border-radius: 12px;
  padding: 14px 16px 12px;
}
.insight__id {
  position: absolute;
  right: 12px;
  top: 10px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
}
.insight__title {
  margin: 0 0 6px;
  padding-right: 56px;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.45;
  color: #eaf2fb;
}
.insight__text {
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--text-secondary);
  margin: 0;
}
.insight__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.insight__sectiontitle {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}
.insight__sectionnote {
  color: var(--text-dim);
  font-weight: 400;
  font-size: 10.5px;
}
.sig {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}
.sig__card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 10px;
  background: rgba(22, 38, 63, 0.55);
  border: 1px solid var(--border);
}
.sig__dir {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 9px;
}
.sig__dir--up {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.12);
}
.sig__dir--down {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}
.sig__dir--flat {
  color: var(--text-secondary);
  background: rgba(159, 176, 199, 0.12);
}
.sig__txt {
  min-width: 0;
}
.sig__txt b {
  display: block;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sig__vals {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.sig__vals strong {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text-primary);
}
.sig__vals em {
  font-style: normal;
  font-size: 10px;
  color: var(--primary);
}
.insight__acts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.insight__acts li {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-primary);
}
.insight__actno {
  flex: none;
  width: 17px;
  height: 17px;
  margin-top: 1px;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  color: #0a1220;
  background: var(--accent);
  border-radius: 50%;
}
.insight__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.insight__footlabel {
  font-size: 11px;
  color: var(--text-dim);
}
.insight__gauge {
  flex: 1;
  max-width: 130px;
  height: 5px;
  border-radius: 999px;
  background: rgba(159, 176, 199, 0.18);
  overflow: hidden;
}
.insight__gauge i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary), #54cf9d);
}
.insight__foot > b {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
}
.insight__footnote {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-dim);
  text-align: right;
}
.insight__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: sticky;
  top: 78px;
}
.insight__listtitle {
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 0.1em;
}
.insight__item {
  appearance: none;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 8px;
  align-items: start;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
  font: inherit;
}
.insight__item:hover {
  border-color: rgba(62, 198, 184, 0.45);
}
.insight__item.is-on {
  border-color: rgba(62, 198, 184, 0.6);
  background: rgba(62, 198, 184, 0.07);
}
.insight__item p {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.insight__itembadge {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--primary);
  background: var(--primary-soft);
  border-radius: 5px;
  padding: 2px 6px;
}
.insight__itemdate {
  font-size: 11px;
  color: var(--text-dim);
  padding-top: 2px;
}
.dash__err {
  text-align: center;
  color: var(--text-dim);
  padding: 60px 0;
}

/* ---------- 平台运营口径 · 三板块 ---------- */
.ops {
  margin-top: 18px;
}
.ops__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.kpi--ops {
  grid-template-columns: repeat(auto-fit, minmax(176px, 1fr));
  gap: 14px;
}
.kpi__value--ops {
  font-size: 26px;
  margin-top: 2px;
}
.ops__grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}
.ops__grid--lists {
  align-items: start;
}
.ops__mini {
  padding: 14px 16px;
}
.ops__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.ops__list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
}
.ops__list b {
  color: var(--text-primary);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ops__muted {
  color: var(--text-dim);
  font-size: 11.5px;
  white-space: nowrap;
  flex: none;
}
.chart__empty {
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
  padding: 56px 0;
  margin: 0;
}

@media (max-width: 900px) {
  .charts,
  .insight {
    grid-template-columns: 1fr;
  }
}
</style>
