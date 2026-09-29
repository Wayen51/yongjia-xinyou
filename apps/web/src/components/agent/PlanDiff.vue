<script setup lang="ts">
import type { PlanDiffPayload } from "@/types/api";

defineProps<{ diff: PlanDiffPayload }>();
</script>

<template>
  <div class="diff">
    <div class="diff__banner">
      <span class="diff__banner-ic">⚡</span>
      <span>{{ diff.banner || "已为您重新规划行程" }}</span>
    </div>

    <div v-if="diff.change_summary" class="diff__summary">{{ diff.change_summary }}</div>

    <!-- 移除 -->
    <div v-if="diff.removed?.length" class="diff__group">
      <div class="diff__grouptitle diff__grouptitle--rm">✕ 移除（户外受影响）</div>
      <div v-for="r in diff.removed" :key="r.id" class="diff__row diff__row--rm">
        <span class="diff__name">{{ r.name }}</span>
        <span class="diff__reason">{{ r.reason }}</span>
      </div>
    </div>

    <!-- 新增 -->
    <div v-if="diff.added?.length" class="diff__group">
      <div class="diff__grouptitle diff__grouptitle--add">＋ 新增（室内替代）</div>
      <div v-for="a in diff.added" :key="a.id" class="diff__row diff__row--add">
        <div class="diff__addmain">
          <span class="diff__name">{{ a.name }}</span>
          <span v-if="a.indoor" class="yj-tag yj-tag--indoor">☂ 室内</span>
          <span v-if="a.start" class="diff__time">{{ a.start }}{{ a.end ? `-${a.end}` : "" }}</span>
        </div>
        <span v-if="a.cost_cny != null" class="diff__cost">{{ a.cost_cny === 0 ? "免费" : `¥${a.cost_cny}` }}</span>
        <span v-if="a.reason" class="diff__reason">{{ a.reason }}</span>
      </div>
    </div>

    <!-- 改期 -->
    <div v-if="diff.rescheduled?.length" class="diff__group">
      <div class="diff__grouptitle diff__grouptitle--mv">↻ 改期</div>
      <div v-for="m in diff.rescheduled" :key="m.id" class="diff__row diff__row--mv">
        <span class="diff__name">{{ m.name }}</span>
        <span class="diff__time">{{ m.from }} → {{ m.to }}</span>
        <span class="diff__reason">{{ m.reason }}</span>
      </div>
    </div>

    <!-- 预算复核 -->
    <div v-if="diff.budget_recheck" class="diff__budget">
      <span>预算复核</span>
      <b class="diff__money">
        ¥{{ diff.budget_recheck.before_cny }}
        <em class="diff__money-arrow">→</em>
        <span class="diff__money-after">¥{{ diff.budget_recheck.after_cny }}</span>
        <em
          class="diff__money-delta"
          :class="diff.budget_recheck.delta_cny >= 0 ? 'diff__money-delta--up' : 'diff__money-delta--down'"
        >{{ diff.budget_recheck.delta_cny >= 0 ? "+" : "" }}{{ diff.budget_recheck.delta_cny }}</em>
      </b>
      <span v-if="diff.budget_recheck.note" class="diff__reason">{{ diff.budget_recheck.note }}</span>
    </div>

    <div v-if="diff.sources?.length" class="diff__sources">
      <span>涉及条目：</span>
      <RouterLink v-for="s in diff.sources" :key="s" :to="`/wiki?q=${encodeURIComponent(s)}`" class="diff__src">{{ s }}</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.diff {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.diff__banner {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-accent-300);
  background: linear-gradient(120deg, rgba(232, 184, 75, 0.14), rgba(62, 198, 184, 0.08));
  border: 1px solid rgba(232, 184, 75, 0.35);
  border-radius: var(--radius-md);
  padding: 9px 13px;
}
.diff__banner-ic {
  font-size: 16px;
}
.diff__summary {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.diff__group {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.diff__grouptitle {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}
.diff__grouptitle--rm {
  color: #fca5a5;
  background: rgba(248, 113, 113, 0.12);
}
.diff__grouptitle--add {
  color: #86efac;
  background: rgba(74, 222, 128, 0.12);
}
.diff__grouptitle--mv {
  color: #fcd34d;
  background: rgba(245, 158, 11, 0.12);
}
.diff__row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 12px;
}
.diff__row + .diff__row {
  border-top: 1px dashed rgba(35, 54, 79, 0.5);
}
/* 状态色背景统一 12% 透明度（§9 P1） */
.diff__row--rm {
  background: rgba(248, 113, 113, 0.12);
}
.diff__row--add {
  background: rgba(74, 222, 128, 0.12);
}
.diff__row--mv {
  background: rgba(245, 158, 11, 0.12);
}
.diff__addmain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.diff__name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}
.diff__row--rm .diff__name {
  color: #fca5a5;
  text-decoration: line-through;
  text-decoration-color: rgba(248, 113, 113, 0.7);
}
.diff__row--add .diff__name {
  color: #bbf7d0;
}
.diff__time {
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  color: var(--text-secondary);
}
.diff__cost {
  font-size: 12px;
  color: var(--accent);
  font-family: "JetBrains Mono", monospace;
}
.diff__reason {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.55;
}
.diff__budget {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(62, 198, 184, 0.05);
  border: 1px dashed rgba(62, 198, 184, 0.3);
  border-radius: 10px;
  padding: 10px 13px;
}
.diff__money {
  font-family: "JetBrains Mono", monospace;
  color: var(--text-dim);
  text-decoration: line-through;
}
.diff__money-after {
  color: var(--accent);
  text-decoration: none;
}
.diff__money-arrow {
  font-style: normal;
  color: var(--text-dim);
  margin: 0 4px;
  text-decoration: none;
}
.diff__money-delta {
  font-style: normal;
  margin-left: 6px;
  text-decoration: none;
  border-radius: 5px;
  padding: 0 6px;
  font-size: 11px;
}
.diff__money-delta--up {
  color: #fca5a5;
  background: rgba(248, 113, 113, 0.12);
}
.diff__money-delta--down {
  color: #86efac;
  background: rgba(74, 222, 128, 0.12);
}
.diff__sources {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-dim);
}
.diff__src {
  color: var(--primary);
  border: 1px solid rgba(62, 198, 184, 0.3);
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 11.5px;
}
</style>
