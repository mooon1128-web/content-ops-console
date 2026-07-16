import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const publicBaseUrl = (process.env.XHS_PUBLIC_BASE_URL || "https://content-ops-console.onrender.com").replace(/\/$/, "");
const password = process.env.XHS_MEDIA_PASSWORD || "xhs2026";
const localDataFile = process.env.XHS_LOCAL_DATA_FILE || "content-ops/xhs-media-data.json";
const backupDir = process.env.XHS_LOCAL_BACKUP_DIR || "content-ops/xhs-media-backups";

function assertValidState(data) {
  if (!data || !Array.isArray(data.creators) || !Array.isArray(data.placements)) {
    throw new Error("Cloud XHS data shape is invalid");
  }
}

function countPublished(placements) {
  return placements.filter((item) => item.status === "已发布" || item.publishedAt).length;
}

function stateCounts(data) {
  return {
    creators: Array.isArray(data?.creators) ? data.creators.length : 0,
    placements: Array.isArray(data?.placements) ? data.placements.length : 0,
    published: Array.isArray(data?.placements) ? countPublished(data.placements) : 0,
  };
}

function hasUsefulState(data) {
  const counts = stateCounts(data);
  return counts.creators > 0 || counts.placements > 0;
}

function isDangerousCloudRegression(cloudData, localData) {
  if (!hasUsefulState(localData)) return false;
  if (!hasUsefulState(cloudData)) return true;
  const cloud = stateCounts(cloudData);
  const local = stateCounts(localData);
  if (local.creators >= 50 && cloud.creators < Math.floor(local.creators * 0.5)) return true;
  if (local.placements >= 10 && cloud.placements < Math.floor(local.placements * 0.5)) return true;
  return false;
}

async function fetchCloudState() {
  const login = await fetch(`${publicBaseUrl}/api/xhs-media/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.ok) throw new Error(`XHS login failed: ${login.status}`);

  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("XHS login did not return an auth cookie");

  const response = await fetch(`${publicBaseUrl}/api/xhs-media/state`, {
    headers: { cookie },
  });
  if (!response.ok) throw new Error(`XHS cloud state fetch failed: ${response.status}`);

  const data = await response.json();
  assertValidState(data);
  return data;
}

async function readLocalData() {
  try {
    const current = await readFile(localDataFile, "utf8");
    const data = JSON.parse(current);
    assertValidState(data);
    return { raw: current, data };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(dirname(localDataFile), { recursive: true });
    return { raw: "", data: null };
  }
}

async function backupLocalData(localRaw) {
  try {
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (localRaw) await writeFile(join(backupDir, `local-before-public-sync-${stamp}.json`), localRaw);
    return stamp;
  } catch (error) {
    throw error;
  }
}

const data = await fetchCloudState();
const local = await readLocalData();
const stamp = await backupLocalData(local.raw);
if (!process.env.XHS_ALLOW_SMALLER_CLOUD && isDangerousCloudRegression(data, local.data)) {
  await writeFile(join(backupDir, `rejected-public-sync-${stamp}.json`), `${JSON.stringify(data, null, 2)}\n`);
  throw new Error(`Refused to overwrite local XHS data with smaller cloud state. local=${JSON.stringify(stateCounts(local.data))} cloud=${JSON.stringify(stateCounts(data))}`);
}
await writeFile(localDataFile, `${JSON.stringify(data, null, 2)}\n`);

console.log(JSON.stringify({
  syncedFrom: publicBaseUrl,
  localDataFile,
  ...stateCounts(data),
  updatedAt: data.updatedAt,
  clientUpdatedAt: data.clientUpdatedAt,
}, null, 2));
