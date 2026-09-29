/**
 * 手机端返回手势（左边缘滑入返回）
 *
 * 为什么需要：
 * - `/play/:gameId`（AR 寻宝）是**沉浸页**（`meta.tabbar = false`），底部 Tab 被隐藏，
 *   页内没有常驻返回入口，游客进去后只能靠系统返回键或刷新 —— 左边缘滑入是移动端肌肉记忆。
 * - 游客常直接从 `/#/play/xxx` 扫码进入，此时**站内没有历史栈**，
 *   直接 `router.back()` 是空操作（WebView 会退出 App），因此需要兜底回「寻宝大厅」。
 *
 * 用 `history.state.back` 判断有没有站内历史：vue-router 每次 push 都会写入该字段，
 * 扫码首屏进入时为 null —— 比 `window.history.length` 可靠（后者包含站外/初始条目）。
 *
 * 本组件不做 Capacitor 依赖：Android 物理返回键由 WebView 原生处理（hash 模式即普通历史后退），
 * 只有「无站内历史 + 沉浸页」这一种情形需要本组件的兜底逻辑。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

export interface BackGestureOptions {
  /** 起手判定区宽度（px），手指落点需在此范围内。默认 28 */
  edge?: number;
  /** 触发返回所需的最小水平位移（px）。默认 72 */
  threshold?: number;
  /**
   * 是否响应手势（在 touchstart 时求值）。
   * 默认：有站内历史，或当前是沉浸页 —— 避免在底部 Tab 的根页面上误触发。
   */
  enabled?: () => boolean;
}

/** 标记元素：落在其内部的手指不触发返回手势（用于页内轮播 / 横向滚动区域） */
const NO_SWIPE_ATTR = "data-no-swipe-back";

export function useBackGesture(options: BackGestureOptions = {}) {
  const edge = options.edge ?? 28;
  const threshold = options.threshold ?? 72;

  const route = useRoute();
  const router = useRouter();

  /** 是否正在拖拽（用于显示返回指示器） */
  const active = ref(false);
  /** 拖拽进度 0~1，达到 1 松手即返回 */
  const progress = ref(0);

  /** 站内是否还有上一层（vue-router 写入的 history.state.back） */
  function hasHistory(): boolean {
    const state = window.history.state as { back?: string | null } | null;
    return Boolean(state && state.back);
  }

  function isEnabled(): boolean {
    if (options.enabled) return options.enabled();
    return hasHistory() || route.meta?.immersive === true;
  }

  /**
   * 执行返回：优先回上一层；无站内历史时兜底回寻宝大厅。
   * @returns 是否消费了这次返回（false = 已是最外层根页面，交给系统处理）
   */
  function goBack(): boolean {
    if (hasHistory()) {
      router.back();
      return true;
    }
    if (route.path !== "/") {
      router.replace("/");
      return true;
    }
    return false;
  }

  let startX = 0;
  let startY = 0;
  /** 已判定为横向拖拽（方向锁） */
  let locked = false;
  /** 手指落在边缘、正在观察方向 */
  let pending = false;

  function reset() {
    pending = false;
    locked = false;
    active.value = false;
    progress.value = 0;
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    if (t.clientX > edge) return;
    if (!isEnabled()) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(`[${NO_SWIPE_ATTR}]`)) return;
    pending = true;
    locked = false;
    startX = t.clientX;
    startY = t.clientY;
  }

  function onTouchMove(e: TouchEvent) {
    if (!pending || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!locked) {
      // 方向锁：纵向先动即认为是滚动，放弃手势，避免与页面滚动打架
      if (Math.abs(dy) > Math.abs(dx)) {
        reset();
        return;
      }
      if (dx < 8) return;
      locked = true;
      active.value = true;
    }

    if (dx <= 0) {
      reset();
      return;
    }
    // 锁定后阻止页面横向抖动（监听器为 passive:false，此处 preventDefault 生效）
    if (e.cancelable) e.preventDefault();
    progress.value = Math.min(dx / threshold, 1);
  }

  function onTouchEnd() {
    const fired = locked && progress.value >= 1;
    reset();
    if (fired) goBack();
  }

  onMounted(() => {
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", reset);
  });

  return { active, progress, goBack, hasHistory };
}
