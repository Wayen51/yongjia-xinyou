<script setup lang="ts">
import { computed, ref } from "vue";
import type { GameResult, QuizQuestion } from "./types";

const props = defineProps<{
  questions: QuizQuestion[];
  reward: string;
  related_culture_id?: string;
}>();
const emit = defineEmits<{
  solved: [GameResult];
  close: [];
}>();

const idx = ref(0);
const chosen = ref<number | null>(null);
const showResult = ref(false);
const ok = ref(false);
const explanation = ref("");

const q = computed(() => props.questions[idx.value]);
const last = computed(() => idx.value === props.questions.length - 1);
const letters = ["A", "B", "C", "D"];

function choose(i: number) {
  if (chosen.value !== null) return;
  chosen.value = i;
  ok.value = i === q.value.answer;
  explanation.value = q.value.explanation;
  showResult.value = true;
}

function next() {
  if (!ok.value) return;
  if (last.value) {
    emit("solved", {
      reward: props.reward,
      explanation: props.questions.map((x) => x.explanation).join(" "),
      related_culture_id: props.related_culture_id,
    });
  } else {
    idx.value += 1;
    chosen.value = null;
    showResult.value = false;
    ok.value = false;
    explanation.value = "";
  }
}

function retry() {
  chosen.value = null;
  showResult.value = false;
  ok.value = false;
  explanation.value = "";
}
</script>

<template>
  <div class="qg">
    <div class="qg__progress">第 {{ idx + 1 }} / {{ questions.length }} 题</div>
    <div class="qg__q">{{ q.question }}</div>
    <div class="qg__opts">
      <button
        v-for="(o, i) in q.options"
        :key="i"
        class="qg__opt"
        :class="{
          'qg__opt--right': chosen !== null && i === q.answer,
          'qg__opt--wrong': chosen === i && i !== q.answer,
        }"
        :disabled="chosen !== null"
        @click="choose(i)"
      >
        <span class="qg__letter">{{ letters[i] }}</span>
        <span>{{ o }}</span>
      </button>
    </div>

    <div v-if="showResult" class="qg__result">
      <div class="qg__verdict" :class="ok ? 'qg__verdict--ok' : 'qg__verdict--no'">
        {{ ok ? "🎉 回答正确" : "再想一想" }}
      </div>
      <p class="qg__explain">{{ explanation }}</p>
      <div class="qg__actions">
        <button v-if="!ok" class="yj-btn yj-btn--ghost yj-btn--sm" @click="retry">重新选择</button>
        <button v-else class="yj-btn yj-btn--primary yj-btn--sm" @click="next">
          {{ last ? "领取彩蛋" : "下一题" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qg {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.qg__progress {
  font-size: 12px;
  color: var(--text-dim);
}
.qg__q {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.7;
}
.qg__opts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qg__opt {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.qg__opt:hover:not(:disabled) {
  border-color: var(--primary);
}
.qg__opt:disabled {
  cursor: default;
}
.qg__opt--right {
  border-color: var(--success);
  background: rgba(74, 222, 128, 0.12);
}
.qg__opt--wrong {
  border-color: var(--danger);
  background: rgba(248, 113, 113, 0.12);
}
.qg__letter {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  background: var(--primary-soft);
  color: var(--primary);
}
.qg__result {
  margin-top: 4px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.qg__verdict {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 6px;
}
.qg__verdict--ok {
  color: var(--success);
}
.qg__verdict--no {
  color: var(--warning);
}
.qg__explain {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin: 0 0 10px;
}
.qg__actions {
  display: flex;
  gap: 8px;
}
</style>
