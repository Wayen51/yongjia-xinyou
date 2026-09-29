/**
 * 永嘉 3D 景点场景 API
 * —— 3D 云游 / 效果展示 / AR 寻宝 三处共用的场景底座。
 *
 * 运营端：场景 CRUD、热点编辑、AR 锚点校准、启用上下线
 * 展示端：场景列表 + 默认视角 + 热点 + Agent 运行脚本
 *
 * Demo 口径：访问量 = 种子阶段的「演示基线」+ `scene_views` 真实埋点计数
 * （基线保证空库演示也有合理观感，真实计数由展示端每次打开场景上报）。
 * 热点默认读 public 素材文件，一旦在运营端编辑即写入 hotspots_json 覆盖，不改动原始素材文件。
 */
import type { FastifyInstance } from "fastify";
import {
  buildAgentScript,
  createScene,
  deleteScene,
  getScene,
  listScenes,
  recordSceneView,
  sceneStats,
  sceneVisitBreakdown,
  updateScene,
} from "../db/db.ts";

function ok<T>(data: T) {
  return { code: 0, data };
}
function fail(code: number, message: string) {
  return { code, message };
}

export async function registerSceneRoutes(app: FastifyInstance) {
  /** 场景总览指标：管理端顶部卡片 */
  app.get("/api/scenes/stats", async () => ok(sceneStats()));

  /** 场景列表：展示端只需 enabled=1 */
  app.get("/api/scenes", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ok({ scenes: listScenes({ enabled: q.enabled }) });
  });

  /** 场景详情：含热点与默认视角 */
  app.get("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send(fail(40401, "场景不存在"));
    return ok({ scene, agent_script: buildAgentScript(scene) });
  });

  /**
   * 场景浏览上报（真实埋点入口）。
   *
   * 展示端每次「打开 / 切换到一个」场景调一次，`source` 标明来源便于溯源。
   * 不做去重与频控：量级是演示级（单会场几十到几百次），换来的是「数字真的在动」。
   */
  app.post("/api/scenes/:id/visit", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { source?: string };
    const result = recordSceneView(id, typeof body.source === "string" ? body.source : "unknown");
    if (!result) return reply.code(404).send(fail(40401, "场景不存在"));
    return ok(result);
  });

  /** 埋点总览：按来源拆分，用于自证上报链路（管理端 / 端到端校验） */
  app.get("/api/scenes/visit-breakdown", async () => ok(sceneVisitBreakdown()));

  /** Agent 在该场景中的运行脚本（效果展示模块逐帧回放用） */
  app.get("/api/scenes/:id/agent-script", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send(fail(40401, "场景不存在"));
    return ok({ scene_id: scene.id, scene_name: scene.name, steps: buildAgentScript(scene) });
  });

  /** 批量取全部场景的 Agent 运行脚本：展示模块一次拿全，避免多次往返 */
  app.get("/api/scenes/agent-scripts", async () => {
    return ok({
      scripts: listScenes({ enabled: "1" }).map((s) => ({
        scene_id: s.id,
        scene_name: s.name,
        theme_color: s.theme_color,
        steps: buildAgentScript(s),
      })),
    });
  });

  app.post("/api/scenes", async (req) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const created = createScene(body);
    if (!created) return fail(40901, "场景 ID 已存在");
    return ok({ scene: created });
  });

  app.patch("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as Record<string, unknown>;
    // hotspots 传 null 表示「恢复为素材文件的热点」，传数组表示「保存自定义热点」
    if ("hotspots" in body && body.hotspots !== null && !Array.isArray(body.hotspots)) {
      return reply.code(400).send(fail(40001, "hotspots 必须是数组或 null"));
    }
    const updated = updateScene(id, body as never);
    if (!updated) return reply.code(404).send(fail(40401, "场景不存在"));
    return ok({ scene: updated });
  });

  /** 单独保存热点：运营端热点编辑器保存时调用 */
  app.put("/api/scenes/:id/hotspots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { hotspots?: unknown[] | null };
    if (body.hotspots !== null && !Array.isArray(body.hotspots)) {
      return reply.code(400).send(fail(40001, "hotspots 必须是数组或 null"));
    }
    const updated = updateScene(id, { hotspots: body.hotspots as never });
    if (!updated) return reply.code(404).send(fail(40401, "场景不存在"));
    return ok({ scene: updated });
  });

  app.delete("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteScene(id)) return reply.code(404).send(fail(40401, "场景不存在"));
    return ok({ id, deleted: true });
  });
}
