import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = join(root, "public", "content-ops");
const xhsPublicDir = join(root, "public", "xhs-media");
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
  "Access-Control-Allow-Headers": "Content-Type",
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
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function ensureDataFile() {
  try {
    await stat(dataFile);
  } catch {
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
    await writeFile(join(targetDir, `${prefix}-${stamp}.json`), current);
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
  await writeFile(dataFile, JSON.stringify(state, null, 2));
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
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
    throw new Error(`Supabase ${response.status}: ${text || response.statusText}`);
  }
  return text ? JSON.parse(text) : null;
}

async function readContentOpsState() {
  if (!hasSupabaseStateStore()) return readFileState();
  const rows = await supabaseRequest(`/content_ops_state?id=eq.${encodeURIComponent(contentOpsStateId)}&select=state,updated_at`);
  if (Array.isArray(rows) && rows[0]?.state) return rows[0].state;

  const seed = await readFileState();
  if (!validContentOpsState(seed)) throw new Error("Seed data shape is invalid");
  await writeContentOpsState(seed, { preserveUpdatedAt: true });
  return seed;
}

async function writeContentOpsState(state, options = {}) {
  const incomingState = {
    ...state,
    updatedAt: options.preserveUpdatedAt ? state.updatedAt || new Date().toISOString() : new Date().toISOString(),
  };
  if (!validContentOpsState(incomingState)) throw new Error("Invalid state shape");
  const currentState = hasSupabaseStateStore()
    ? await readSupabaseStateRow(contentOpsStateId)
    : await readFileState().catch(() => null);
  const nextState = {
    ...mergeContentOpsStates(currentState, incomingState),
    updatedAt: incomingState.updatedAt,
    clientUpdatedAt: incomingState.clientUpdatedAt || currentState?.clientUpdatedAt || incomingState.updatedAt,
  };
  if (!validContentOpsState(nextState)) throw new Error("Invalid state shape");
  if (hasSupabaseStateStore()) {
    await supabaseRequest("/content_ops_state?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        id: contentOpsStateId,
        state: nextState,
        updated_at: nextState.updatedAt,
      }),
    });
  }
  await writeFileState(nextState);
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
  if (!wholesaleAdminUsername || !wholesaleAdminPassword) return { costSettings: {}, costSeeds: {}, orders: [], connected: false, reason: "missing-credentials" };
  const loginResponse = await fetch(new URL("/api/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: wholesaleAdminUsername, password: wholesaleAdminPassword }),
  });
  if (!loginResponse.ok) return { costSettings: {}, costSeeds: {}, orders: [], connected: false, reason: "login-failed" };
  const cookie = loginResponse.headers.getSetCookie?.().join("; ") || loginResponse.headers.get("set-cookie") || "";
  const bootstrapResponse = await fetch(new URL("/api/bootstrap", baseUrl), {
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!bootstrapResponse.ok) return { costSettings: {}, costSeeds: {}, orders: [], connected: false, reason: "bootstrap-failed" };
  const payload = await bootstrapResponse.json();
  return {
    costSettings: payload.state?.mtm_wholesale_cost_settings_v1 || {},
    costSeeds: payload.costSeeds || {},
    orders: Array.isArray(payload.orders) ? payload.orders : [],
    connected: true,
    reason: "",
  };
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
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders, ...headers });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
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

function xhsLoginPage(errorText = "") {
  const error = errorText ? `<p class="error">${errorText}</p>` : "";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>小红书媒介投放跟踪台 - 登录</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f6f3ef;
        color: #24201c;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      }
      main {
        width: min(420px, calc(100vw - 32px));
        background: #fffaf4;
        border: 1px solid #e5ddd2;
        border-radius: 8px;
        padding: 28px;
        box-shadow: 0 18px 60px rgba(44, 36, 28, 0.14);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
        line-height: 1.25;
      }
      p {
        margin: 0 0 22px;
        color: #74695f;
        line-height: 1.6;
      }
      label {
        display: block;
        margin-bottom: 8px;
        color: #51483f;
        font-size: 14px;
        font-weight: 600;
      }
      input {
        width: 100%;
        height: 44px;
        border: 1px solid #cfc5b9;
        border-radius: 6px;
        padding: 0 12px;
        font-size: 16px;
        background: #fff;
        color: #24201c;
      }
      input:focus {
        outline: 2px solid rgba(190, 65, 65, 0.22);
        border-color: #b84b46;
      }
      button {
        width: 100%;
        height: 44px;
        margin-top: 16px;
        border: 0;
        border-radius: 6px;
        background: #b84b46;
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
      }
      button:disabled {
        cursor: wait;
        opacity: 0.72;
      }
      .error {
        margin: 12px 0 0;
        color: #a22c2c;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>小红书媒介投放跟踪台</h1>
      <p>请输入内部访问密码。</p>
      <form id="login-form">
        <label for="password">访问密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
        <button type="submit">登录</button>
        ${error}
      </form>
    </main>
    <script>
      const form = document.querySelector("#login-form");
      const button = form.querySelector("button");
      let error = document.querySelector(".error");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        button.disabled = true;
        button.textContent = "登录中...";
        try {
          const response = await fetch("/api/xhs-media/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: form.password.value })
          });
          if (!response.ok) throw new Error("密码不正确");
          location.href = "/xhs-media/";
        } catch (loginError) {
          if (!error) {
            error = document.createElement("p");
            error.className = "error";
            form.appendChild(error);
          }
          error.textContent = loginError.message || "登录失败，请重试";
          button.disabled = false;
          button.textContent = "登录";
        }
      });
    </script>
  </body>
</html>`;
}

function requireXhsAuth(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const isLoginPage = url.pathname === "/xhs-media/login";
  const isLoginApi = url.pathname === "/api/xhs-media/login";
  const isXhsArea = url.pathname === "/xhs-media" || url.pathname.startsWith("/xhs-media/");
  const isXhsApi = url.pathname.startsWith("/api/xhs-media/");

  if (!isXhsArea && !isXhsApi) return false;
  if (isLoginPage || isLoginApi || request.method === "OPTIONS") return false;
  if (hasXhsAuth(request)) return false;

  if (isXhsApi) {
    send(response, 401, { error: "Unauthorized" });
    return true;
  }
  response.writeHead(302, { Location: "/xhs-media/login" });
  response.end();
  return true;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
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
  const baseDir = isXhsMedia ? xhsPublicDir : publicDir;
  const requestPath = isXhsMedia
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (request.url?.startsWith("/api/health")) {
      send(response, 200, { ok: true, service: "content-ops", storage: hasSupabaseStateStore() ? "supabase" : "file", updatedAt: new Date().toISOString() });
      return;
    }
    if (url.pathname === "/xhs-media/login") {
      if (hasXhsAuth(request)) {
        response.writeHead(302, { Location: "/xhs-media/" });
        response.end();
        return;
      }
      sendHtml(response, 200, xhsLoginPage());
      return;
    }
    if (url.pathname === "/api/xhs-media/login") {
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
      if (!safeEqual(parsed.password || "", xhsMediaPassword)) {
        send(response, 401, { error: "密码不正确" });
        return;
      }
      send(response, 200, { ok: true }, { "Set-Cookie": authCookie(request) });
      return;
    }
    if (url.pathname === "/api/xhs-media/logout") {
      send(response, 200, { ok: true }, { "Set-Cookie": clearAuthCookie() });
      return;
    }
    if (requireXhsAuth(request, response)) return;
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
      const productResponse = await fetch(new URL("/data/products.js", baseUrl));
      if (!productResponse.ok) throw new Error("Could not load wholesale products");
      const script = await productResponse.text();
      const privateData = await loadWholesalePrivateData(baseUrl);
      const costSettings = privateData.costSettings || {};
      const costSeeds = privateData.costSeeds || {};
      const products = parseProductsScript(script).map((product) => normalizeWholesaleProduct(product, baseUrl, productCostInfo(product, costSettings, costSeeds)));
      send(response, 200, {
        products,
        sourceUrl,
        syncedAt: new Date().toISOString(),
        costConnected: privateData.connected,
        costConnectionReason: privateData.reason,
        costSettingsCount: Object.keys(costSettings).length,
        costSeedCount: Object.keys(costSeeds).length,
        orderCount: privateData.orders.length,
      });
      return;
    }
    if (request.url?.startsWith("/api/content-ops/state")) {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (request.method === "GET") {
        send(response, 200, await readContentOpsState(), { "Cache-Control": "no-store" });
        return;
      }
      if (request.method === "PUT") {
        const body = await readBody(request);
        const parsed = JSON.parse(body);
        if (!validContentOpsState(parsed)) {
          send(response, 400, { error: "Invalid state shape" });
          return;
        }
        const saved = await writeContentOpsState(parsed);
        send(response, 200, { ok: true, updatedAt: saved.updatedAt, storage: hasSupabaseStateStore() ? "supabase" : "file" });
        return;
      }
      send(response, 405, { error: "Method not allowed" }, { Allow: "GET, PUT, OPTIONS" });
      return;
    }
    if (request.url?.startsWith("/api/xhs-media/state")) {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (request.method === "GET") {
        send(response, 200, await readXhsStateStore({ allowEmpty: true }), { "Cache-Control": "no-store" });
        return;
      }
      if (request.method === "PUT") {
        const body = await readBody(request);
        const parsed = JSON.parse(body);
        if (!validXhsState(parsed)) {
          send(response, 400, { error: "Invalid XHS media state shape" });
          return;
        }
        parsed.customCreatorTypes = parsed.customCreatorTypes || [];
        parsed.monthlyBudgets = parsed.monthlyBudgets && typeof parsed.monthlyBudgets === "object" && !Array.isArray(parsed.monthlyBudgets) ? parsed.monthlyBudgets : {};
        const current = await readXhsStateStore({ allowEmpty: true });
        if (isDangerousXhsOverwrite(parsed, current)) {
          send(response, 409, {
            error: "Refusing to overwrite existing XHS media data with empty or much smaller state",
            current: xhsStateCounts(current),
            incoming: xhsStateCounts(parsed),
          });
          return;
        }
        const saved = await writeXhsStateStore(parsed);
        send(response, 200, { ok: true, updatedAt: saved.updatedAt, storage: hasSupabaseStateStore() ? "supabase" : "file" });
        return;
      }
      send(response, 405, { error: "Method not allowed" }, { Allow: "GET, PUT, OPTIONS" });
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    send(response, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Content Ops is running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`Shared data file: ${dataFile}`);
  console.log(`XHS media data file: ${xhsDataFile}`);
});
