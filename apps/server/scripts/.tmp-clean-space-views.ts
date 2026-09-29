import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const db = new DatabaseSync(path.resolve(process.cwd(), "data/zhiyou.db"));
const r = db.prepare("DELETE FROM scene_views WHERE source = ?").run("space");
const left = db.prepare("SELECT COUNT(*) AS c FROM scene_views").get() as { c: number };
console.log("deleted source=space rows:", r.changes, "| remaining total:", left.c);
db.close();
