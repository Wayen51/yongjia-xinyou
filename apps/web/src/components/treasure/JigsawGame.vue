<script setup lang="ts">
import { ref } from "vue";
import type { GameResult } from "./types";

const props = withDefaults(
  defineProps<{
    image: string;
    rows?: number;
    cols?: number;
    reward: string;
    related_culture_id?: string;
  }>(),
  { rows: 3, cols: 3 }
);
const emit = defineEmits<{ solved: [GameResult] }>();

const rows = props.rows;
const cols = props.cols;
const total = rows * cols;

function solvedOrder() {
  return Array.from({ length: total }, (_, i) => i);
}

function solvable(arr: number[]) {
  const list = arr.filter((v) => v !== total - 1);
  let inv = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i] > list[j]) inv++;
    }
  }
  return inv % 2 === 0;
}

function scramble() {
  let arr: number[];
  do {
    arr = solvedOrder().sort(() => Math.random() - 0.5);
  } while (!solvable(arr));
  return arr;
}

const tiles = ref(scramble());

function emptyIndex() {
  return tiles.value.indexOf(total - 1);
}

function canMove(i: number) {
  const e = emptyIndex();
  const ir = Math.floor(i / cols);
  const ic = i % cols;
  const er = Math.floor(e / cols);
  const ec = e % cols;
  return Math.abs(ir - er) + Math.abs(ic - ec) === 1;
}

function move(i: number) {
  if (!canMove(i)) return;
  const e = emptyIndex();
  [tiles.value[i], tiles.value[e]] = [tiles.value[e], tiles.value[i]];
  if (tiles.value.every((v, idx) => v === idx)) {
    emit("solved", {
      reward: props.reward,
      explanation: "拼图归位，古村落的风貌重新展现。",
      related_culture_id: props.related_culture_id,
    });
  }
}

function tileStyle(value: number) {
  const r = Math.floor(value / cols);
  const c = value % cols;
  return {
    backgroundImage: `url(${props.image})`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${(c / (cols - 1)) * 100}% ${(r / (rows - 1)) * 100}%`,
  };
}

function reset() {
  tiles.value = scramble();
}
</script>

<template>
  <div class="jig">
    <div class="jig__hint">点击与空白相邻的图块进行滑动，拼回原图。</div>
    <div class="jig__board" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
      <button
        v-for="(value, i) in tiles"
        :key="i"
        class="jig__tile"
        :class="{ 'jig__tile--empty': value === total - 1 }"
        :style="value === total - 1 ? undefined : tileStyle(value)"
        :disabled="value === total - 1"
        @click="move(i)"
      />
    </div>
    <button class="yj-btn yj-btn--ghost yj-btn--sm jig__reset" @click="reset">重新打乱</button>
  </div>
</template>

<style scoped>
.jig {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.jig__hint {
  font-size: 13px;
  color: var(--text-secondary);
}
.jig__board {
  width: min(300px, 100%);
  display: grid;
  gap: 3px;
}
.jig__tile {
  aspect-ratio: 1 / 1;
  border: none;
  border-radius: 6px;
  background-repeat: no-repeat;
  cursor: pointer;
  transition: transform 0.12s ease;
  image-rendering: pixelated;
}
.jig__tile:hover:not(:disabled) {
  transform: scale(0.96);
  box-shadow: inset 0 0 0 2px var(--primary);
}
.jig__tile--empty {
  background: rgba(255, 255, 255, 0.06);
  border: 1px dashed rgba(255, 255, 255, 0.15);
  cursor: default;
}
.jig__reset {
  align-self: center;
}
</style>
