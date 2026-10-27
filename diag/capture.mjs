import { writeFile, mkdir } from "node:fs/promises";
const base = "https://simracing.ethiopianmotorsport.com";
await mkdir("diag/raw2", { recursive: true });
async function grab(name, url) {
  try {
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "ETSA-Championship-Sync/1.0" }, redirect: "follow" });
    const t = await r.text();
    await writeFile(`diag/raw2/${name}.json`, JSON.stringify({ url, status: r.status, contentType: r.headers.get("content-type"), finalUrl: r.url, body: t }, null, 1));
  } catch (e) { await writeFile(`diag/raw2/${name}.err.txt`, url + "\n" + String(e && e.stack)); }
}
await grab("root", `${base}/__data.json`);
await grab("championships", `${base}/championships/__data.json`);
for (const c of [1, 2]) {
  await grab(`calendar-${c}`, `${base}/championships/${c}/calendar/__data.json`);
  await grab(`standings-${c}`, `${base}/championships/${c}/standings/__data.json`);
  await grab(`champ-${c}`, `${base}/championships/${c}/__data.json`);
}
for (const [c, ids] of [[1, [5,6]], [2, [8,9,10]]]) {
  for (const id of ids) await grab(`result-${c}-${id}`, `${base}/championships/${c}/__data.json?round=${id}&week=time_attack`);
}
