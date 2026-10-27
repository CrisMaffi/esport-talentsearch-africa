import { writeFile, mkdir } from "node:fs/promises";
const base = "https://simracing.ethiopianmotorsport.com";
await mkdir("diag/raw", { recursive: true });
async function grab(name, url) {
  try {
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "ETSA-Championship-Sync/1.0" }, redirect: "follow" });
    const t = await r.text();
    await writeFile(`diag/raw/${name}.json`, JSON.stringify({ url, status: r.status, contentType: r.headers.get("content-type"), finalUrl: r.url, body: t }, null, 1));
  } catch (e) { await writeFile(`diag/raw/${name}.err.txt`, url + "\n" + String(e && e.stack)); }
}
for (const c of [1, 2]) {
  await grab(`schedule-${c}`, `${base}/schedule/__data.json?champ=${c}`);
  await grab(`standings-${c}`, `${base}/standings/__data.json?champ=${c}`);
}
for (const [c, ids] of [[1, [1,2,3,4,5,6,7]], [2, [8,9,10,11]]]) {
  for (const id of ids) {
    await grab(`result-${c}-${id}`, `${base}/__data.json?champ=${c}&round=${id}&week=time_attack`);
    await grab(`result-${c}-${id}-noweek`, `${base}/__data.json?champ=${c}&round=${id}`);
  }
}
