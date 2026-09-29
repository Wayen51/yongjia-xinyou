<script setup lang="ts">
/**
 * 行程面板主体：桌面端右侧栏（.agent__side）与窄屏行程抽屉（G-06）共用。
 * - 有 diff 时：先渲染变更卡，再渲染「基础行程（原方案）」用于对比；
 * - 无 diff 有 plan 时：只渲染行程；
 * - 都没有时：渲染空态。空态文案由父级按断点传入（桌面指向左侧快捷指令，窄屏指向底部输入框）。
 *
 * 另含预订凭证入口（FR-AGT-08）：把当前行程转成一张带流水号的**模拟**凭证。
 */
import { ref } from "vue";
import type { BookingVoucher, DemoPlan, PlanDiffPayload } from "@/types/api";
import ItineraryPlan from "@/components/agent/ItineraryPlan.vue";
import PlanDiff from "@/components/agent/PlanDiff.vue";
import VoucherCard from "@/components/agent/VoucherCard.vue";
import { api } from "@/api/client";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/lib/toast";

const props = defineProps<{
  plan: DemoPlan | null;
  diff: PlanDiffPayload | null;
  emptyHint?: string;
}>();

const session = useSessionStore();
/** 本次会话已发出的凭证，新的在前 */
const vouchers = ref<BookingVoucher[]>([]);
const issuing = ref(false);

/**
 * 生成模拟预订凭证。
 *
 * 刻意**不自动发**：凭证是"用户确认行程后"的动作，
 * 每轮对话都甩一张会变成噪音，凭证号也就失去"一张单据一个号"的意义。
 * 点一次发一张，按日续号；已发的留在下方可对比。
 */
async function issue() {
  if (!props.plan || issuing.value) return;
  issuing.value = true;
  try {
    const r = await api.issueVoucher({ sessionId: session.sessionId, itinerary: props.plan });
    vouchers.value.unshift(r.voucher);
    toast(`已开凭证 ${r.voucher.voucher_no}（演示模拟）`, "success");
  } catch (e) {
    toast((e as Error).message || "凭证生成失败", "error");
  } finally {
    issuing.value = false;
  }
}
</script>

<template>
  <template v-if="diff">
    <PlanDiff :diff="diff" />
    <div v-if="plan" class="side__divider">基础行程（原方案）</div>
    <ItineraryPlan v-if="plan" :plan="plan" />
  </template>
  <ItineraryPlan v-else-if="plan" :plan="plan" />

  <div v-if="plan" class="side__voucher">
    <div class="side__voucher-head">
      <span>预订</span>
      <span class="side__voucher-tag">演示模拟</span>
    </div>
    <button class="yj-btn yj-btn--primary yj-btn--sm" :disabled="issuing" @click="issue">
      {{ issuing ? "生成中…" : "生成预订凭证" }}
    </button>
    <p class="side__voucher-note">
      把当前行程转成一张带流水号的模拟凭证，不产生真实预订与扣款。
    </p>
  </div>

  <VoucherCard v-for="v in vouchers" :key="v.voucher_no" :voucher="v" class="side__voucher-card" />

  <div v-if="!diff && !plan" class="side__empty">
    <div class="side__empty-ic">🗺</div>
    <p>行程会显示在这里。</p>
    <p class="side__empty-sub">
      {{ emptyHint || "试试左侧快捷指令「周末亲子两日游」，或直接告诉楠楠你的计划。" }}
    </p>
  </div>
</template>

<style scoped>
.side__divider {
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 0.1em;
  margin: 6px 0 0;
}
.side__voucher {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border, rgba(62, 198, 184, 0.22));
}
.side__voucher-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--text-dim);
}
.side__voucher-tag {
  font-size: 10.5px;
  letter-spacing: 0;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px dashed rgba(233, 155, 63, 0.6);
  color: #e99b3f;
}
.side__voucher-note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-dim);
}
.side__voucher-card {
  margin-top: 12px;
}
.side__empty {
  margin: auto;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
  padding: 20px;
}
.side__empty-ic {
  font-size: 34px;
  margin-bottom: 10px;
  opacity: 0.8;
}
.side__empty p {
  margin: 0 0 6px;
}
.side__empty-sub {
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.7;
}
</style>
