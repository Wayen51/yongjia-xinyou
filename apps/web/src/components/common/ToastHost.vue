<script setup lang="ts">
import { toastState } from "@/lib/toast";
</script>

<template>
  <div
    v-for="t in toastState.list"
    :key="t.id"
    class="yj-toast"
    style="margin-bottom: 0"
    :style="{ bottom: `${16 + toastState.list.findIndex((x) => x.id === t.id) * 46}px` }"
  >
    <span v-if="t.kind === 'error'" style="color: var(--danger)">●</span>
    <span v-else-if="t.kind === 'success'" style="color: var(--success)">●</span>
    <span v-else style="color: var(--primary)">●</span>
    {{ t.text }}
  </div>
</template>
