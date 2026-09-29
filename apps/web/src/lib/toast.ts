import { reactive } from "vue";

export interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

export const toastState = reactive<{ list: ToastItem[] }>({ list: [] });

let seq = 0;

/** 全局轻提示：页内 toast，不打断演示 */
export function toast(text: string, kind: "info" | "error" | "success" = "info") {
  const id = ++seq;
  toastState.list.push({ id, text, kind });
  setTimeout(() => {
    const i = toastState.list.findIndex((t) => t.id === id);
    if (i >= 0) toastState.list.splice(i, 1);
  }, 3400);
}
