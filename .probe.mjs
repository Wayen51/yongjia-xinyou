// 临时探针：验证正式服务(3000)上的网站 / 手机端 /m/ / API 是否都可达
const urls = [
  "http://127.0.0.1:3000/",
  "http://127.0.0.1:3000/m/",
  "http://127.0.0.1:3000/m/assets/index-BkQVam1R.js",
  "http://127.0.0.1:3000/assets/index-DuLyKZWV.js",
  "http://172.18.214.58:3000/m/",
  "http://172.18.214.58:3000/api/scenes?enabled=1",
];
for (const u of urls) {
  try {
    const r = await fetch(u);
    const t = await r.text();
    console.log(r.status, String(t.length).padStart(7), u, "|", t.slice(0, 70).replace(/\s+/g, " "));
  } catch (e) {
    console.log("FAIL", u, e.message);
  }
}
