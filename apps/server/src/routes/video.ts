/** 板块一 · AIGC 视频生成 API（演示态：生成过程模拟，画面素材由运营内容组提供） */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  createVideoProject,
  deleteVideoProject,
  getVideoProject,
  listVideoProjects,
  videoStats,
} from "../db/db.ts";
import { enhancePrompt, previewEnhance } from "../video/enhancer.ts";
import { runVideoPipeline } from "../video/pipeline.ts";
import { VIDEO_STYLES, getVideoStyle } from "../video/styles.ts";
import { guardLlmRoute } from "../lib/guard.ts";

function ok<T>(data: T) {
  return { code: 0, data };
}
function fail(code: number, message: string) {
  return { code, message };
}

export async function registerVideoRoutes(app: FastifyInstance) {
  /* 风格目录 */
  app.get("/api/video/styles", async () => ok({ styles: VIDEO_STYLES, default_style: "documentary" }));

  /* AI 辅助提示词：一句话描述 → 精修后的完整视频提示词（可独立预览，不建项目） */
  app.post("/api/video/enhance", async (req, reply) => {
    if (!guardLlmRoute(req, reply)) return;
    const body = (req.body || {}) as { prompt?: string; style?: string; shot_count?: number; local?: boolean };
    const prompt = (body.prompt || "").trim();
    if (!prompt) return reply.code(400).send(fail(40002, "请输入画面描述"));
    const style = getVideoStyle(body.style || "") ? String(body.style) : "documentary";
    const shotCount = Number(body.shot_count) || 3;
    const mode = String((req.query as Record<string, string | undefined>).mode || (body.local ? "local" : "auto"));
    const result = mode === "local" ? previewEnhance({ prompt, styleId: style, shotCount }) : await enhancePrompt({ prompt, styleId: style, shotCount });
    return ok(result);
  });

  /* 创建视频项目（自动启动模拟生成流水线） */
  app.post("/api/video/projects", async (req, reply) => {
    const body = (req.body || {}) as { title?: string; user_prompt?: string; style?: string; shot_count?: number };
    const user_prompt = (body.user_prompt || "").trim();
    if (!user_prompt) return reply.code(400).send(fail(40002, "请输入画面描述"));
    const style = body.style && getVideoStyle(body.style) ? String(body.style) : "documentary";
    const shot_count = Math.min(Math.max(Math.round(Number(body.shot_count) || 3), 1), 8);
    const title = (body.title || "").trim() || `AI 影像 · ${user_prompt.slice(0, 16)}`;
    const id = "vid_" + randomUUID().slice(0, 8);
    createVideoProject({ id, title, user_prompt, style, shot_count });
    void runVideoPipeline(id);
    return ok({ id, status: "scripting", title });
  });

  /* 视频项目列表 */
  app.get("/api/video/projects", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const items = listVideoProjects(q.status);
    return ok({ items, stats: videoStats() });
  });

  /* 视频项目详情 */
  app.get("/api/video/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getVideoProject(id);
    if (!item) return reply.code(404).send(fail(40402, "视频项目不存在"));
    return ok(item);
  });

  /* 轮询生成状态 */
  app.get("/api/video/projects/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getVideoProject(id);
    if (!item) return reply.code(404).send(fail(40402, "视频项目不存在"));
    return ok({
      id: item.id,
      title: item.title,
      status: item.status,
      progress_pct: item.progress_pct,
      stage_label: item.stage_label,
      shots: item.shots,
      flow_log: item.flow_log.slice(-12),
      output: item.output,
    });
  });

  /* 重新生成（沿用脚本，重跑镜头与拼接） */
  app.post("/api/video/projects/:id/regenerate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getVideoProject(id);
    if (!item) return reply.code(404).send(fail(40402, "视频项目不存在"));
    if (item.status === "generating" || item.status === "stitching") {
      return reply.code(409).send(fail(40901, "项目正在生成中，请稍候"));
    }
    void runVideoPipeline(id, { keepScript: true });
    return ok({ id, status: "generating" });
  });

  /* 删除视频项目 */
  app.delete("/api/video/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getVideoProject(id);
    if (!item) return reply.code(404).send(fail(40402, "视频项目不存在"));
    deleteVideoProject(id);
    return ok({ id, deleted: true });
  });
}
