<script setup lang="ts">
import { ref } from "vue";
import type { GameResult } from "./types";

interface Pair {
  icon: string;
  label: string;
}
interface Card {
  id: string;
  face: string;
}

const props = defineProps<{
  pairs: Pair[];
  reward: string;
  related_culture_id?: string;
}>();
const emit = defineEmits<{ solved: [GameResult] }>();

const cards = ref<Card[]>([]);
function init() {
  const deck: Card[] = [];
  props.pairs.forEach((p, i) => {
    const id = `${i}`;
    deck.push({ id, face: p.icon });
    deck.push({ id, face: p.label });
  });
  cards.value = deck.sort(() => Math.random() - 0.5);
}
init();

const flipped = ref<number[]>([]);
const matched = ref<Set<string>>(new Set());
const busy = ref(false);

function flip(i: number) {
  if (busy.value || matched.value.has(cards.value[i].id) || flipped.value.includes(i)) return;
  flipped.value.push(i);
  if (flipped.value.length === 2) check();
}

function check() {
  busy.value = true;
  const [a, b] = flipped.value;
  if (cards.value[a].id === cards.value[b].id) {
    matched.value.add(cards.value[a].id);
    flipped.value = [];
    busy.value = false;
    if (matched.value.size === props.pairs.length) {
      emit("solved", {
        reward: props.reward,
        explanation: "所有美食都找到了另一半，丽水街的味道记在心里。",
        related_culture_id: props.related_culture_id,
      });
    }
  } else {
    setTimeout(() => {
      flipped.value = [];
      busy.value = false;
    }, 700);
  }
}

function reset() {
  init();
  matched.value.clear();
  flipped.value = [];
  busy.value = false;
}
</script>

<template>
  <div class="mem">
    <div class="mem__hint">翻开卡片，把美食图标和名称配对。</div>
    <div class="mem__grid">
      <button
        v-for="(card, i) in cards"
        :key="i"
        class="mem__card"
        :class="{
          'mem__card--flipped': flipped.includes(i) || matched.has(card.id),
          'mem__card--matched': matched.has(card.id),
        }"
        @click="flip(i)"
      >
        <span class="mem__face">{{ card.face }}</span>
        <span class="mem__back">?</span>
      </button>
    </div>
    <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">重来</button>
  </div>
</template>

<style scoped>
.mem {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.mem__hint {
  font-size: 13px;
  color: var(--text-secondary);
}
.mem__grid {
  width: min(360px, 100%);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.mem__card {
  aspect-ratio: 1;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  cursor: pointer;
  display: grid;
  place-items: center;
  position: relative;
  transition: all 0.2s ease;
  font-size: 22px;
}
.mem__card:hover:not(:disabled) {
  border-color: var(--primary);
}
.mem__face,
.mem__back {
  grid-area: 1 / 1 / 2 / 2;
  transition: opacity 0.2s ease;
}
.mem__face {
  opacity: 0;
  font-size: 13px;
  padding: 4px;
  text-align: center;
  line-height: 1.3;
}
.mem__card--flipped .mem__face {
  opacity: 1;
}
.mem__card--flipped .mem__back {
  opacity: 0;
}
.mem__back {
  font-weight: 800;
  color: var(--text-dim);
}
.mem__card--matched {
  border-color: var(--success);
  background: rgba(74, 222, 128, 0.1);
}
</style>
