<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api/client";
import type { Domain, KbItem } from "@/types/api";

/* 平台向 v2 · 全局搜索：检索底层本地知识库，直达 /wiki 详情 */
const router = useRouter();
const route = useRoute();

const kw = ref("");
const items = ref<KbItem[]>([]);
const open = ref(false);
const loading = ref(false);
const empty = ref(false);

const domainLabel = (d: Domain) => (d === "poi" ? "景点" : d === "culture" ? "文化" : "商家");
const domainCls = (d: Domain) =>
  d === "poi" ? "gs-tag gs-tag--poi" : d === "culture" ? "gs-tag gs-tag--culture" : "gs-tag gs-tag--business";

let seq = 0;
let deb: ReturnType<typeof setTimeout> | undefined;

async function runSearch(term: string) {
  const my = ++seq;
  loading.value = true;
  try {
    const resp = await api.searchKnowledge({ q: term, limit: 6 });
    if (my !== seq) return;
    items.value = resp.items;
    empty.value = resp.total === 0;
  } catch {
    if (my === seq) {
      items.value = [];
      empty.value = false;
    }
  } finally {
    if (my === seq) loading.value = false;
  }
}

watch(kw, (v) => {
  clearTimeout(deb);
  const term = v.trim();
  if (!term) {
    open.value = false;
    items.value = [];
    empty.value = false;
    loading.value = false;
    return;
  }
  open.value = true;
  deb = setTimeout(() => runSearch(term), 260);
});

function goItem(it: KbItem) {
  open.value = false;
  kw.value = "";
  void router.push({ path: "/wiki", query: { q: it.name, focus: it.id } });
}

function goAll() {
  const term = kw.value.trim();
  if (!term) return;
  open.value = false;
  kw.value = "";
  void router.push({ path: "/wiki", query: { q: term } });
}

/* 路由已变化（例如回到列表页）时收起下拉 */
watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);

onBeforeUnmount(() => clearTimeout(deb));
</script>

<template>
  <div class="gs">
    <span class="gs__ic">🔍</span>
    <input
      v-model="kw"
      class="gs__input"
      type="search"
      placeholder="搜索知识库：景点 / 文化 / 美食…"
      aria-label="全局搜索"
      @focus="kw.trim() && (open = true)"
      @keydown.enter="goAll"
    />

    <Transition name="gs-pop">
      <div v-if="open" class="gs__pop">
        <div v-if="loading" class="gs__hint">检索知识库中…</div>

        <template v-else-if="items.length">
          <button
            v-for="it in items"
            :key="it.id"
            class="gs__item"
            @mousedown.prevent
            @click="goItem(it)"
          >
            <span :class="domainCls(it.domain)">{{ domainLabel(it.domain) }}</span>
            <span class="gs__name">
              <b>{{ it.name }}</b>
              <small>{{ it.summary }}</small>
            </span>
            <i>→</i>
          </button>
          <button class="gs__all" @mousedown.prevent @click="goAll">
            查看全部 “{{ kw.trim() }}” 的结果 <b>→</b>
          </button>
        </template>

        <div v-else-if="empty" class="gs__hint">没有匹配的条目，换个关键词？</div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.gs {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 200px;
  height: 36px;
  background: rgba(22, 38, 63, 0.55);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 12px;
  transition: border-color 0.16s ease, width 0.16s ease;
}
.gs:focus-within {
  border-color: rgba(62, 198, 184, 0.55);
  background: rgba(22, 38, 63, 0.85);
}
.gs__ic {
  font-size: 13px;
  opacity: 0.75;
  flex: none;
}
.gs__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 13px;
}
.gs__input::-webkit-search-cancel-button {
  display: none;
}
.gs__pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  z-index: 100;
}
.gs__hint {
  padding: 18px 12px;
  text-align: center;
  color: var(--text-dim);
  font-size: 12.5px;
}
.gs__item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 9px;
  padding: 9px 10px;
  cursor: pointer;
  color: var(--text-primary);
}
.gs__item:hover {
  background: rgba(62, 198, 184, 0.08);
}
.gs__item i {
  margin-left: auto;
  color: var(--primary);
  font-style: normal;
  align-self: center;
}
.gs__name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.gs__name b {
  font-size: 14px;
}
.gs__name small {
  font-size: 11.5px;
  color: var(--text-dim);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gs__all {
  width: 100%;
  margin-top: 4px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 9px;
  padding: 8px;
  font-size: 12.5px;
  cursor: pointer;
}
.gs__all:hover {
  color: var(--primary);
  border-color: var(--primary);
}
.gs-tag {
  flex: none;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  margin-top: 2px;
}
.gs-tag--poi {
  color: var(--primary);
  background: var(--primary-soft);
}
.gs-tag--culture {
  color: #e8c07a;
  background: rgba(232, 192, 122, 0.14);
}
.gs-tag--business {
  color: #f4a261;
  background: rgba(244, 162, 97, 0.14);
}

.gs-pop-enter-active,
.gs-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.gs-pop-enter-from,
.gs-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 1200px) {
  .gs {
    width: 190px;
  }
}
@media (max-width: 640px) {
  .gs {
    width: 150px;
  }
  .gs__pop {
    right: auto;
    left: 0;
    width: 76vw;
  }
}
</style>
