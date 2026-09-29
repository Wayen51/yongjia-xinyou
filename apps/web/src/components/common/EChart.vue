<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
// 按需引入（tree-shaking）：本工程实际只用到 line / bar / funnel 三类图，
// 以及 grid / tooltip / legend 三个组件。原先是 `import * as echarts from "echarts"`，
// 会把 map / heatmap / graph / dataZoom / toolbox 等全部图表与组件（约 1MB）都打进
// DashboardView 的分包，而其中绝大部分从未被使用。
// ⚠️ 后续新增图表类型或组件时，必须同步在下面 use([...]) 里登记，
//    否则运行时静默不渲染（ECharts 不会报错，只是图不出来）。
import { init, use, type ECharts, type EChartsCoreOption } from "echarts/core";
import { BarChart, FunnelChart, LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

use([
  LineChart, // 30 天增长趋势 / 视频周产 / 伴侣会话与满意度
  BarChart, // 客源城市 / 景点热度 / 内容效果 / 券发放核销 / AR 完成率
  FunnelChart, // 消费转化漏斗
  GridComponent, // 直角坐标系（xAxis / yAxis）
  TooltipComponent, // 悬浮提示
  AxisPointerComponent, // tooltip trigger:"axis" 的轴指示器（axisPointer: "shadow"）
  LegendComponent, // 多系列图例
  CanvasRenderer, // 全站图表统一走 Canvas 渲染（未使用 SVG 渲染器）
]);

const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption;
    height?: string;
    autoresize?: boolean;
  }>(),
  { height: "260px", autoresize: true },
);

const el = ref<HTMLDivElement | null>(null);
const chart = shallowRef<ECharts | null>(null);
let ro: ResizeObserver | null = null;

onMounted(() => {
  if (!el.value) return;
  const c = init(el.value);
  chart.value = c;
  c.setOption(props.option);
  if (props.autoresize && typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => c.resize());
    ro.observe(el.value);
  }
});

watch(
  () => props.option,
  (o) => {
    chart.value?.setOption(o, { notMerge: true });
  },
  { deep: true },
);

onBeforeUnmount(() => {
  ro?.disconnect();
  chart.value?.dispose();
});
</script>

<template>
  <div ref="el" class="echart" :style="{ height }"></div>
</template>

<style scoped>
.echart {
  width: 100%;
}
</style>
