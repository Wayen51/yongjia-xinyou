-- 知识库条目：平台唯一事实源
CREATE TABLE IF NOT EXISTS knowledge_items (
  id            TEXT PRIMARY KEY,
  domain        TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  summary       TEXT NOT NULL,
  content       TEXT NOT NULL,
  tags          TEXT,
  indoor        INTEGER DEFAULT 0,
  suitable_for  TEXT,
  avg_cost_cny  INTEGER,
  avg_duration_min INTEGER,
  geo_lat REAL, geo_lng REAL,
  assets        TEXT,
  source        TEXT,
  source_url    TEXT,
  rating        REAL DEFAULT 4.5,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  history TEXT,
  mock_weather TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itineraries (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  version INTEGER DEFAULT 1,
  payload TEXT NOT NULL,
  change_log TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  poi_id TEXT,
  content_type TEXT,
  visitor_region TEXT,
  amount_cny REAL,
  created_at TEXT
);

-- 板块二：AR 互动游戏 · 游戏主表（运营端创建，玩家端消费）
CREATE TABLE IF NOT EXISTS ar_games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_id TEXT,                          -- culture | midautumn | spring | custom
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | active | paused | ended
  intro TEXT,
  outro TEXT,
  theme_json TEXT,                           -- { primary, secondary, bg, progress }
  cover TEXT,                                -- 主题卡片封面
  start_date TEXT,
  end_date TEXT,
  total_rewards INTEGER DEFAULT 0,
  completion_badge TEXT,
  qr_text TEXT,
  ai_mode TEXT,                              -- mock | llm（剧情生成来源，演示标注用）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- 板块二：AR 点位表（每场游戏的点位配置，poi 坐标来自 ar_points_seed）
CREATE TABLE IF NOT EXISTS ar_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  poi_id TEXT NOT NULL,
  order_index INTEGER DEFAULT 1,
  billboard TEXT,
  task_type TEXT DEFAULT 'quiz',
  npc TEXT,
  question TEXT,
  answer TEXT,
  hint TEXT,
  explanation TEXT,
  reward_coupon_id TEXT,
  reward_name TEXT,
  reward_type TEXT,
  geofence_radius_m INTEGER DEFAULT 50
);

-- 板块二：玩家记录（按会话聚合，演示态不做账号体系）
CREATE TABLE IF NOT EXISTS ar_play_records (
  id TEXT PRIMARY KEY,                       -- gameId + ':' + playerKey
  game_id TEXT NOT NULL,
  user_name TEXT,
  solved_json TEXT DEFAULT '[]',             -- ["POI-001", ...]
  claimed_json TEXT DEFAULT '[]',            -- ["CPN-001", ...]
  points_done INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  duration_min INTEGER DEFAULT 0,
  rewards_claimed INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- 板块二：点位打卡流水（玩家进入围栏/答题留痕，供演示溯源）
CREATE TABLE IF NOT EXISTS ar_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  poi_id TEXT NOT NULL,
  action TEXT,                               -- enter | submit | claim
  distance_m REAL,
  answered_correct INTEGER DEFAULT 0,
  reward_claimed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 3D 景点场景：3D 云游 / 效果展示 / AR 寻宝共用的场景底座
-- 数据来源：pano_scenes_index.json（全景 + 视角）+ ar_points_seed.json（AR 锚点坐标）
-- hotspots 默认读 hotspots_file；一旦在管理端编辑过，就用 hotspots_json 覆盖，不污染原始素材文件
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  poi_id TEXT,
  description TEXT,
  panorama TEXT,                             -- 360° 全景图路径
  thumbnail TEXT,                            -- 列表缩略图
  hotspots_file TEXT,                        -- /assets/3d/pano_xxx_hotspots.json
  hotspots_json TEXT DEFAULT '[]',           -- 管理端编辑后的热点覆盖（空数组表示仍用文件）
  model_3d TEXT,                             -- 可选：场景绑定的 glb 模型
  ar_lat REAL, ar_lng REAL,                  -- AR 寻宝锚点（GCJ-02，与 ar_points_seed 同源）
  ar_radius_m INTEGER DEFAULT 60,
  default_yaw REAL DEFAULT 0,
  default_pitch REAL DEFAULT -10,
  default_fov REAL DEFAULT 75,
  tags_json TEXT,
  theme_color TEXT,
  enabled INTEGER DEFAULT 1,                 -- 是否在大屏巡航 / 云游中启用
  sort_order INTEGER DEFAULT 0,
  visit_count INTEGER DEFAULT 0,             -- 演示基线（真实埋点见 scene_views，两者相加才是对外访问量）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- 场景浏览埋点流水（真实访问量来源）
-- 口径：scenes.visit_count 只作「演示基线」保证空库也有合理观感，
-- 对外访问量 = 演示基线 + 本表按 scene_id 的计数；source 记录上报来源（space / cruise / …）便于溯源。
-- 按日聚合走 view_date 冗余列，避免每次查询都做日期函数运算（SQLite 下无法走索引）。
CREATE TABLE IF NOT EXISTS scene_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id TEXT NOT NULL,
  source TEXT,                               -- space（3D 云游）| cruise（大屏巡航）| …
  view_date TEXT NOT NULL,                   -- 本地日期 YYYY-MM-DD
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scene_views_scene ON scene_views(scene_id);
CREATE INDEX IF NOT EXISTS idx_scene_views_date ON scene_views(view_date);

-- 板块一：AIGC 视频生成项目（演示态：生成过程为模拟，最终画面由运营内容组提供）
CREATE TABLE IF NOT EXISTS video_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  style TEXT NOT NULL,
  shot_count INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'scripting',  -- scripting | generating | stitching | done | failed
  progress_pct INTEGER NOT NULL DEFAULT 0,
  stage_label TEXT,
  enriched_prompt TEXT,
  negative_prompt TEXT,
  settings_json TEXT,
  script_json TEXT,        -- { "shots": [VideoShot] }
  flow_log TEXT,           -- [{ stage, msg, ts }]
  output_json TEXT,        -- { duration_sec, format, mode, notice, deliverable }
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- 板块五：模拟预订凭证（FR-AGT-08）
-- 只登记「发过哪张凭证」，凭证正文由 booking/voucher.ts 依当时的行程实时拼装，
-- 不落正文快照：模板改了、行程重排了，历史凭证号依然在，正文以发出时为准可追溯。
CREATE TABLE IF NOT EXISTS booking_vouchers (
  voucher_no   TEXT PRIMARY KEY,             -- YJZY-YYYYMMDD-NNNN
  issue_date   TEXT NOT NULL,                -- YYYYMMDD，按日发号
  seq          INTEGER NOT NULL,             -- 当日流水号，重启后接着发不重号
  session_id   TEXT,
  itinerary_id TEXT,
  title        TEXT,
  total_cny    INTEGER DEFAULT 0,
  guests       INTEGER DEFAULT 2,
  status       TEXT NOT NULL DEFAULT 'confirmed',
  payload      TEXT,                         -- 发出时的凭证正文
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voucher_date ON booking_vouchers(issue_date);
CREATE INDEX IF NOT EXISTS idx_voucher_session ON booking_vouchers(session_id);
