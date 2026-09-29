<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { GameResult } from "./types";

const props = defineProps<{
  grid: string[];
  reward: string;
  related_culture_id?: string;
}>();
const emit = defineEmits<{ solved: [GameResult] }>();

const rows = props.grid.length;
const cols = props.grid[0].length;

function find(ch: string) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (props.grid[r][c] === ch) return { r, c };
    }
  }
  return { r: 0, c: 0 };
}

const start = find("S");
const end = find("E");
const pos = ref({ ...start });

function isWall(r: number, c: number) {
  return r < 0 || c < 0 || r >= rows || c >= cols || props.grid[r][c] === "#";
}

function move(dr: number, dc: number) {
  const nr = pos.value.r + dr;
  const nc = pos.value.c + dc;
  if (isWall(nr, nc)) return;
  pos.value = { r: nr, c: nc };
  if (nr === end.r && nc === end.c) {
    setTimeout(() => {
      emit("solved", {
        reward: props.reward,
        explanation: "竹筏穿过江心礁石，顺利抵达夕阳观景台。",
        related_culture_id: props.related_culture_id,
      });
    }, 150);
  }
}

function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case "ArrowUp":
      move(-1, 0);
      break;
    case "ArrowDown":
      move(1, 0);
      break;
    case "ArrowLeft":
      move(0, -1);
      break;
    case "ArrowRight":
      move(0, 1);
      break;
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

function reset() {
  pos.value = { ...start };
}

function cellIcon(r: number, c: number) {
  const ch = props.grid[r][c];
  if (pos.value.r === r && pos.value.c === c) return "🛶";
  if (ch === "S") return "🏁";
  if (ch === "E") return "🌅";
  if (ch === "#") return "";
  return "";
}
</script>

<template>
  <div class="maze">
    <div class="maze__hint">用键盘方向键或下方按钮移动竹筏，从起点到落日观景台。</div>
    <div class="maze__board" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
      <div
        v-for="r in rows"
        :key="r"
        class="maze__row"
      >
        <div
          v-for="c in cols"
          :key="`${r}-${c}`"
          class="maze__cell"
          :class="{
            'maze__cell--wall': grid[r - 1][c - 1] === '#',
            'maze__cell--player': pos.r === r - 1 && pos.c === c - 1,
            'maze__cell--start': grid[r - 1][c - 1] === 'S',
            'maze__cell--end': grid[r - 1][c - 1] === 'E',
          }"
        >
          {{ cellIcon(r - 1, c - 1) }}
        </div>
      </div>
    </div>
    <div class="maze__pad">
      <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(-1, 0)">↑</button>
      <div>
        <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(0, -1)">←</button>
        <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(0, 1)">→</button>
      </div>
      <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(1, 0)">↓</button>
    </div>
    <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">重置竹筏</button>
  </div>
</template>

<style scoped>
.maze {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.maze__hint {
  font-size: 13px;
  color: var(--text-secondary);
}
.maze__board {
  display: grid;
  gap: 4px;
  width: min(300px, 100%);
}
.maze__row {
  display: contents;
}
.maze__cell {
  aspect-ratio: 1;
  border-radius: 5px;
  display: grid;
  place-items: center;
  font-size: 16px;
  background: rgba(62, 198, 184, 0.08);
  border: 1px solid rgba(62, 198, 184, 0.15);
}
.maze__cell--wall {
  background: #142238;
  border-color: #1d3150;
}
.maze__cell--start {
  background: rgba(62, 198, 184, 0.18);
}
.maze__cell--end {
  background: rgba(232, 184, 75, 0.25);
}
.maze__cell--player {
  background: var(--primary);
  box-shadow: 0 0 12px rgba(62, 198, 184, 0.6);
}
.maze__pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.maze__pad > div {
  display: flex;
  gap: 4px;
}
</style>
