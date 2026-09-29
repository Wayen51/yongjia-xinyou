import type { VideoStyle } from "@zhiyou/shared";

/** 视频风格目录：GET /api/video/styles 的数据源 */
export const VIDEO_STYLES: VideoStyle[] = [
  {
    id: "documentary",
    name: "纪实纪录片",
    desc: "沉稳克制，真实人文与自然光影，适合讲古村、非遗、山水故事。",
    resolution: "1920x1080",
    fps: 24,
    aspect: "16:9",
    keywords: ["纪录片", "纪实", "人文", "真实", "非遗"],
    sample_clip: "/assets/videos/clip-01-landscape.mp4",
  },
  {
    id: "ancient",
    name: "古风 · 东方美学",
    desc: "水墨意境、绢本质感、含蓄留白，适合永嘉学派、耕读文化、古建风物。",
    resolution: "1920x1080",
    fps: 24,
    aspect: "16:9",
    keywords: ["古风", "水墨", "东方", "国风", "诗画", "汉服", "雅集"],
    sample_clip: "/assets/videos/clip-02-ancient.mp4",
  },
  {
    id: "vlog",
    name: "现代旅行 Vlog",
    desc: "轻快生活感、日光通透、手持临场，适合一日游攻略、探店体验。",
    resolution: "1920x1080",
    fps: 30,
    aspect: "16:9",
    keywords: ["vlog", "旅行", "探店", "日常", "攻略", "轻快"],
    sample_clip: "/assets/videos/clip-03-village.mp4",
  },
  {
    id: "craft",
    name: "工艺特写 · 匠心",
    desc: "微距与慢镜，聚焦手作细节与材质肌理，适合瓯窑、木雕、麦饼等技艺呈现。",
    resolution: "1920x1080",
    fps: 24,
    aspect: "16:9",
    keywords: ["工艺", "匠心", "特写", "手作", "非遗", "微距", "慢镜"],
    sample_clip: "/assets/videos/clip-04-craft.mp4",
  },
  {
    id: "heritage",
    name: "非遗纪实 · 传承",
    desc: "人物与场景并重，讲述传承人的日常与坚守，适合昆曲、马灯戏等非遗题材。",
    resolution: "1920x1080",
    fps: 24,
    aspect: "16:9",
    keywords: ["非遗", "传承", "人物", "纪实", "昆曲", "民俗"],
    sample_clip: "/assets/videos/clip-05-heritage.mp4",
  },
  {
    id: "aerial",
    name: "航拍 · 山河大片",
    desc: "高空大范围运镜，云雾山河层次尽收眼底，恢弘通透。",
    resolution: "3840x2160",
    fps: 30,
    aspect: "16:9",
    keywords: ["航拍", "高空", "山河", "云海", "全景", "无人机"],
    sample_clip: "/assets/videos/clip-06-aerial.mp4",
  },
  {
    id: "creative",
    name: "创意混剪 · 宣传片",
    desc: "快节奏蒙太奇、节奏卡点、高对比张力，适合节庆活动、区域推介。",
    resolution: "1920x1080",
    fps: 30,
    aspect: "16:9",
    keywords: ["宣传片", "混剪", "节庆", "卡点", "推介", "创意"],
  },
];

export function getVideoStyle(id: string): VideoStyle | undefined {
  return VIDEO_STYLES.find((s) => s.id === id);
}
