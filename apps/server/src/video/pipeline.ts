/**
 * 视频生成模拟流水线（演示态）
 *
 * 流程：提示词美化 → 分镜脚本编排 → 逐镜头“AI 生成” → NexaFrame 拼接 → done。
 * 说明：不调用真实视频大模型；每个镜头用延时模拟渲染进度，方便前端轮询呈现完整工序。
 *       最终画面由运营内容组提供的素材/成片替换，本流水线负责“展示运行过程”。
 */
import {
  getVideoProject,
  updateVideoProject,
} from "../db/db.ts";
import type {
  VideoFlowLog,
  VideoProjectStatus,
  VideoShot,
} from "@zhiyou/shared";
import { enhancePrompt } from "./enhancer.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const nowIso = () => new Date().toISOString();

export interface RunOptions {
  /** true 表示沿用已存提示词与分镜，只重跑“逐镜头生成 + 拼接”（详情页重新生成） */
  keepScript?: boolean;
}

function buildShots(
  topics: string[],
  enriched: string,
  kb: Array<{ id: string; name: string; domain: string }>,
): VideoShot[] {
  return topics.map((topic, i) => {
    const kbRef = kb[i % Math.max(kb.length, 1)];
    return {
      shot_id: i + 1,
      description: topic,
      duration_sec: 8,
      prompt: `${enriched}\n[镜头 ${i + 1} · ${topic}${kbRef ? ` · 锚点条目 ${kbRef.name}(${kbRef.id})` : ""}]`,
      kb_refs: kbRef ? [kbRef.id] : [],
      status: "pending",
      video_url: `mock://shot_${i + 1}`,
    };
  });
}

export async function runVideoPipeline(projectId: string, opts: RunOptions = {}): Promise<void> {
  const proj = getVideoProject(projectId);
  if (!proj) return;

  const n = Math.min(Math.max(proj.shot_count, 1), 8);
  let flow: VideoFlowLog[] = [];
  let shots: VideoShot[] = [];

  const log = (stage: string, msg: string) => {
    flow = [...flow, { stage, msg, ts: nowIso() }];
  };
  const persist = (patch: Parameters<typeof updateVideoProject>[1], extraFlow?: VideoFlowLog[]) => {
    updateVideoProject(projectId, {
      ...patch,
      flow_log: JSON.stringify(extraFlow ?? flow),
    });
  };
  const setStatus = (status: VideoProjectStatus, progress: number, stage_label: string) =>
    persist({ status, progress_pct: Math.round(progress), stage_label });

  try {
    /* ---- 阶段一：解析与提示词美化 ---- */
    log("prompt", "AI 正在解析画面描述，拆解主题、光景与情绪…");
    setStatus("scripting", 4, "解析并增强提示词");
    await sleep(rand(500, 800));

    let enriched = proj.enriched_prompt;
    let negative = proj.negative_prompt;

    if (opts.keepScript && enriched && proj.shots.length) {
      shots = proj.shots.map((s) => ({ ...s, status: "pending" as const, video_url: undefined }));
      log("prompt", `沿用已存脚本「${proj.title}」，重新进入生成队列`);
    } else {
      const enrich = await enhancePrompt({
        prompt: proj.user_prompt,
        styleId: proj.style,
        shotCount: n,
      });
      enriched = enrich.enriched_prompt;
      negative = enrich.negative_prompt;
      shots = buildShots(enrich.shot_topics, enrich.enriched_prompt, enrich.kb_hits);
      persist({
        enriched_prompt: enrich.enriched_prompt,
        negative_prompt: enrich.negative_prompt,
        settings_json: JSON.stringify(enrich.settings),
      });
      log("prompt", `提示词美化完成（${enrich.mode === "llm" ? "LLM 润色" : "本地精修"}）→ 已交付分镜引擎`);
    }

    /* ---- 阶段二：分镜脚本编排 ---- */
    setStatus("scripting", 14, "分镜脚本编排");
    await sleep(rand(400, 700));
    persist({ script_json: JSON.stringify({ shots }) });
    log("script", `已生成 ${shots.length} 个分镜脚本，每个 8 秒（NexaFrame 镜头时序）`);
    setStatus("generating", 20, "逐镜头 AI 生成中");
    await sleep(rand(300, 500));

    /* ---- 阶段三：逐镜头“AI 生成” ---- */
    const shotSpan = 58;
    for (let i = 0; i < shots.length; i++) {
      shots[i] = { ...shots[i], status: "generating" };
      persist({ script_json: JSON.stringify({ shots }) });
      log("shot", `镜头 ${i + 1}/${shots.length}：${shots[i].description}（视频大模型渲染中…）`);
      setStatus("generating", 20 + (i / shots.length) * shotSpan, `镜头 ${i + 1}/${shots.length} 生成中`);
      await sleep(rand(850, 1500));

      shots[i] = { ...shots[i], status: "done" };
      persist({ script_json: JSON.stringify({ shots }) });
      log("shot", `镜头 ${i + 1}/${shots.length} 已完成渲染`);
      setStatus("generating", 20 + ((i + 1) / shots.length) * shotSpan, `镜头 ${i + 1}/${shots.length} 完成`);
      await sleep(rand(150, 320));
    }

    /* ---- 阶段四：NexaFrame 智能拼接 ---- */
    setStatus("stitching", 82, "NexaFrame 智能拼接");
    await sleep(rand(120, 260));
    log("stitch", "转场生成：镜头时序对齐，应用淡入淡出转场");
    await sleep(rand(420, 620));
    log("stitch", "字幕时间轴同步：按分镜自动烧录字幕");
    await sleep(rand(420, 620));
    log("stitch", "BGM 节奏匹配与响度标准化");
    await sleep(rand(320, 520));

    /* ---- 阶段五：完成 ---- */
    const settings = proj.settings;
    persist({
      output_json: JSON.stringify({
        duration_sec: shots.length * 8,
        format: "mp4",
        resolution: settings?.resolution ?? "1920x1080",
        fps: settings?.fps ?? 24,
        aspect: settings?.aspect ?? "16:9",
        mode: "demo-sim",
        deliverable: "运营内容组提供 · 演示模拟成片",
        notice: "演示环境不调用真实视频大模型；分镜脚本可直接导出用于真实成片制作。",
      }),
      negative_prompt: negative,
      enriched_prompt: enriched,
    });
    log("done", "成片已合成（演示模拟）——最终画面将由运营内容组替换后交付");
    setStatus("done", 100, "生成完成");
  } catch (err) {
    log("error", `流水线中断：${err instanceof Error ? err.message : "未知错误"}`);
    setStatus("failed", -1, "生成失败");
  }
}
