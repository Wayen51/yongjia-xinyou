<script setup lang="ts">
import { ref } from "vue";
import type { GameResult } from "./types";

const props = defineProps<{
  lines: string[];
  title?: string;
  reward: string;
  related_culture_id?: string;
}>();
const emit = defineEmits<{ solved: [GameResult] }>();

const order = ref<number[]>([]);
function init() {
  let arr: number[];
  do {
    arr = props.lines.map((_, i) => i).sort(() => Math.random() - 0.5);
  } while (arr.every((v, i) => v === i));
  order.value = arr;
}
init();

const selected = ref<number | null>(null);
const wrong = ref(false);

function pick(i: number) {
  wrong.value = false;
  if (selected.value === null) {
    selected.value = i;
    return;
  }
  if (selected.value === i) {
    selected.value = null;
    return;
  }
  const tmp = order.value[selected.value];
  order.value[selected.value] = order.value[i];
  order.value[i] = tmp;
  selected.value = null;
}

function verify() {
  if (order.value.every((v, i) => v === i)) {
    emit("solved", {
      reward: props.reward,
      explanation: `《${props.title || "诗句"}》顺序已还原。`,
      related_culture_id: props.related_culture_id,
    });
  } else {
    wrong.value = true;
  }
}

function reset() {
  init();
  selected.value = null;
  wrong.value = false;
}
</script>

<template>
  <div class="poem">
    <div class="poem__hint">点击两句诗进行位置交换，完成后点“验证顺序”。</div>
    <div class="poem__lines">
      <button
        v-for="(idx, i) in order"
        :key="`${i}-${idx}`"
        class="poem__line"
        :class="{ 'poem__line--on': selected === i, 'poem__line--wrong': wrong }"
        @click="pick(i)"
      >
        <span class="poem__num">{{ i + 1 }}</span>
        <span>{{ lines[idx] }}</span>
      </button>
    </div>
    <div v-if="wrong" class="poem__wrong">顺序不对，再调整一下。</div>
    <div class="poem__actions">
      <button class="yj-btn yj-btn--primary yj-btn--sm" @click="verify">验证顺序</button>
      <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">重排</button>
    </div>
  </div>
</template>

<style scoped>
.poem {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.poem__hint {
  font-size: 13px;
  color: var(--text-secondary);
}
.poem__lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.poem__line {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.poem__line:hover {
  border-color: rgba(62, 198, 184, 0.45);
}
.poem__line--on {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px rgba(62, 198, 184, 0.3);
}
.poem__line--wrong {
  border-color: var(--danger);
}
.poem__num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  background: var(--bg-panel);
  color: var(--text-dim);
}
.poem__wrong {
  color: var(--danger);
  font-size: 13px;
}
.poem__actions {
  display: flex;
  gap: 8px;
}
</style>
