<script setup lang="ts">
import { computed, ref } from "vue";
import type { GameResult } from "./types";

interface HiddenItem {
  id: string;
  name: string;
  icon: string;
  x: number;
  y: number;
}

const props = defineProps<{
  image: string;
  items: HiddenItem[];
  reward: string;
  related_culture_id?: string;
}>();
const emit = defineEmits<{ solved: [GameResult] }>();

const found = ref<Set<string>>(new Set());
const allFound = computed(() => found.value.size === props.items.length);

function find(id: string) {
  found.value.add(id);
  if (allFound.value) {
    emit("solved", {
      reward: props.reward,
      explanation: "所有文化符号都已找到，芙蓉古村的格局尽在掌握。",
      related_culture_id: props.related_culture_id,
    });
  }
}

function reset() {
  found.value.clear();
}
</script>

<template>
  <div class="hide">
    <div class="hide__hint">在图中找出 5 个文化符号，点击即可收集。</div>
    <div class="hide__target">
      <span
        v-for="item in items"
        :key="item.id"
        class="hide__tag"
        :class="{ 'hide__tag--found': found.has(item.id) }"
      >
        {{ item.icon }} {{ item.name }}
      </span>
    </div>
    <div class="hide__scene">
      <img :src="image" alt="寻物场景" />
      <button
        v-for="item in items"
        :key="item.id"
        class="hide__spot"
        :class="{ 'hide__spot--found': found.has(item.id) }"
        :style="{ left: item.x + '%', top: item.y + '%' }"
        :disabled="found.has(item.id)"
        @click="find(item.id)"
      >
        {{ item.icon }}
      </button>
    </div>
    <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">重置</button>
  </div>
</template>

<style scoped>
.hide {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hide__hint {
  font-size: 13px;
  color: var(--text-secondary);
}
.hide__target {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hide__tag {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}
.hide__tag--found {
  border-color: var(--success);
  background: rgba(74, 222, 128, 0.12);
  color: var(--success);
}
.hide__scene {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.hide__scene img {
  display: block;
  width: 100%;
  height: 220px;
  object-fit: cover;
}
.hide__spot {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid rgba(232, 184, 75, 0.8);
  background: rgba(10, 18, 32, 0.55);
  display: grid;
  place-items: center;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.hide__spot:hover:not(:disabled) {
  transform: translate(-50%, -50%) scale(1.15);
  box-shadow: 0 0 14px rgba(232, 184, 75, 0.5);
}
.hide__spot--found {
  border-color: var(--success);
  background: rgba(74, 222, 128, 0.25);
  cursor: default;
  opacity: 0.7;
}
</style>
