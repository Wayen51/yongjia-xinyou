<script setup lang="ts">
import { computed, ref } from "vue";
import type { GameResult } from "./types";

const props = defineProps<{
  sentence: string;
  answers: string[];
  options: string[];
  reward: string;
  related_culture_id?: string;
}>();
const emit = defineEmits<{ solved: [GameResult] }>();

const parts = computed(() => props.sentence.split("____"));
const fills = ref<(string | null)[]>(props.answers.map(() => null));
const selectedBlank = ref<number | null>(null);
const wrong = ref(false);

function selectBlank(i: number) {
  if (fills.value[i]) return;
  selectedBlank.value = i;
  wrong.value = false;
}

function pickOption(word: string) {
  if (selectedBlank.value === null) return;
  fills.value[selectedBlank.value] = word;
  selectedBlank.value = null;
  wrong.value = false;
}

function clearBlank(i: number) {
  fills.value[i] = null;
  selectedBlank.value = null;
  wrong.value = false;
}

function verify() {
  if (fills.value.every((w, i) => w === props.answers[i])) {
    emit("solved", {
      reward: props.reward,
      explanation: "成语填空正确，林坑晒秋的丰收画面跃然纸上。",
      related_culture_id: props.related_culture_id,
    });
  } else {
    wrong.value = true;
  }
}

function reset() {
  fills.value = props.answers.map(() => null);
  selectedBlank.value = null;
  wrong.value = false;
}
</script>

<template>
  <div class="cloze">
    <div class="cloze__hint">点击空格，再从下方选项中选出正确成语。</div>
    <div class="cloze__sentence">
      <template v-for="(part, i) in parts" :key="i">
        <span>{{ part }}</span>
        <button
          v-if="i < fills.length"
          class="cloze__blank"
          :class="{
            'cloze__blank--filled': fills[i],
            'cloze__blank--on': selectedBlank === i,
            'cloze__blank--wrong': wrong && fills[i] && fills[i] !== answers[i],
          }"
          @click="fills[i] ? clearBlank(i) : selectBlank(i)"
        >
          {{ fills[i] || "?" }}
        </button>
      </template>
    </div>
    <div class="cloze__options">
      <button
        v-for="opt in options"
        :key="opt"
        class="cloze__opt"
        :disabled="fills.includes(opt)"
        @click="pickOption(opt)"
      >
        {{ opt }}
      </button>
    </div>
    <div v-if="wrong" class="cloze__wrong">填入的成语不完全正确，检查一下。</div>
    <div class="cloze__actions">
      <button class="yj-btn yj-btn--primary yj-btn--sm" @click="verify">验证</button>
      <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">清空</button>
    </div>
  </div>
</template>

<style scoped>
.cloze {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cloze__hint {
  font-size: 13px;
  color: var(--text-secondary);
}
.cloze__sentence {
  font-size: 16px;
  line-height: 2.2;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.cloze__blank {
  min-width: 92px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0 4px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px dashed var(--text-dim);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cloze__blank--on {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(62, 198, 184, 0.2);
}
.cloze__blank--filled {
  border-style: solid;
  border-color: var(--primary);
}
.cloze__blank--wrong {
  border-color: var(--danger);
}
.cloze__options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cloze__opt {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cloze__opt:hover:not(:disabled) {
  border-color: var(--primary);
}
.cloze__opt:disabled {
  opacity: 0.35;
  cursor: default;
}
.cloze__wrong {
  color: var(--danger);
  font-size: 13px;
}
.cloze__actions {
  display: flex;
  gap: 8px;
}
</style>
