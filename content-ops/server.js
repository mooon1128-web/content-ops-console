import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
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
const backupDir = join(dirname(dataFile), "backups");
const xhsBackupDir = join(dirname(xhsDataFile), "xhs-media-backups");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contentOpsStateId = process.env.CONTENT_OPS_STATE_ID || "default";
const args = new Map(process.argv.slice(2).map((item, index, all) => item.startsWith("--") ? [item.slice(2), all[index + 1]] : [item, true]));
const host = args.get("host") || process.env.HOST || "0.0.0.0";
const port = Number(args.get("port") || process.env.PORT || 4322);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
  const nextState = {
    ...state,
    updatedAt: options.preserveUpdatedAt ? state.updatedAt || new Date().toISOString() : new Date().toISOString(),
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

async function ensureXhsDataFile() {
  try {
    await stat(xhsDataFile);
  } catch {
    let initial = { creators: [], placements: [], customCreatorTypes: [], updatedAt: new Date().toISOString() };
    const seedFiles = [bundledXhsDataFile, join(xhsPublicDir, "current-data.json")];
    for (const source of seedFiles) {
      try {
        const parsed = JSON.parse(await readFile(source, "utf8"));
        initial = {
          creators: Array.isArray(parsed.creators) ? parsed.creators : [],
          placements: Array.isArray(parsed.placements) ? parsed.placements : [],
          customCreatorTypes: Array.isArray(parsed.customCreatorTypes) ? parsed.customCreatorTypes : [],
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
    (!parsed.customCreatorTypes || Array.isArray(parsed.customCreatorTypes));
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
  if (!hasUsefulXhsState(currentState)) return false;
  if (!hasUsefulXhsState(nextState)) return true;
  if (current.creators >= 50 && next.creators < Math.floor(current.creators * 0.5)) return true;
  if (current.placements >= 10 && next.placements < Math.floor(current.placements * 0.5)) return true;
  return false;
}

async function readXhsStateFile() {
  await ensureXhsDataFile();
  return JSON.parse(await readFile(xhsDataFile, "utf8"));
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

function mapContentCategory(category = "", name = "") {
  if (/箱包/.test(category)) return "箱包";
  if (/文创|文具|手帐/.test(category)) return "文创文具";
  if (/玩偶|挂件|盲盒|谷美|家居|饰品/.test(category)) return "毛绒玩具";
  if (/笔袋|书包|卡包|零钱包|化妆包|手提包|挎包|单肩包|痛包/.test(name)) return "箱包";
  if (/本|笔|卡套|钥匙扣|鼠标垫|夹|护照|杯|冰箱贴|吧唧/.test(name)) return "文创文具";
  return "毛绒玩具";
}

function normalizeWholesaleProduct(product, baseUrl) {
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
      const products = parseProductsScript(script).map((product) => normalizeWholesaleProduct(product, baseUrl));
      send(response, 200, { products, sourceUrl, syncedAt: new Date().toISOString() });
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
        send(response, 200, await readXhsStateFile(), { "Cache-Control": "no-store" });
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
        parsed.updatedAt = new Date().toISOString();
        const current = await readXhsStateFile();
        if (isDangerousXhsOverwrite(parsed, current)) {
          send(response, 409, {
            error: "Refusing to overwrite existing XHS media data with empty or much smaller state",
            current: xhsStateCounts(current),
            incoming: xhsStateCounts(parsed),
          });
          return;
        }
        await mkdir(dirname(xhsDataFile), { recursive: true });
        await backupFile(xhsDataFile, xhsBackupDir, "xhs-media");
        await writeFile(xhsDataFile, JSON.stringify(parsed, null, 2));
        send(response, 200, { ok: true, updatedAt: parsed.updatedAt });
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
