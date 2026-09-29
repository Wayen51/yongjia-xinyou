<script setup lang="ts">
import type { DemoPlan } from "@/types/api";

defineProps<{ plan: DemoPlan }>();
</script>

<template>
  <div class="plan">
    <div class="plan__head">
      <div class="plan__title">{{ plan.title }}</div>
      <div class="plan__meta">
        <span v-if="plan.budget_total_cny != null" class="plan__budget">预算合计 ¥{{ plan.budget_total_cny }}</span>
      </div>
    </div>

    <div v-for="day in plan.days" :key="day.day" class="plan__day">
      <div class="plan__dayhead">
        <span class="plan__daytag">D{{ day.day }}</span>
        <span class="plan__theme">{{ day.theme }}</span>
      </div>
      <div class="plan__items">
        <div v-for="it in day.items" :key="it.id + it.start" class="plan__item">
          <span class="plan__time">{{ it.start }}</span>
          <span class="plan__dot"></span>
          <div class="plan__itembody">
            <div class="plan__itemname">
              {{ it.name }}
              <span v-if="it.indoor" class="yj-tag yj-tag--indoor" style="margin-left: 6px">☂ 室内</span>
            </div>
            <div v-if="it.reason" class="plan__reason">{{ it.reason }}</div>
          </div>
          <span class="plan__cost" :class="{ 'plan__cost--free': it.cost_cny === 0 }">
            {{ it.cost_cny === 0 ? "免费" : `¥${it.cost_cny}` }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="plan.budget_note" class="plan__note">💡 {{ plan.budget_note }}</div>
    <div v-if="plan.sources?.length" class="plan__sources">
      <span class="plan__src-label">出处：</span>
      <RouterLink
        v-for="s in plan.sources"
        :key="s"
        :to="`/wiki?q=${encodeURIComponent(s)}`"
        class="plan__src"
      >{{ s }}</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.plan__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.plan__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--primary);
}
.plan__budget {
  font-size: 13px;
  color: var(--accent);
  font-family: "JetBrains Mono", monospace;
}
.plan__day {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(16, 28, 48, 0.6);
  overflow: hidden;
}
.plan__dayhead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(62, 198, 184, 0.07);
  border-bottom: 1px solid var(--border);
}
.plan__daytag {
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-soft);
  border-radius: 6px;
  padding: 2px 8px;
}
.plan__theme {
  font-size: 13px;
  color: var(--text-primary);
}
.plan__items {
  padding: 6px 0;
}
.plan__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 14px;
}
.plan__item + .plan__item {
  border-top: 1px dashed rgba(35, 54, 79, 0.55);
}
.plan__time {
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  color: var(--text-secondary);
  flex: none;
  padding-top: 2px;
  width: 46px;
}
.plan__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
  margin-top: 7px;
  box-shadow: 0 0 6px rgba(62, 198, 184, 0.8);
}
.plan__itembody {
  flex: 1;
  min-width: 0;
}
.plan__itemname {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.4;
}
.plan__reason {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
  line-height: 1.55;
}
.plan__cost {
  font-size: 13px;
  color: var(--accent);
  flex: none;
  font-family: "JetBrains Mono", monospace;
  padding-top: 2px;
}
.plan__cost--free {
  color: var(--success);
}
.plan__note {
  font-size: 12px;
  color: var(--text-dim);
  background: rgba(232, 184, 75, 0.06);
  border: 1px dashed rgba(232, 184, 75, 0.3);
  border-radius: 8px;
  padding: 8px 12px;
  line-height: 1.6;
}
.plan__sources {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.plan__src-label {
  color: var(--text-dim);
}
.plan__src {
  color: var(--primary);
  border: 1px solid rgba(62, 198, 184, 0.3);
  background: var(--primary-soft);
  border-radius: 999px;
  padding: 2px 10px;
  transition: all 0.15s ease;
}
.plan__src:hover {
  background: rgba(62, 198, 184, 0.28);
}
</style>
