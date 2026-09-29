/**
 * 板块二 · AR 互动：浏览器实时定位（watchPosition 持续跟踪）
 * - 实时性：watchPosition 持续回调，位置变化即触发内容切换
 * - 鲁棒性：区分「不支持 / 请求中 / 已授权 / 被拒绝 / 出错」，被拒绝时回落到演示模拟
 * - 演示口径：定位为真实设备坐标；若无法授权，页面需提供模拟兜底
 */
import { computed, onUnmounted, ref, type ComputedRef, type Ref } from "vue";

export type GeoStatus = "idle" | "unsupported" | "requesting" | "active" | "denied" | "error";

export interface GeoCoords {
  lat: number;
  lng: number;
  /** 精度半径（米），越小越准 */
  accuracy: number;
  /** 设备朝向（度），部分设备（尤其桌面端）为 null */
  heading: number | null;
  /** 速度 m/s */
  speed: number | null;
  /** 采样时间戳 */
  timestamp: number;
}

export interface GeolocationApi {
  supported: ComputedRef<boolean>;
  status: Ref<GeoStatus>;
  coords: Ref<GeoCoords | null>;
  error: Ref<string>;
  /** 正在请求中或已授权 */
  active: ComputedRef<boolean>;
  /** 已收到过至少一次坐标 */
  located: ComputedRef<boolean>;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useGeolocation(): GeolocationApi {
  const supported = computed(() => typeof navigator !== "undefined" && "geolocation" in navigator);
  const status = ref<GeoStatus>(supported.value ? "idle" : "unsupported");
  const coords = ref<GeoCoords | null>(null);
  const error = ref("");
  let watchId: number | null = null;

  const active = computed(() => status.value === "requesting" || status.value === "active");
  const located = computed(() => coords.value !== null);

  function stopWatch() {
    if (watchId != null && supported.value) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  function stop() {
    stopWatch();
    if (status.value === "requesting" || status.value === "active") status.value = "idle";
  }

  function start() {
    if (!supported.value) {
      status.value = "unsupported";
      error.value = "当前浏览器不支持定位，已切换为演示模拟";
      return;
    }
    if (watchId != null) return;
    status.value = "requesting";
    error.value = "";
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        status.value = "active";
        const c = pos.coords;
        coords.value = {
          lat: c.latitude,
          lng: c.longitude,
          accuracy: Number.isFinite(c.accuracy) ? c.accuracy : 0,
          heading: c.heading != null && Number.isFinite(c.heading) ? c.heading : null,
          speed: c.speed != null && Number.isFinite(c.speed) ? c.speed : null,
          timestamp: pos.timestamp,
        };
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          status.value = "denied";
          error.value = "定位权限被拒绝，请在浏览器允许定位后重试（演示可继续用模拟定位）";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          status.value = "error";
          error.value = "无法获取定位信号，请到室外或靠近窗口重试";
        } else {
          status.value = "error";
          error.value = err.message || "定位失败，请重试";
        }
        stopWatch();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 },
    );
  }

  function toggle() {
    if (active.value) stop();
    else start();
  }

  onUnmounted(stop);

  return { supported, status, coords, error, active, located, start, stop, toggle };
}
