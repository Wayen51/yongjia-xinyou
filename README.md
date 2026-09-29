# 永嘉新游 · AI 驱动的数字文旅增长与智能运营 Agent 平台

> 2026 首届"永嘉农商杯"AI+OPC 创新创业大赛 · 赛道一（命题 2 · 永嘉特色产业·文旅）
> 团队：永嘉新游团队（主创：邱儒｜队员：毛宏伟、胡泽宇、陈帅瑜）

## 在线体验

| 端 | 地址 |
| --- | --- |
| 电脑端（运营端） | http://121.40.90.53/ |
| 手机端（游客 H5） | http://121.40.90.53/m/ |
| Android APK 下载 | http://121.40.90.53/app/yongjia-xinyou-v1.0.apk |
| 健康检查 | http://121.40.90.53/api/health |

## 核心功能

- **楠楠 AI 伴游**：真实大模型（OpenAI 兼容协议，默认智谱 GLM，可切 DeepSeek）自由对话、行程规划、知识库检索增强（106 条本地知识库）
- **AI 视频生成工坊**：一句话 → 大模型提示词扩写 → 分镜脚本 → 视频
- **3D 云游**：Three.js 全景漫游 + 3D 大屏巡航
- **AR 互动寻宝**：模拟定位 + 本地判题玩法链路
- **数据看板**：政务运营口径，演示数据叠加真实埋点
- **扫码体验 / APP 下载**：电脑端顶栏真二维码直达手机端，APK 直接下载

## 技术架构

npm workspaces 单仓库，TypeScript 全栈：

```
apps/
├── web/      Vue 3 + Vite 6 + Tailwind CSS v4 + ECharts + Three.js（电脑端）
├── mobile/   手机端 H5（vite alias 复用 web 源码，一套代码出两端）
└── server/   Fastify 5 + Node 内置 SQLite + Agent 引擎（LLM 适配层）
packages/
└── shared/   共享类型与工具
yongjia-app/  Capacitor Android 壳（打包 APK）
```

## 本地运行

```bash
# 环境：Node.js 22+，仅用 npm，无需外部数据库（SQLite 内置）
npm install
npm run build          # 构建三端
cd apps/server
npm start              # http://localhost:3000（/ 电脑端 · /m/ 手机端 · /api/）
```

无大模型 Key 时以 `MOCK_LLM=true` 启动即可完整演示（预置剧本模式）。
复制 `.env.example` 为 `.env` 并填入 Key 即切换真实大模型。

## 诚信说明

真实能力：AI 对话 / 行程生成 / 知识库检索 / 视频提示词扩写 / 3D 渲染 / 场景埋点。
演示口径：天气为模拟场景（预留真实 API 对接位）；数据看板为演示数据叠加真实埋点；AR 寻宝未做异地真机 GPS 实测。
