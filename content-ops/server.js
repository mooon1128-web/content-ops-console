import { createAccessControl, publicState, scopedWrite, validateRows, makeAudit } from "./access.js";
import { createStockStore } from './stock-store.js';
import {createPurchaseFiles} from './purchase-files.js';
import { stockView, roleOf, hasStockRole, fail } from './stock-model.js';
import {createXhsStore,publicXhs} from './xhs-store.js';
import RecordOps from '../public/content-ops/ops-core.cjs';
import {createGzip} from 'node:zlib';
import {Readable} from 'node:stream';
const BUILD_ID='20261123-shipping-private-v1';
const contentShape={titles:'rows',accounts:'rows',posts:'rows',products:'rows',inventorySettings:'map'};
import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, statfs, readdir, rename, open, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = join(root, "public", "content-ops");
const xhsPublicDir = join(root, "public", "xhs-media");
const stockPublicDir = join(root, 'public', 'stock-ops');
const bundledXhsDataFile = join(__dirname, "xhs-media-data.json");
const dataFile = process.env.CONTENT_OPS_DATA || join(__dirname, "data.json");
const xhsDataFile = process.env.XHS_MEDIA_DATA || bundledXhsDataFile;
const xhsMediaPassword = process.env.XHS_MEDIA_PASSWORD || "xhs2026";
const xhsMediaAuthSecret = process.env.XHS_MEDIA_AUTH_SECRET || xhsMediaPassword;
const xhsMediaAuthCookie = "xhs_media_auth";
const wholesaleAdminUsername = process.env.WHOLESALE_ADMIN_USERNAME || "";
const wholesaleAdminPassword = process.env.WHOLESALE_ADMIN_PASSWORD || "";
const backupDir = join(dirname(dataFile), "backups");
const xhsBackupDir = join(dirname(xhsDataFile), "xhs-media-backups");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contentOpsStateId = process.env.CONTENT_OPS_STATE_ID || "default";
const xhsMediaStateId = process.env.XHS_MEDIA_STATE_ID || `${contentOpsStateId}-xhs-media`;
const args = new Map(process.argv.slice(2).map((item, index, all) => item.startsWith("--") ? [item.slice(2), all[index + 1]] : [item, true]));
const host = args.get("host") || process.env.HOST || "0.0.0.0";
const port = Number(args.get("port") || process.env.PORT || 4322);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-Match, X-Client-Id",
};

function xhsAuthToken() {
  return createHmac("sha256", xhsMediaAuthSecret).update(`xhs-media:${xhsMediaPassword}`).digest("hex");
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        if (separator === -1) return [decodeURIComponent(item), ""];
        return [decodeURIComponent(item.slice(0, separator)), decodeURIComponent(item.slice(separator + 1))];
      })
  );
}

function hasXhsAuth(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  return safeEqual(cookies[xhsMediaAuthCookie], xhsAuthToken());
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw Object.assign(new Error("提交内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function ensureDataFile() {
  try {
    await stat(dataFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(dirname(dataFile), { recursive: true });
    await writeFile(dataFile, JSON.stringify({ titles: [], accounts: [], posts: [], updatedAt: new Date().toISOString() }, null, 2));
  }
}

async function backupDataFile() {
  await backupFile(dataFile, backupDir, "data");
}

async function backupFile(filePath, targetDir, prefix) {
  try {
    const current = await readFile(filePath, "utf8");
    await mkdir(targetDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name=hasSupabaseStateStore()?`${prefix}-daily-${stamp.slice(0,10)}.json`:`${prefix}-${stamp}-${randomUUID()}.json`;
    await writeFile(join(targetDir, name), current,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Could not create data backup: ${error.message}`);
    }
  }
}

function hasSupabaseStateStore() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function validContentOpsState(parsed) {
  return parsed &&
    Array.isArray(parsed.titles) &&
    Array.isArray(parsed.accounts) &&
    Array.isArray(parsed.posts);
}

async function readFileState() {
  await ensureDataFile();
  return JSON.parse(await readFile(dataFile, "utf8"));
}

async function writeFileState(state) {
  await mkdir(dirname(dataFile), { recursive: true });
  await backupDataFile();
  const temporary = `${dataFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, dataFile);
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    signal:AbortSignal.timeout(20000),
    ...options,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    console.warn(`Shared database returned HTTP ${response.status}`);
    throw new Error("共享数据库暂时不可用，请稍后重试");
  }
  return text ? JSON.parse(text) : null;
}

async function readContentOpsState() {
  if (!hasSupabaseStateStore()) return readFileState();
  const rows = await supabaseRequest(`/content_ops_state?id=eq.${encodeURIComponent(contentOpsStateId)}&select=state,updated_at`);
  if (Array.isArray(rows) && rows[0]?.state) return rows[0].state;

  const seed = await readFileState();
  if (!validContentOpsState(seed)) throw new Error("Seed data shape is invalid");
  return writeContentOpsState(seed, { preserveUpdatedAt: true });
}

let contentOpsWriteQueue = Promise.resolve();

function stateConflict(message = "共享数据已被其他人更新，请先同步后再保存") {
  return Object.assign(new Error(message), { status: 409 });
}

function writeContentOpsState(state, options = {}) {
  const pending = contentOpsWriteQueue.then(() => commitContentOpsState(state, options));
  contentOpsWriteQueue = pending.catch(() => {});
  return pending;
}

async function commitContentOpsState(state, options) {
  if (!options.operations && !validContentOpsState(state)) throw new Error("Invalid state shape");
  let current;
  let databaseVersion;
  if (hasSupabaseStateStore()) {
    const rows = await supabaseRequest(`/content_ops_state?id=eq.${encodeURIComponent(contentOpsStateId)}&select=state,updated_at`);
    current = rows?.[0]?.state;
    databaseVersion = rows?.[0]?.updated_at;
  } else {
    current = await readFileState();
  }
  // Bootstrapping must never replace a row created by another instance.
  if (options.preserveUpdatedAt && current) return current;
  if (!options.preserveUpdatedAt && (!current || !options.operations && current.updatedAt !== options.expectedUpdatedAt)) throw stateConflict();
  if(options.operations)state=RecordOps.apply(options.actor&&!options.system?publicState(current,options.actor):current,options.operations,contentShape,new Date().toISOString());
  if (options.actor) {
    const activeUser = current?._access?.users.find(user => user.id === options.actor.id && !user.disabled && user.sessionVersion === options.actor.sessionVersion);
    if (!activeUser) throw Object.assign(new Error("登录权限已变更，请重新登录"), { status: 401 });
  }
  const proposed = options.actor && !options.system ? scopedWrite(current, state, options.actor) : state;
  validateRows(proposed);
  if (!options.system && current && current.posts.length - proposed.posts.length > Math.max(5, Math.ceil(current.posts.length * 0.2))) {
    throw Object.assign(new Error("本次删除记录过多，已拦截以保护数据。请分批删除或联系管理员核对。"), { status: 422 });
  }
  const previousTime = Date.parse(current?.updatedAt || "") || 0;
  const nextState = {
    ...proposed,
    _access: options.system ? proposed._access : current?._access,
    _audit: current?._audit || [],
    updatedAt: options.preserveUpdatedAt ? state.updatedAt || new Date().toISOString()
      : new Date(Math.max(Date.now(), previousTime + 1)).toISOString(),
    clientUpdatedAt: state.clientUpdatedAt || state.updatedAt,
  };
  const audit = makeAudit(current, nextState, options);
  if (audit) nextState._audit = [...nextState._audit, audit];
  else if (current && !options.preserveUpdatedAt) return current;
  if (hasSupabaseStateStore()) {
    if (current) {
      // Keep history in the persistent database, independently of Render's filesystem.
      await supabaseRequest("/content_ops_state?on_conflict=id", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ id: `${contentOpsStateId}-history-${current.updatedAt}`, state: current, updated_at: current.updatedAt }),
      });
      const saved = await supabaseRequest(`/content_ops_state?id=eq.${encodeURIComponent(contentOpsStateId)}&updated_at=eq.${encodeURIComponent(databaseVersion)}`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ state: nextState, updated_at: nextState.updatedAt }),
      });
      if (!Array.isArray(saved) || !saved.length) throw stateConflict();
    } else {
      const created = await supabaseRequest("/content_ops_state?on_conflict=id", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ id: contentOpsStateId, state: nextState, updated_at: nextState.updatedAt }),
      });
      if (!created?.length) return (await readSupabaseStateRow(contentOpsStateId));
    }
    // A failed local mirror must not report a successfully committed database write as failed.
    await writeFileState(nextState).catch(error => console.warn(`Local mirror failed: ${error.message}`));
  } else {
    await writeFileState(nextState);
  }
  return nextState;
}

async function readSupabaseStateRow(id) {
  if (!hasSupabaseStateStore()) return null;
  const rows = await supabaseRequest(`/content_ops_state?id=eq.${encodeURIComponent(id)}&select=state,updated_at`);
  return Array.isArray(rows) && rows[0]?.state ? rows[0].state : null;
}

async function writeSupabaseStateRow(id, state, updatedAt) {
  if (!hasSupabaseStateStore()) return;
  await supabaseRequest("/content_ops_state?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      id,
      state,
      updated_at: updatedAt || state.updatedAt || new Date().toISOString(),
    }),
  });
}

function emptyXhsState() {
  return { creators: [], placements: [], customCreatorTypes: [], monthlyBudgets: {}, updatedAt: new Date().toISOString() };
}

async function restoreLatestXhsBackup() {
  try {
    const files = (await readdir(xhsBackupDir))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse();
    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(join(xhsBackupDir, file), "utf8"));
        if (!validXhsState(parsed) || !hasUsefulXhsState(parsed)) continue;
        await mkdir(dirname(xhsDataFile), { recursive: true });
        await writeFile(xhsDataFile, JSON.stringify(parsed, null, 2));
        console.warn(`Restored XHS data from backup ${file}`);
        return parsed;
      } catch (error) {
        console.warn(`Could not restore XHS backup ${file}: ${error.message}`);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`Could not inspect XHS backups: ${error.message}`);
  }
  return null;
}

async function ensureXhsDataFile() {
  try {
    await stat(xhsDataFile);
  } catch {
    const restored = await restoreLatestXhsBackup();
    if (restored) return;
    if (process.env.XHS_MEDIA_DATA) {
      throw new Error("XHS media data file is missing and no non-empty backup is available; restore data before serving");
    }
    let initial = emptyXhsState();
    const seedFiles = [bundledXhsDataFile, join(xhsPublicDir, "current-data.json")];
    for (const source of seedFiles) {
      try {
        const parsed = JSON.parse(await readFile(source, "utf8"));
        initial = {
          creators: Array.isArray(parsed.creators) ? parsed.creators : [],
          placements: Array.isArray(parsed.placements) ? parsed.placements : [],
          customCreatorTypes: Array.isArray(parsed.customCreatorTypes) ? parsed.customCreatorTypes : [],
          monthlyBudgets: parsed.monthlyBudgets && typeof parsed.monthlyBudgets === "object" && !Array.isArray(parsed.monthlyBudgets) ? parsed.monthlyBudgets : {},
          updatedAt: new Date().toISOString(),
        };
        break;
      } catch (error) {
        console.warn(`Could not seed XHS data from ${source}: ${error.message}`);
      }
    }
    await mkdir(dirname(xhsDataFile), { recursive: true });
    await writeFile(xhsDataFile, JSON.stringify(initial, null, 2));
  }
}

function validXhsState(parsed) {
  return parsed &&
    Array.isArray(parsed.creators) &&
    Array.isArray(parsed.placements) &&
    (!parsed.customCreatorTypes || Array.isArray(parsed.customCreatorTypes)) &&
    (!parsed.monthlyBudgets || (typeof parsed.monthlyBudgets === "object" && !Array.isArray(parsed.monthlyBudgets)));
}

function xhsStateCounts(state) {
  return {
    creators: Array.isArray(state?.creators) ? state.creators.length : 0,
    placements: Array.isArray(state?.placements) ? state.placements.length : 0,
  };
}

function hasUsefulXhsState(state) {
  const counts = xhsStateCounts(state);
  return counts.creators > 0 || counts.placements > 0;
}

function isDangerousXhsOverwrite(nextState, currentState) {
  const next = xhsStateCounts(nextState);
  const current = xhsStateCounts(currentState);
  if (!hasUsefulXhsState(nextState)) return true;
  if (!hasUsefulXhsState(currentState)) return false;
  if (current.creators >= 50 && next.creators < Math.floor(current.creators * 0.5)) return true;
  if (current.placements >= 10 && next.placements < Math.floor(current.placements * 0.5)) return true;
  return false;
}

function compactKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function rowKey(row, fallbackFields = []) {
  const id = compactKey(row?.id);
  if (id) return id;
  for (const field of fallbackFields) {
    const value = compactKey(row?.[field]);
    if (value) return `${field}:${value}`;
  }
  return "";
}

function rowTime(row) {
  const parsed = Date.parse(row?.updatedAt || row?.clientUpdatedAt || row?.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeValue(currentValue, incomingValue) {
  if (Array.isArray(currentValue) || Array.isArray(incomingValue)) {
    return Array.from(new Set([...(Array.isArray(currentValue) ? currentValue : []), ...(Array.isArray(incomingValue) ? incomingValue : [])].filter((item) => item !== "" && item !== null && item !== undefined)));
  }
  if (isPlainObject(currentValue) || isPlainObject(incomingValue)) {
    return mergePlainObject(currentValue, incomingValue);
  }
  if (typeof incomingValue === "boolean") return incomingValue;
  if (typeof currentValue === "boolean") return currentValue;
  if (typeof incomingValue === "number" || typeof currentValue === "number") {
    const incomingNumber = Number(incomingValue);
    const currentNumber = Number(currentValue);
    if (Number.isFinite(incomingNumber) && incomingNumber !== 0) return incomingNumber;
    if (Number.isFinite(currentNumber) && currentNumber !== 0) return currentNumber;
    if (Number.isFinite(incomingNumber)) return incomingNumber;
    return Number.isFinite(currentNumber) ? currentNumber : 0;
  }
  const incomingText = String(incomingValue ?? "").trim();
  const currentText = String(currentValue ?? "").trim();
  const placeholderValues = new Set(["未分类", "未填写", "请选择", "未命名达人", "undefined", "null"]);
  if (incomingText && (!placeholderValues.has(incomingText) || !currentText || placeholderValues.has(currentText))) return incomingValue;
  if (currentText) return currentValue;
  return incomingValue ?? currentValue ?? "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeRecord(current = {}, incoming = {}) {
  const currentTime = rowTime(current);
  const incomingTime = rowTime(incoming);
  const primary = incomingTime >= currentTime ? incoming : current;
  const secondary = incomingTime >= currentTime ? current : incoming;
  const keys = new Set([...Object.keys(secondary || {}), ...Object.keys(primary || {})]);
  const merged = {};
  for (const key of keys) merged[key] = mergeValue(secondary?.[key], primary?.[key]);
  if (currentTime || incomingTime) {
    merged.updatedAt = new Date(Math.max(currentTime, incomingTime)).toISOString();
  }
  return merged;
}

function mergeRows(currentRows, incomingRows, keyFields = []) {
  const result = [];
  const byKey = new Map();
  for (const row of Array.isArray(currentRows) ? currentRows : []) {
    const key = rowKey(row, keyFields);
    if (!key) {
      result.push(row);
      continue;
    }
    byKey.set(key, row);
  }
  for (const row of Array.isArray(incomingRows) ? incomingRows : []) {
    const key = rowKey(row, keyFields);
    if (!key) {
      result.push(row);
      continue;
    }
    byKey.set(key, byKey.has(key) ? mergeRecord(byKey.get(key), row) : row);
  }
  return [...byKey.values(), ...result];
}

function mergeXhsStates(currentState, incomingState) {
  if (!hasUsefulXhsState(currentState)) return incomingState;
  if (!hasUsefulXhsState(incomingState)) return currentState;
  return {
    ...currentState,
    ...incomingState,
    creators: mergeRows(currentState.creators, incomingState.creators, ["name"]),
    placements: mergeRows(currentState.placements, incomingState.placements, ["creator", "product", "noteTitle"]),
    customCreatorTypes: Array.from(new Set([...(currentState.customCreatorTypes || []), ...(incomingState.customCreatorTypes || [])].filter(Boolean))),
    monthlyBudgets: {
      ...(currentState.monthlyBudgets || {}),
      ...(incomingState.monthlyBudgets || {}),
    },
  };
}

function mergePlainObject(currentValue, incomingValue) {
  const currentObject = isPlainObject(currentValue) ? currentValue : {};
  const incomingObject = isPlainObject(incomingValue) ? incomingValue : {};
  const keys = new Set([...Object.keys(currentObject), ...Object.keys(incomingObject)]);
  const merged = {};
  for (const key of keys) merged[key] = mergeValue(currentObject[key], incomingObject[key]);
  return merged;
}

function mergeContentOpsStates(currentState, incomingState) {
  if (!validContentOpsState(currentState)) return incomingState;
  if (!validContentOpsState(incomingState)) return currentState;
  return {
    ...currentState,
    ...incomingState,
    titles: mergeRows(currentState.titles, incomingState.titles, ["title", "sourceUrl"]),
    accounts: mergeRows(currentState.accounts, incomingState.accounts, ["name", "platform"]),
    posts: mergeRows(currentState.posts, incomingState.posts, ["headline", "publishedAt", "scheduledAt"]),
    products: mergeRows(currentState.products, incomingState.products, ["sku", "wholesaleId", "name"]),
    inventorySettings: mergePlainObject(currentState.inventorySettings, incomingState.inventorySettings),
  };
}

async function readXhsStateFile(options = {}) {
  try {
    await ensureXhsDataFile();
  } catch (error) {
    if (options.allowEmpty) return emptyXhsState();
    throw error;
  }
  const parsed = JSON.parse(await readFile(xhsDataFile, "utf8"));
  if (hasUsefulXhsState(parsed)) return parsed;
  const restored = await restoreLatestXhsBackup();
  if (restored) return restored;
  if (options.allowEmpty) return parsed;
  throw new Error("XHS media data is empty; restore data before serving");
}

async function readXhsStateStore(options = {}) {
  if (hasSupabaseStateStore()) {
    const remoteState = await readSupabaseStateRow(xhsMediaStateId);
    if (validXhsState(remoteState) && hasUsefulXhsState(remoteState)) return remoteState;
    if (validXhsState(remoteState) && options.allowEmpty) return remoteState;
  }
  return readXhsStateFile(options);
}

async function writeXhsStateStore(state) {
  const incomingState = {
    ...state,
    customCreatorTypes: Array.isArray(state.customCreatorTypes) ? state.customCreatorTypes : [],
    monthlyBudgets: state.monthlyBudgets && typeof state.monthlyBudgets === "object" && !Array.isArray(state.monthlyBudgets) ? state.monthlyBudgets : {},
    updatedAt: new Date().toISOString(),
  };
  if (!validXhsState(incomingState)) throw new Error("Invalid XHS media state shape");
  const currentState = await readXhsStateStore({ allowEmpty: true });
  const nextState = {
    ...mergeXhsStates(currentState, incomingState),
    updatedAt: incomingState.updatedAt,
    clientUpdatedAt: incomingState.clientUpdatedAt || currentState.clientUpdatedAt || incomingState.updatedAt,
  };
  await writeSupabaseStateRow(xhsMediaStateId, nextState, nextState.updatedAt);
  await mkdir(dirname(xhsDataFile), { recursive: true });
  await backupFile(xhsDataFile, xhsBackupDir, "xhs-media");
  await writeFile(xhsDataFile, JSON.stringify(nextState, null, 2));
  return nextState;
}

function parseProductsScript(source) {
  const match = String(source || "").match(/window\.PRODUCTS\s*=\s*(\[[\s\S]*?\]);?\s*$/);
  if (!match) throw new Error("Product data not found");
  return JSON.parse(match[1]);
}

function parseStockNumber(value) {
  const numbers = String(value || "").match(/\d+(?:\.\d+)?/g);
  if (!numbers) return 0;
  return numbers.reduce((sum, item) => sum + Number(item), 0);
}

function parseCostTerms(formula) {
  const expression = String(formula || "").replace(/^=/, "").trim();
  if (!expression || !/^[\d.+\-\s]+$/.test(expression)) return [];
  return expression.split("+").map((item) => Number(item.trim())).filter(Number.isFinite);
}

function normalizeCostComponents(components) {
  return Array.isArray(components) ? components.map((item, index) => ({
    id: String(item?.id || `cost-${index + 1}`),
    name: String(item?.name || `成本项 ${index + 1}`).trim() || `成本项 ${index + 1}`,
    amount: Number(item?.amount || 0),
  })) : [];
}

function unitCostFromRecord(record) {
  return normalizeCostComponents(record?.components).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function costFromSeed(seed) {
  if (!seed) return null;
  const shippingDeduction = 2;
  if (Array.isArray(seed.styles) && seed.styles.length) {
    const components = seed.styles.map(([name, amount], index) => ({
      id: `style-${index + 1}`,
      name: `${name || `款式 ${index + 1}`}（调整后）`,
      amount: Number(amount || 0) - shippingDeduction,
    }));
    return {
      unitCost: unitCostFromRecord({ components }),
      components,
      source: `${seed.source || "成本表"}；每款均已减单件运费 ¥${shippingDeduction}`,
      includedShippingCost: Number(seed.includedShippingCost || 0),
    };
  }
  const terms = parseCostTerms(seed.formula);
  const components = terms.length ? terms.map((amount, index) => ({
    id: `seed-${index + 1}`,
    name: index === 0 ? "产品主体/制作成本" : index === terms.length - 1 ? "原表单件运费" : `成本项 ${index + 1}`,
    amount,
  })) : [{ id: "seed-total", name: "表格成本（含单件运费）", amount: Number(seed.includedShippingCost || 0) }];
  components.push({ id: "shipping-adjustment", name: "运费减免调整", amount: -shippingDeduction });
  return {
    unitCost: unitCostFromRecord({ components }),
    components,
    source: seed.source || "成本表",
    includedShippingCost: Number(seed.includedShippingCost || 0),
  };
}

function inheritedCostSeed(seeds, code) {
  const seed = seeds?.[code];
  if (!seed) return null;
  if (seed.inherit && seeds[seed.inherit]) return { ...seeds[seed.inherit], ...seed, formula: seed.formula || seeds[seed.inherit].formula };
  return seed;
}

function productCostInfo(product, costSettings = {}, costSeeds = {}) {
  const saved = costSettings[product.id];
  if (saved && Array.isArray(saved.components)) {
    const components = normalizeCostComponents(saved.components);
    return {
      unitCost: unitCostFromRecord({ components }),
      components,
      source: saved.source || "订货后台成本设置",
      costConnected: true,
    };
  }
  const seedCost = costFromSeed(inheritedCostSeed(costSeeds, product.code));
  if (seedCost) return { ...seedCost, costConnected: true };
  return { unitCost: 0, components: [], source: "", costConnected: false };
}

async function loadWholesalePrivateData(baseUrl) {
  if (!wholesaleAdminUsername || !wholesaleAdminPassword) return { costSettings: {}, costSeeds: {}, customProducts: [], orders: [], connected: false, reason: "missing-credentials" };
  const loginResponse = await fetch(new URL("/api/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: wholesaleAdminUsername, password: wholesaleAdminPassword }),
  });
  if (!loginResponse.ok) return { costSettings: {}, costSeeds: {}, customProducts: [], orders: [], connected: false, reason: "login-failed" };
  const cookie = loginResponse.headers.getSetCookie?.().join("; ") || loginResponse.headers.get("set-cookie") || "";
  const bootstrapResponse = await fetch(new URL("/api/bootstrap", baseUrl), {
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!bootstrapResponse.ok) return { costSettings: {}, costSeeds: {}, customProducts: [], orders: [], connected: false, reason: "bootstrap-failed" };
  const payload = await bootstrapResponse.json();
  return {
    costSettings: payload.state?.mtm_wholesale_cost_settings_v1 || {},
    costSeeds: payload.costSeeds || {},
    customProducts: Array.isArray(payload.state?.mtm_wholesale_custom_products_v1) ? payload.state.mtm_wholesale_custom_products_v1 : [],
    orders: Array.isArray(payload.orders) ? payload.orders : [],
    connected: true,
    reason: "",
  };
}

function mergeWholesaleProducts(baseProducts = [], customProducts = []) {
  const rows = [...baseProducts, ...customProducts];
  return Array.from(rows.reduce((map, product) => {
    const key = String(product?.id || product?.code || product?.name || "").trim();
    if (!key) return map;
    map.set(key, product);
    return map;
  }, new Map()).values());
}

function mapContentCategory(category = "", name = "") {
  if (/箱包/.test(category)) return "箱包";
  if (/文创|文具|手帐/.test(category)) return "文创文具";
  if (/玩偶|挂件|盲盒|谷美|家居|饰品/.test(category)) return "毛绒玩具";
  if (/笔袋|书包|卡包|零钱包|化妆包|手提包|挎包|单肩包|痛包/.test(name)) return "箱包";
  if (/本|笔|卡套|钥匙扣|鼠标垫|夹|护照|杯|冰箱贴|吧唧/.test(name)) return "文创文具";
  return "毛绒玩具";
}

function normalizeWholesaleProduct(product, baseUrl, costInfo = {}) {
  const stockText = String(product.stockText || "").trim();
  const status = String(product.status || "需确认").trim();
  const stock = stockText ? parseStockNumber(stockText) : status === "有货" ? Number(product.packQty || 0) : 0;
  const asset = String(product.image || "").trim();
  return {
    id: `wholesale-${product.id || product.code}`,
    wholesaleId: String(product.id || ""),
    name: product.name || "未命名商品",
    category: mapContentCategory(product.category, product.name),
    sourceCategory: product.category || "",
    sku: product.code || "",
    stock,
    stockText: stockText || status,
    stockStatus: status,
    incomingStock: 0,
    priority: 5,
    selected: false,
    focusOrder: 0,
    price: product.price ?? "",
    unitCost: costInfo.unitCost || "",
    cost: costInfo.unitCost || "",
    costSource: costInfo.source || "",
    costConnected: Boolean(costInfo.costConnected),
    costComponents: costInfo.components || [],
    unit: product.unit || "件",
    packText: product.packText || "",
    specifications: product.specifications || "",
    sellingPoint: product.detailDescription || product.specifications || product.packText || "",
    backendUrl: `${baseUrl}/admin.html#${encodeURIComponent(product.id || product.code || "")}`,
    imageUrl: asset ? new URL(asset, `${baseUrl}/`).href : "",
    notes: product.expectedArrival ? `预计到货：${product.expectedArrival}` : "",
    syncedFrom: baseUrl,
    syncedAt: new Date().toISOString(),
  };
}

function send(response, status, body, headers = {}) {
  const payload=typeof body==='string'?body:JSON.stringify(body),compress=response.gzip&&payload.length>2048;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8",'Cache-Control':'no-store',...corsHeaders,...headers,...(compress?{'Content-Encoding':'gzip','Vary':'Accept-Encoding'}:{}) });
  if(compress)Readable.from([payload]).pipe(createGzip()).pipe(response);else response.end(payload);
}

function sendHtml(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

function authCookie(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const secure = forwardedProto === "https" ? "; Secure" : "";
  return `${xhsMediaAuthCookie}=${encodeURIComponent(xhsAuthToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

function clearAuthCookie() {
  return `${xhsMediaAuthCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function xhsLoginPage() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>馒头猫 · 团队登录</title><style>body{font:16px system-ui;background:#f3f6f5;color:#254b43;display:grid;place-items:center;min-height:90vh}form{width:min(380px,85vw);padding:30px;border-radius:18px;background:white}label{display:block;margin:18px 0}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;border:1px solid #cadbd4;border-radius:8px}button{background:#286457;color:white}p{line-height:1.7}#message{color:#9f4835}</style><form id="login"><h1>团队登录</h1><p>使用个人账号进入博主投放系统。客服、仓管与新媒体使用同一套账号，权限按岗位分配。</p><label>登录账号<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><button>登录</button><p id="message" role="alert"></p><a href="/stock-ops/">进入经营协作台</a></form><script>
  const allowed=u=>u.role==='admin'||['pr','pr_service'].includes(u.stockRole);
  fetch('/api/content-ops/session',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(s=>{if(s&&allowed(s.user))location.replace('/xhs-media/')}).catch(()=>{});
  document.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const r=await fetch('/api/content-ops/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}),s=await r.json();if(!r.ok)throw Error(s.error||'登录失败');if(!allowed(s.user))throw Error('当前账号没有PR权限，请进入经营协作台或联系管理员');location.replace('/xhs-media/')}catch(err){document.querySelector('#message').textContent=err.message}finally{b.disabled=false}};
  </script></html>`;
}
async function requireXhsAuth(request,response) {
  const url=new URL(request.url,`http://${request.headers.host}`);
  if(!url.pathname.startsWith('/xhs-media')&&!url.pathname.startsWith('/api/xhs-media/'))return false;
  if(url.pathname==='/xhs-media/login')return false;
  if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host||request.headers['sec-fetch-site']==='cross-site')throw fail(403,'不允许跨网站访问');
  try{const user=await access.requireUser(request);if(!hasStockRole(user,'admin','pr'))throw fail(403,'此账号没有PR权限；请在经营协作台查看获授权的库存与售后');request.xhsUser=user;return false;}
  catch(e){if(e.status===401&&!url.pathname.startsWith('/api/')){response.writeHead(302,{Location:'/xhs-media/login','Cache-Control':'no-store'});response.end();return true;}throw e;}
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  response.setHeader('Cache-Control','no-store');
  if (url.pathname === '/stock-ops') { response.writeHead(302,{Location:'/stock-ops/'});response.end();return; }
  if (url.pathname.startsWith('/stock-ops/')) response.setHeader('Cache-Control','no-store');
  if (url.pathname === "/assets/styles" || url.pathname === "/assets/app") {
    const isStyles = url.pathname === "/assets/styles";
    const filePath = join(publicDir, isStyles ? "styles.css" : "app.js");
    response.writeHead(200, { "Content-Type": isStyles ? mime[".css"] : mime[".js"] });
    createReadStream(filePath).pipe(response);
    return;
  }
  if (url.pathname === "/xhs-media") {
    response.writeHead(302, { Location: "/xhs-media/" });
    response.end();
    return;
  }
  const isXhsMedia = url.pathname.startsWith("/xhs-media/");
  const isStock = url.pathname.startsWith('/stock-ops/');
  const baseDir = isStock ? stockPublicDir : isXhsMedia ? xhsPublicDir : publicDir;
  const requestPath = isStock ? url.pathname.replace(/^\/stock-ops/, '') || '/index.html' : isXhsMedia
    ? url.pathname.replace(/^\/xhs-media/, "") || "/index.html"
    : url.pathname === "/" ? "/index.html" : url.pathname;
  const clean = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const target = resolve(baseDir, `.${clean}`);
  if (!target.startsWith(baseDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const fileStat = await stat(target);
    const filePath = fileStat.isDirectory() ? join(target, "index.html") : target;
    response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function readAccessOnly() {
  if (!hasSupabaseStateStore()) return readFileState();
  const rows = await supabaseRequest(`/content_ops_state?id=eq.${encodeURIComponent(contentOpsStateId)}&select=access:state->_access`);
  return { _access: rows?.[0]?.access };
}

async function readContentOpsVersion() {
  if (!hasSupabaseStateStore()) return (await readFileState()).updatedAt;
  const rows = await supabaseRequest(`/content_ops_state?id=eq.${encodeURIComponent(contentOpsStateId)}&select=updated_at`);
  return rows?.[0]?.updated_at ? new Date(rows[0].updated_at).toISOString() : null;
}

const access = createAccessControl({ read: readContentOpsState, readAccess: readAccessOnly, write: writeContentOpsState });
const xhsStore=createXhsStore({file:xhsDataFile,remote:hasSupabaseStateStore()?supabaseRequest:null,stateId:xhsMediaStateId});
const stockStore = createStockStore({file:process.env.STOCK_OPS_DATA || join(dirname(dataFile),'stock-ops-data.json'),remote:hasSupabaseStateStore()?supabaseRequest:null,stateId:process.env.STOCK_OPS_STATE_ID || `${contentOpsStateId}-stock-ops`});
const costFilesDir=process.env.STOCK_OPS_FILES_DIR || join(dirname(process.env.STOCK_OPS_DATA || dataFile),'stock-ops-cost-files');
const purchaseFiles=createPurchaseFiles({dir:join(costFilesDir,'purchase-contracts'),readState:()=>stockStore.read()});

const server = createServer(async (request, response) => {
  try {
    response.gzip=/\bgzip\b/.test(request.headers['accept-encoding']||'');
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith('/api/stock-ops/')) {
      response.setHeader('Cache-Control','no-store');
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host || request.headers['sec-fetch-site']==='cross-site') throw fail(403,'不允许跨网站访问');
      const user=await access.requireUser(request);
      if(roleOf(user)==='none')throw fail(403,'请管理员分配经营协作权限');
      if(url.pathname==='/api/stock-ops/purchase-contract'){await purchaseFiles.handle(request,response,url,user,send);return;}
      if(url.pathname==='/api/stock-ops/storage'&&request.method==='GET'){
        if(user.role!=='admin')throw fail(403,'仅管理员可查看存储信息');
        await mkdir(costFilesDir,{recursive:true});const disk=await statfs(costFilesDir);
        send(response,200,{totalBytes:disk.blocks*disk.bsize,availableBytes:disk.bavail*disk.bsize,warning:disk.bavail/disk.blocks<0.2,structuredData:hasSupabaseStateStore()?'Supabase':'服务器文件',attachmentPath:costFilesDir});return;
      }
      if(url.pathname==='/api/stock-ops/cost-file'){
        if(user.role!=='admin')throw fail(403,'成本原文件仅管理员可查看');
        const sha=url.searchParams.get('sha');if(!/^[a-f0-9]{64}$/.test(sha||''))throw fail(400,'文件校验码无效');
        const target=join(costFilesDir,`${sha}.xlsx`);
        if(request.method==='GET'){
          let info;try{info=await stat(target)}catch(e){if(e.code==='ENOENT')throw fail(404,'成本数据已导入，但完整Excel原件尚未上传');throw e;}
          response.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Length':info.size,'Content-Disposition':`attachment; filename="cost-master.xlsx"; filename*=UTF-8''${encodeURIComponent('馒头猫_SKU成本主表原件.xlsx')}`});createReadStream(target).pipe(response);return;
        }
        if(request.method==='POST'){
          if(request.headers['content-type']!=='application/octet-stream')throw fail(415,'请直接上传Excel文件');
          await mkdir(costFilesDir,{recursive:true});const temp=join(costFilesDir,`${randomUUID()}.tmp`),handle=await open(temp,'wx');
          const capacity=await statfs(costFilesDir);if(capacity.bavail*capacity.bsize<180*1024*1024){await handle.close();await unlink(temp);throw fail(507,'附件存储空间不足，管理员扩容后再上传；已有资料仍保留');}
          const hash=createHash('sha256');let size=0;
          try{for await(const chunk of request){size+=chunk.length;if(size>160*1024*1024)throw fail(413,'成本原件不能超过160MB');hash.update(chunk);let offset=0;while(offset<chunk.length){const {bytesWritten}=await handle.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw fail(500,'成本原件写入失败');offset+=bytesWritten;}}
            await handle.close();if(hash.digest('hex')!==sha)throw fail(400,'上传文件与成本导入资料不一致，请核对版本');await rename(temp,target);send(response,200,{ok:true,sha256:sha,bytes:size});return;
          }catch(e){await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});throw e;}
        }
        throw fail(405,'Method not allowed');
      }
      if(url.pathname==='/api/stock-ops/version'&&request.method==='GET'){send(response,200,{updatedAt:await stockStore.version(),build:BUILD_ID});return;}
      if(url.pathname==='/api/stock-ops/state'&&request.method==='GET'){send(response,200,stockView(await stockStore.read(),user));return;}
      if(url.pathname==='/api/stock-ops/samples'&&request.method==='GET'){
        const state=await xhsStore.read();
        const placements=(state?.placements||[]).map(p=>({id:String(p.id),creator:String(p.creator||''),product:String(p.product||''),productIds:p.productIds||[p.productId].filter(Boolean),sampleQuantity:p.sampleQuantity===undefined||p.sampleQuantity===''?null:p.sampleQuantity,status:p.status||'',sampleStatus:p.sampleStatus||'',owner:p.owner||'',sampleDeliveredAt:p.sampleDeliveredAt||'',createdAt:p.createdAt||''}));
        send(response,200,{placements,updatedAt:state?.updatedAt||null});return;
      }
      if(url.pathname==='/api/stock-ops/command'&&request.method==='POST'){
        if(!String(request.headers['content-type']||'').startsWith('application/json'))throw fail(415,'请使用JSON请求');
        const command=JSON.parse(await readBody(request));
        if(command.data?.privateDetails!==undefined)await purchaseFiles.validate(user,command.data.privateDetails?.contracts||[]);
        const placements=command.action==='sample'?(await xhsStore.read())?.placements||[]:[];
        const result=await stockStore.commit(command,user,{placements});
        send(response,200,{ok:true,replayed:Boolean(result.replayed),state:stockView(result.state,user)});return;
      }
      throw fail(404,'经营接口不存在');
    }
    if (url.pathname.startsWith("/api/content-ops/")) response.setHeader("Cache-Control", "no-store");
    if (request.url?.startsWith("/api/health")) {
      send(response, 200, { ok: true, service: "content-ops",build:BUILD_ID,storage: hasSupabaseStateStore() ? "supabase" : "file", updatedAt: new Date().toISOString() });
      return;
    }
    if (url.pathname === '/xhs-media/login') {sendHtml(response,200,xhsLoginPage(),{'Cache-Control':'no-store'});return;}
    if (url.pathname === '/api/xhs-media/login') {throw fail(428,'已升级为个人登录，请刷新登录页面');}
    if (url.pathname === '/api/xhs-media/logout') {response.writeHead(307,{Location:'/api/content-ops/logout'});response.end();return;}
    if (await requireXhsAuth(request, response)) return;
    if (await access.handle(request, response, url, send, readBody)) return;
    if (request.url?.startsWith("/api/content-ops/work-auth")) {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (request.method !== "POST") {
        send(response, 405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" });
        return;
      }
      const body = await readBody(request);
      const parsed = body ? JSON.parse(body) : {};
      const user = request.contentOpsUser;
      const result = { ok: true, role: user.role, owner: user.role === "admin" ? "" : user.name };
      send(response, 200, result);
      return;
    }
    if (request.url?.startsWith("/api/content-ops/wholesale-products")) {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (request.method !== "GET") {
        send(response, 405, { error: "Method not allowed" }, { Allow: "GET, OPTIONS" });
        return;
      }
      const url = new URL(request.url, `http://${request.headers.host}`);
      const sourceUrl = url.searchParams.get("url") || "https://pupuhome-wholesale.onrender.com/admin.html";
      const baseUrl = new URL(sourceUrl).origin;
      if(baseUrl!=="https://pupuhome-wholesale.onrender.com")throw fail(400,"订货数据来源未获配置，请联系管理员");
      const productResponse = await fetch(new URL("/data/products.js", baseUrl));
      if (!productResponse.ok) throw new Error("Could not load wholesale products");
      const script = await productResponse.text();
      const privateData = request.contentOpsUser.role==='admin'?await loadWholesalePrivateData(baseUrl):{costSettings:{},costSeeds:{},customProducts:[],orders:[],connected:false,reason:"restricted"};
      const costSettings = privateData.costSettings || {};
      const costSeeds = privateData.costSeeds || {};
      const rawProducts = mergeWholesaleProducts(parseProductsScript(script), privateData.customProducts);
      const products = rawProducts.map((product) => normalizeWholesaleProduct(product, baseUrl, productCostInfo(product, costSettings, costSeeds)));
      send(response, 200, {
        products,
        sourceUrl,
        syncedAt: new Date().toISOString(),
        costConnected: privateData.connected,
        costConnectionReason: privateData.reason,
        customProductCount: privateData.customProducts.length,
        costSettingsCount: Object.keys(costSettings).length,
        costSeedCount: Object.keys(costSeeds).length,
        orderCount: privateData.orders.length,
      });
      return;
    }
    if (url.pathname === "/api/content-ops/version" && request.method === "GET") {
      send(response, 200, { updatedAt: await readContentOpsVersion() }, { "Cache-Control": "no-store" });
      return;
    }
    if (url.pathname === "/api/content-ops/state") {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (request.method === "GET") {
        send(response, 200, publicState(await readContentOpsState(), request.contentOpsUser), { "Cache-Control": "no-store" });
        return;
      }
      if(request.method==='PATCH'){
        const data=JSON.parse(await readBody(request));
        const saved=await writeContentOpsState(null,{operations:data.operations,actor:request.contentOpsUser,userAgent:request.headers['user-agent'],clientId:request.headers['x-client-id']});
        send(response,200,{ok:true,updatedAt:saved.updatedAt,state:publicState(saved,request.contentOpsUser),build:BUILD_ID});return;
      }
      if (request.method === "PUT") {
        const body = await readBody(request);
        const parsed = JSON.parse(body);
        if (!validContentOpsState(parsed)) {
          send(response, 400, { error: "Invalid state shape" });
          return;
        }
        const expectedUpdatedAt = request.headers["if-match"]?.replace(/^"|"$/g, "");
        if (!expectedUpdatedAt) {
          send(response, 428, { error: "页面版本过旧，请先导出本机备份，再刷新页面后保存" });
          return;
        }
        const saved = await writeContentOpsState(parsed, { expectedUpdatedAt, actor: request.contentOpsUser, userAgent: request.headers["user-agent"], clientId: request.headers["x-client-id"] });
        send(response, 200, { ok: true, updatedAt: saved.updatedAt, storage: hasSupabaseStateStore() ? "supabase" : "file" });
        return;
      }
      send(response, 405, { error: "Method not allowed" }, { Allow: "GET, PUT, OPTIONS" });
      return;
    }
    if(url.pathname==='/api/xhs-media/version'&&request.method==='GET'){send(response,200,{updatedAt:await xhsStore.version(),build:BUILD_ID});return;}
    if(url.pathname==='/api/xhs-media/session'&&request.method==='GET'){const u=request.xhsUser;send(response,200,{user:{id:u.id,name:u.name,username:u.username,role:u.role,stockRole:u.stockRole},build:BUILD_ID});return;}
    if(url.pathname==='/api/xhs-media/state'){
      if(request.method==='GET'){send(response,200,await xhsStore.read());return;}
      if(request.method==='PATCH'){
        if(!String(request.headers['content-type']||'').startsWith('application/json'))throw fail(415,'请使用JSON请求');
        const saved=await xhsStore.commit(JSON.parse(await readBody(request)),request.xhsUser);
        send(response,200,{ok:true,updatedAt:saved.updatedAt,state:publicXhs(saved),build:BUILD_ID});return;
      }
      throw fail(428,'此页面的保存方式已停用，请先导出未同步修改，再刷新页面；旧版本不能覆盖共享数据');
    }
    await serveStatic(request, response);
  } catch (error) {
    send(response, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error.message || "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Content Ops is running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`Shared data file: ${dataFile}`);
  console.log(`XHS media data file: ${xhsDataFile}`);
});
