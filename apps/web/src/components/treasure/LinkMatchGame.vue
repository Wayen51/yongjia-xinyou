<script setup lang="ts">
import { computed, ref } from "vue";
import type { GameResult } from "./types";

interface Pair {
  left: string;
  right: string;
}

const props = defineProps<{
  pairs: Pair[];
  reward: string;
  related_culture_id?: string;
}>();
const emit = defineEmits<{ solved: [GameResult] }>();

const left = computed(() => props.pairs.map((p, i) => ({ id: `${i}`, text: p.left })).sort(() => Math.random() - 0.5));
const right = computed(() => props.pairs.map((p, i) => ({ id: `${i}`, text: p.right })).sort(() => Math.random() - 0.5));

const selectedLeft = ref<string | null>(null);
const selectedRight = ref<string | null>(null);
const matched = ref<Set<string>>(new Set());

function clickLeft(id: string) {
  if (matched.value.has(id)) return;
  selectedLeft.value = selectedLeft.value === id ? null : id;
}

function clickRight(id: string) {
  if (matched.value.has(id)) return;
  selectedRight.value = selectedRight.value === id ? null : id;
  if (selectedLeft.value !== null) {
    if (selectedLeft.value === id) {
      matched.value.add(id);
      selectedLeft.value = null;
      selectedRight.value = null;
      if (matched.value.size === props.pairs.length) {
        emit("solved", {
          reward: props.reward,
          explanation: "所有瓯窑文化名词都已配对成功。",
          related_culture_id: props.related_culture_id,
        });
      }
    } else {
      selectedRight.value = null;
    }
  }
}

function reset() {
  matched.value.clear();
  selectedLeft.value = null;
  selectedRight.value = null;
}
</script>

<template>
  <div class="link">
    <div class="link__hint">先点左边名称，再点右边释义，完成所有配对。</div>
    <div class="link__board">
      <div class="link__col">
        <button
          v-for="item in left"
          :key="item.id"
          class="link__item"
          :class="{
            'link__item--on': selectedLeft === item.id,
            'link__item--matched': matched.has(item.id),
          }"
          :disabled="matched.has(item.id)"
          @click="clickLeft(item.id)"
        >
          {{ item.text }}
        </button>
      </div>
      <div class="link__col">
        <button
          v-for="item in right"
          :key="item.id"
          class="link__item"
          :class="{
            'link__item--on': selectedRight === item.id,
            'link__item--matched': matched.has(item.id),
          }"
          :disabled="matched.has(item.id)"
          @click="clickRight(item.id)"
        >
          {{ item.text }}
        </button>
      </div>
    </div>
    <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">重置</button>
  </div>
</template>

<style scoped>
.link {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.link__hint {
  font-size: 13px;
  color: var(--text-secondary);
}
.link__board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.link__col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.link__item {
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.link__item:hover:not(:disabled) {
  border-color: rgba(62, 198, 184, 0.45);
}
.link__item--on {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px rgba(62, 198, 184, 0.3);
}
.link__item--matched {
  border-color: var(--success);
  background: rgba(74, 222, 128, 0.12);
  cursor: default;
}
</style>
