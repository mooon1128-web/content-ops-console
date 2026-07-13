import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = join(root, "public", "content-ops");
const dataFile = process.env.CONTENT_OPS_DATA || join(__dirname, "data.json");
const backupDir = join(dirname(dataFile), "backups");
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
  try {
    const current = await readFile(dataFile, "utf8");
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(join(backupDir, `data-${stamp}.json`), current);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Could not create data backup: ${error.message}`);
    }
  }
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

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const clean = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const target = resolve(publicDir, `.${clean}`);
  if (!target.startsWith(publicDir)) {
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
    if (request.url?.startsWith("/api/health")) {
      send(response, 200, { ok: true, service: "content-ops", updatedAt: new Date().toISOString() });
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
      const productResponse = await fetch(new URL("/data/products.js", baseUrl));
      if (!productResponse.ok) throw new Error("Could not load wholesale products");
      const script = await productResponse.text();
      const products = parseProductsScript(script).map((product) => normalizeWholesaleProduct(product, baseUrl));
      send(response, 200, { products, sourceUrl, syncedAt: new Date().toISOString() });
      return;
    }
    if (request.url?.startsWith("/api/content-ops/state")) {
      await ensureDataFile();
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders });
        createReadStream(dataFile).pipe(response);
        return;
      }
      if (request.method === "PUT") {
        const body = await readBody(request);
        const parsed = JSON.parse(body);
        if (!Array.isArray(parsed.titles) || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.posts)) {
          send(response, 400, { error: "Invalid state shape" });
          return;
        }
        parsed.updatedAt = new Date().toISOString();
        await mkdir(dirname(dataFile), { recursive: true });
        await backupDataFile();
        await writeFile(dataFile, JSON.stringify(parsed, null, 2));
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
});
