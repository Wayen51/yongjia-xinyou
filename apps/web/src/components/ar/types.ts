/** 板块二 · AR 互动：地图组件共享类型 */
export interface ArMapMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius?: number;
  order?: number;
  state?: "pending" | "locked" | "current" | "solved";
  sub?: string;
}
