(() => {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }

  const API_URL = "/api/content-ops/state";
  const WHOLESALE_PRODUCTS_API = "/api/content-ops/wholesale-products";
  const DEFAULT_WHOLESALE_ADMIN_URL = "https://pupuhome-wholesale.onrender.com/admin.html";
  const TEST_SERVER_URL = "http://127.0.0.1:4322/api/content-ops/state";
  const STORAGE_KEY = "content_ops_state_v1";
  const platforms = ["小红书", "抖音", "视频号", "B站", "公众号", "微博", "Instagram", "TikTok", "LinkedIn", "X"];
  const accountColorPalette = ["#1f7a72", "#d6634f", "#3f6fb5", "#c98b22", "#7562a9", "#2f855a", "#b45309", "#be4b7a", "#2563eb", "#64748b"];
  const contentTypes = ["教程干货", "避坑清单", "测评种草", "观点反常识", "故事案例", "热点借势", "账号人设", "成交转化"];
  const formulas = ["用户定位", "场景设计", "价值体现", "痛点挖掘", "颠覆理论", "蹭热门", "对比", "诱饵悬念", "价格锚点", "时间节点"];
  const emotionHooks = ["好奇", "吃惊", "焦虑", "共鸣", "反差", "不服气", "爽感", "安全感", "紧迫感", "收藏欲"];
  const postStatuses = ["选题", "草稿", "待发布", "已发布", "复盘完成"];
  const productCategories = ["毛绒玩具", "箱包", "文创文具"];
  const statsPlatforms = [
    { key: "xhs", label: "小红书" },
    { key: "douyin", label: "抖音" },
  ];
  const metricFields = ["exposure", "clicks", "likes", "saves", "comments", "shares", "follows", "conversions"];
  const statsMetricFields = ["likes", "saves", "comments", "conversions"];
  const metricLabels = {
    exposure: "曝光",
    clicks: "点击",
    likes: "点赞",
    saves: "收藏",
    comments: "评论",
    shares: "分享",
    follows: "涨粉",
    conversions: "转化",
  };
  const qixiDates = { 2026: "2026-08-19", 2027: "2027-08-08", 2028: "2028-08-26" };
  const seasonalTemplates = [
    { name: "情人节", month: 2, day: 14, leadDays: 15, categories: ["毛绒玩具", "箱包", "文创文具"], angle: "礼物清单、情侣/闺蜜互送、仪式感开箱" },
    { name: "520礼赠", month: 5, day: 20, leadDays: 15, categories: ["毛绒玩具", "文创文具"], angle: "告白礼物、陪伴感、低预算有心意" },
    { name: "儿童节", month: 6, day: 1, leadDays: 15, categories: ["毛绒玩具", "文创文具"], angle: "童心礼物、办公室治愈、可爱桌面" },
    { name: "毕业季", month: 6, day: 15, leadDays: 15, categories: ["箱包", "文创文具", "毛绒玩具"], angle: "毕业礼物、入职第一件、纪念款" },
    { name: "七夕节", lunarKey: "qixi", leadDays: 15, categories: ["毛绒玩具", "箱包", "文创文具"], angle: "七夕送礼、约会搭配、礼物预算分层" },
    { name: "开学日前", month: 9, day: 1, leadDays: 15, categories: ["箱包", "文创文具", "毛绒玩具"], angle: "开学收纳、书包搭配、文具套装、宿舍桌面" },
    { name: "圣诞礼物季", month: 12, day: 25, leadDays: 20, categories: ["毛绒玩具", "文创文具", "箱包"], angle: "圣诞礼物、交换礼物、冬季氛围感" },
    { name: "新年礼赠", month: 1, day: 1, leadDays: 15, categories: ["毛绒玩具", "文创文具", "箱包"], angle: "新年开运、换新桌面、送朋友小礼物" },
  ];
  const progressSteps = [
    { key: "progressPlanning", label: "内容策划", short: "策划" },
    { key: "progressShooting", label: "执行拍摄", short: "拍摄" },
    { key: "progressEditing", label: "剪辑完成/完成制作", short: "制作" },
    { key: "progressTitle", label: "标题填写", short: "标题" },
    { key: "progressAccount", label: "发布账号", short: "账号" },
  ];
  const metricAliases = {
    likes: ["点赞", "赞", "like", "likes"],
    saves: ["收藏", "藏", "save", "saves"],
    comments: ["评论", "评", "comment", "comments"],
    shares: ["分享", "转发", "share", "shares"],
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const todayDate = () => new Date().toISOString().slice(0, 10);
  const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const number = (value) => Number(value || 0);
  const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(value >= .1 ? 0 : 1)}%` : "无";
  const dateText = (value) => value ? String(value).replace("T", " ").slice(0, 16) : "未填写";
  const dateKey = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const monthLabel = (date) => `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
  const timePart = (value, fallback = "20:30") => String(value || "").match(/T(\d{2}:\d{2})/)?.[1] || fallback;
  const weekStart = () => {
    const date = new Date();
    const day = date.getDay() || 7;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day + 1);
    return date;
  };

  const seedState = {
    titles: [
      {
        id: "title-1",
        title: "普通人别再乱做小红书了",
        platform: "小红书",
        sourceAccount: "运营观察样本",
        sourceUrl: "",
        publishedAt: "2026-07-02",
        capturedAt: todayDate(),
        likes: 1820,
        saves: 2460,
        comments: 213,
        shares: 168,
        contentType: "观点反常识",
        niche: "新媒体运营",
        audience: "新手博主",
        formula: "颠覆理论",
        emotionHook: "不服气",
        notes: "开头先否定常见动作，适合承接方法论正文。",
      },
      {
        id: "title-2",
        title: "30天起号复盘：这5类内容最稳",
        platform: "小红书",
        sourceAccount: "增长拆解样本",
        sourceUrl: "",
        publishedAt: "2026-06-28",
        capturedAt: todayDate(),
        likes: 950,
        saves: 1880,
        comments: 96,
        shares: 141,
        contentType: "教程干货",
        niche: "账号增长",
        audience: "运营负责人",
        formula: "价值体现",
        emotionHook: "收藏欲",
        notes: "收藏率高，适合沉淀成系列封面模板。",
      },
      {
        id: "title-3",
        title: "账号没流量，可能不是内容差",
        platform: "小红书",
        sourceAccount: "内容策略样本",
        sourceUrl: "",
        publishedAt: "2026-07-05",
        capturedAt: todayDate(),
        likes: 720,
        saves: 1035,
        comments: 74,
        shares: 88,
        contentType: "避坑清单",
        niche: "新媒体运营",
        audience: "品牌号运营",
        formula: "痛点挖掘",
        emotionHook: "焦虑",
        notes: "适合引出账号定位、发布频率、封面统一性问题。",
      },
    ],
    accounts: [
      {
        id: "account-1",
        name: "品牌小红书号",
        platform: "小红书",
        color: "#1f7a72",
        owner: "Chloe",
        position: "围绕内容运营、账号增长、标题拆解做专业可信的干货号。",
        target: "新媒体运营、创始人助理",
        frequencyPerWeek: 5,
        blockedSlots: "周六上午",
        preferredSlots: "周一至周五 12:30 或 20:30",
        status: "运营中",
        notes: "避免夸大收益，所有数据复盘需标注来源。",
      },
      {
        id: "account-2",
        name: "案例拆解视频号",
        platform: "视频号",
        color: "#3f6fb5",
        owner: "Lina",
        position: "用短视频拆解爆款内容结构，强调可复制动作。",
        target: "内容团队负责人",
        frequencyPerWeek: 3,
        blockedSlots: "周日",
        preferredSlots: "周二/四/六 19:00",
        status: "观察中",
        notes: "每条视频都要登记脚本钩子和完播反馈。",
      },
    ],
    posts: [
      {
        id: "post-1",
        accountId: "account-1",
        titleId: "title-1",
        headline: "普通人别再乱做小红书了",
        contentType: "观点反常识",
        niche: "新媒体运营",
        status: "已发布",
        owner: "Chloe",
        scheduledAt: "2026-07-07T20:30",
        publishedAt: "2026-07-07T20:31",
        exposure: 12600,
        clicks: 2140,
        likes: 360,
        saves: 510,
        comments: 62,
        shares: 44,
        follows: 39,
        conversions: 6,
        url: "",
        notes: "评论集中问起号频率，下周补一篇账号节奏模板。",
      },
      {
        id: "post-2",
        accountId: "account-1",
        titleId: "title-2",
        headline: "30天起号复盘：这5类内容最稳",
        contentType: "教程干货",
        niche: "账号增长",
        status: "复盘完成",
        owner: "Chloe",
        scheduledAt: "2026-07-03T12:30",
        publishedAt: "2026-07-03T12:32",
        exposure: 8600,
        clicks: 1380,
        likes: 210,
        saves: 460,
        comments: 28,
        shares: 35,
        follows: 31,
        conversions: 4,
        url: "",
        notes: "收藏点赞比高，可以复用“复盘+数字清单”公式。",
      },
      {
        id: "post-3",
        accountId: "account-2",
        titleId: "",
        headline: "爆款标题不要先追热点",
        contentType: "避坑清单",
        niche: "内容策略",
        status: "待发布",
        owner: "Lina",
        scheduledAt: nowLocal(),
        publishedAt: "",
        exposure: 0,
        clicks: 0,
        likes: 0,
        saves: 0,
        comments: 0,
        shares: 0,
        follows: 0,
        conversions: 0,
        url: "",
        notes: "等待封面确认。",
      },
    ],
    products: [],
    inventorySettings: {
      backendName: "订货后台",
      backendUrl: DEFAULT_WHOLESALE_ADMIN_URL,
      lastSyncedAt: "",
    },
    updatedAt: new Date().toISOString(),
  };

  let state = structuredClone(seedState);
  let apiOnline = false;
  let saveTimer = null;
  let batchTitleDrafts = [];
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let statsMonth = todayDate().slice(0, 7);
  const isFileMode = location.protocol === "file:";

  function loadLocal() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(seedState));
    } catch {
      return normalizeState(structuredClone(seedState));
    }
  }

  function normalizeState(input) {
    const next = input && typeof input === "object" ? input : structuredClone(seedState);
    next.titles = Array.isArray(next.titles) ? next.titles : [];
    next.accounts = Array.isArray(next.accounts) ? next.accounts : [];
    next.accounts.forEach(normalizeAccount);
    next.posts = Array.isArray(next.posts) ? next.posts : [];
    next.posts.forEach(normalizePostMetrics);
    next.products = Array.isArray(next.products) ? next.products : [];
    next.inventorySettings = { ...seedState.inventorySettings, ...(next.inventorySettings || {}) };
    return next;
  }

  function normalizeAccount(account, index = 0) {
    account.color = normalizeHexColor(account.color) || accountColorPalette[index % accountColorPalette.length];
    return account;
  }

  function normalizeHexColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "";
  }

  function hexToRgb(hex) {
    const safe = normalizeHexColor(hex) || "#1f7a72";
    const value = safe.slice(1);
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function accountStyle(account) {
    const color = normalizeHexColor(account?.color) || "#1f7a72";
    const rgb = hexToRgb(color);
    return `--account-color:${color};--account-border:rgba(${rgb.r},${rgb.g},${rgb.b},.34);--account-bg:rgba(${rgb.r},${rgb.g},${rgb.b},.10);--account-soft:rgba(${rgb.r},${rgb.g},${rgb.b},.16);`;
  }

  function nextAccountColor() {
    return accountColorPalette[state.accounts.length % accountColorPalette.length];
  }

  function normalizePostMetrics(post) {
    post.platformMetrics = post.platformMetrics && typeof post.platformMetrics === "object" ? post.platformMetrics : {};
    statsPlatforms.forEach((platform) => {
      const existing = post.platformMetrics[platform.key] && typeof post.platformMetrics[platform.key] === "object" ? post.platformMetrics[platform.key] : {};
      post.platformMetrics[platform.key] = {};
      metricFields.forEach((field) => {
        const fallback = platform.key === "xhs" ? post[field] : 0;
        post.platformMetrics[platform.key][field] = number(existing[field] ?? fallback);
      });
    });
    return post;
  }

  async function loadState() {
    try {
      const response = await fetch(API_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("api unavailable");
      state = normalizeState(await response.json());
      apiOnline = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      state = loadLocal();
      apiOnline = false;
    }
    updateStorageStatus();
    hydrateControls();
    renderAll();
  }

  function updateStorageStatus() {
    $("#storage-status").textContent = apiOnline ? "内网共享数据已连接" : "本机临时数据，启动内网服务后可共享";
    document.body.classList.toggle("is-file-mode", isFileMode);
  }

  function scheduleSave() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 280);
  }

  async function saveState() {
    if (!apiOnline) return;
    try {
      const response = await fetch(API_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      apiOnline = false;
      updateStorageStatus();
      toast("共享服务暂时不可用，已保存到本机");
    }
  }

  async function migrateFileData() {
    if (!isFileMode) return;
    const button = $("#migrate-file-data");
    button.disabled = true;
    button.textContent = "迁移中";
    try {
      state.updatedAt = new Date().toISOString();
      const response = await fetch(TEST_SERVER_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!response.ok) throw new Error("migrate failed");
      toast(`已迁移 ${state.accounts.length} 个账号到测试服务`);
      button.textContent = "迁移完成";
    } catch {
      toast("迁移失败，请确认测试服务已打开");
      button.disabled = false;
      button.textContent = "迁移到测试服务";
    }
  }

  function hydrateControls() {
    fillSelects("[name='platform'], #title-platform-filter", platforms, "全部平台");
    fillSelects("[name='contentType'], #title-type-filter", contentTypes, "全部类型");
    fillSelects("[name='formula'], #title-formula-filter", formulas, "全部公式");
    fillSelects("[name='emotionHook']", emotionHooks);
    fillSelects("#post-form [name='status'], #post-status-filter", postStatuses, "全部状态");
    fillSelects("#product-form [name='category']", productCategories);
    fillSelects("#product-category-filter", productCategories, "全部产品类型");
    refreshAccountSelects();
    refreshTitleSelects();
    refreshNiches();
    hydrateInventorySettings();
  }

  function fillSelects(selector, values, allLabel) {
    $$(selector).forEach((select) => {
      const current = select.value;
      const includeAll = select.id && allLabel;
      select.innerHTML = `${includeAll ? `<option value="all">${allLabel}</option>` : ""}${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
      if (values.includes(current) || current === "all") select.value = current;
    });
  }

  function refreshAccountSelects() {
    const options = state.accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.name)}｜${escapeHtml(account.platform)}</option>`).join("");
    $$("[name='accountId']").forEach((select) => {
      const currentAccount = select.value || "";
      select.innerHTML = `<option value="">未分配账号</option>${options}`;
      select.value = currentAccount === "" || state.accounts.some((account) => account.id === currentAccount) ? currentAccount : "";
    });
    const postAccount = $("#post-account-filter");
    const currentPostAccount = postAccount.value || "all";
    postAccount.innerHTML = `<option value="all">全部账号</option>${options}`;
    postAccount.value = currentPostAccount === "all" || state.accounts.some((account) => account.id === currentPostAccount) ? currentPostAccount : "all";
    const statsAccount = $("#stats-account-filter");
    if (statsAccount) {
      const currentStatsAccount = statsAccount.value || "all";
      statsAccount.innerHTML = `<option value="all">全部账号</option>${options}`;
      statsAccount.value = currentStatsAccount === "all" || state.accounts.some((account) => account.id === currentStatsAccount) ? currentStatsAccount : "all";
    }
  }

  function refreshTitleSelects() {
    const options = state.titles.map((title) => `<option value="${title.id}">${escapeHtml(title.title)}</option>`).join("");
    $$("[name='titleId']").forEach((select) => {
      const current = select.value;
      select.innerHTML = `<option value="">不关联</option>${options}`;
      select.value = current;
    });
  }

  function refreshNiches() {
    const niches = [...new Set([...state.titles.map((item) => item.niche), ...state.posts.map((item) => item.niche)].filter(Boolean))];
    $("#niche-list").innerHTML = niches.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("");
  }

  function accountById(id) {
    return state.accounts.find((account) => account.id === id);
  }

  function titleById(id) {
    return state.titles.find((title) => title.id === id);
  }

  function productById(id) {
    return state.products.find((product) => product.id === id);
  }

  function postsUsingTitle(titleId) {
    return state.posts.filter((post) => post.titleId === titleId);
  }

  function usageLabel(posts) {
    return posts.length ? `已使用 ${posts.length} 篇` : "标记已使用";
  }

  function titleScore(title) {
    return number(title.likes) + number(title.saves) * 1.8 + number(title.comments) * 2.4 + number(title.shares) * 2;
  }

  function platformMetric(post, platformKey, field) {
    normalizePostMetrics(post);
    return number(post.platformMetrics?.[platformKey]?.[field]);
  }

  function totalPostMetric(post, field) {
    normalizePostMetrics(post);
    return statsPlatforms.reduce((sum, platform) => sum + platformMetric(post, platform.key, field), 0);
  }

  function postEngagement(post) {
    const interactions = totalPostMetric(post, "likes") + totalPostMetric(post, "saves") + totalPostMetric(post, "comments") + totalPostMetric(post, "shares");
    const clicks = totalPostMetric(post, "clicks");
    return clicks ? interactions / clicks : null;
  }

  function postClickRate(post) {
    const exposure = totalPostMetric(post, "exposure");
    return exposure ? totalPostMetric(post, "clicks") / exposure : null;
  }

  function thisWeekPublished(accountId) {
    const start = weekStart();
    return state.posts.filter((post) => {
      if (accountId && post.accountId !== accountId) return false;
      if (!["已发布", "复盘完成"].includes(post.status)) return false;
      const when = post.publishedAt ? new Date(post.publishedAt) : null;
      return when && when >= start;
    });
  }

  function frequencyInfo(account) {
    const done = thisWeekPublished(account.id).length;
    const target = number(account.frequencyPerWeek);
    const ratio = target ? Math.min(done / target, 1) : 1;
    const missing = Math.max(target - done, 0);
    return { done, target, ratio, missing };
  }

  function hydrateInventorySettings() {
    $("#inventory-backend-name").value = state.inventorySettings.backendName || "";
    $("#inventory-backend-url").value = state.inventorySettings.backendUrl || DEFAULT_WHOLESALE_ADMIN_URL;
    $("#inventory-synced-at").value = state.inventorySettings.lastSyncedAt || "";
  }

  function stockInfo(product) {
    const stock = number(product.stock);
    const incoming = number(product.incomingStock);
    const status = product.stockStatus || "";
    const hasStockNumber = /\d/.test(String(product.stockText || ""));
    const label = product.stockText || (stock ? `库存 ${stock}` : status || "需确认");
    if (/缺货/.test(status) || (stock <= 0 && !/有货/.test(status))) return { label: incoming ? `${label}｜在途 ${incoming}` : label, tone: "danger" };
    if (/预定|需确认/.test(status)) return { label, tone: "amber" };
    if (hasStockNumber && stock < 30) return { label: `库存偏低 ${stock}`, tone: "amber" };
    return { label, tone: "" };
  }

  function selectedProducts() {
    return state.products
      .filter((product) => product.selected)
      .sort((a, b) => {
        const orderA = number(a.focusOrder) || 9999;
        const orderB = number(b.focusOrder) || 9999;
        return orderA - orderB || number(b.priority) - number(a.priority) || number(b.stock) - number(a.stock);
      });
  }

  function focusProducts() {
    return selectedProducts().slice(0, 10);
  }

  function localDate(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function diffDays(from, to) {
    const a = localDate(dateKey(from));
    const b = localDate(dateKey(to));
    return Math.round((b - a) / 86400000);
  }

  function seasonalEvents() {
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear + 1];
    return years.flatMap((year) => seasonalTemplates.map((template) => {
      const date = template.lunarKey === "qixi"
        ? qixiDates[year]
        : `${year}-${String(template.month).padStart(2, "0")}-${String(template.day).padStart(2, "0")}`;
      return date ? { ...template, id: `${template.name}-${year}`, date } : null;
    }).filter(Boolean));
  }

  function upcomingSeasonalEvents(limit = 6) {
    const now = localDate(todayDate());
    return seasonalEvents()
      .map((event) => {
        const eventDate = localDate(event.date);
        const daysToEvent = diffDays(now, eventDate);
        const startDate = addDays(eventDate, -event.leadDays);
        const daysToStart = diffDays(now, startDate);
        return { ...event, eventDate, startDate, daysToEvent, daysToStart };
      })
      .filter((event) => event.daysToEvent >= -3)
      .sort((a, b) => a.eventDate - b.eventDate)
      .slice(0, limit);
  }

  function seasonalStatus(event) {
    if (event.daysToStart > 0) return `距建议启动 ${event.daysToStart} 天`;
    if (event.daysToEvent >= 0) return `现在开始预热｜还剩 ${event.daysToEvent} 天`;
    return "节点刚过，可做复盘/返场";
  }

  function productsForEvent(event) {
    return state.products
      .filter((product) => event.categories.includes(product.category) && !/缺货/.test(product.stockStatus || ""))
      .sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)) || number(b.priority) - number(a.priority) || number(b.stock) - number(a.stock))
      .slice(0, 3);
  }

  function productSyncKey(product) {
    return product.wholesaleId || product.sku || product.id;
  }

  function normalizeFocusOrders() {
    selectedProducts().forEach((product, index) => {
      product.focusOrder = index + 1;
    });
    state.products.filter((product) => !product.selected).forEach((product) => {
      product.focusOrder = 0;
    });
  }

  function ensureFocusOrder(product) {
    if (!product.selected) {
      product.focusOrder = 0;
      return;
    }
    if (!number(product.focusOrder)) {
      const highest = state.products.reduce((max, item) => Math.max(max, number(item.focusOrder)), 0);
      product.focusOrder = highest + 1;
    }
    normalizeFocusOrders();
  }

  function mergeWholesaleProducts(incoming) {
    const existingByKey = new Map(state.products.map((product) => [productSyncKey(product), product]));
    const incomingKeys = new Set();
    const merged = incoming.map((product) => {
      const key = productSyncKey(product);
      incomingKeys.add(key);
      const existing = existingByKey.get(key);
      if (!existing) return product;
      return {
        ...existing,
        ...product,
        selected: Boolean(existing.selected),
        focusOrder: number(existing.focusOrder),
        priority: number(existing.priority) || number(product.priority) || 5,
        sellingPoint: existing.sellingPoint || product.sellingPoint,
        notes: existing.notes || product.notes,
      };
    });
    state.products.forEach((product) => {
      if (!incomingKeys.has(productSyncKey(product))) merged.push(product);
    });
    state.products = merged;
    normalizeFocusOrders();
  }

  async function syncWholesaleProducts() {
    const button = $("#sync-wholesale-products");
    const backendUrl = $("#inventory-backend-url").value.trim() || DEFAULT_WHOLESALE_ADMIN_URL;
    button.disabled = true;
    button.textContent = "同步中";
    try {
      const response = await fetch(`${WHOLESALE_PRODUCTS_API}?url=${encodeURIComponent(backendUrl)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("sync failed");
      const payload = await response.json();
      mergeWholesaleProducts(payload.products || []);
      state.inventorySettings = {
        backendName: $("#inventory-backend-name").value.trim() || "订货后台",
        backendUrl,
        lastSyncedAt: nowLocal(),
      };
      scheduleSave();
      renderAll();
      toast(`已同步 ${payload.products?.length || 0} 个后台产品`);
    } catch {
      toast("同步失败，请确认订货后台链接可访问");
    } finally {
      button.disabled = false;
      button.textContent = "同步订货后台";
    }
  }

  function moveFocusProduct(productId, direction) {
    const products = focusProducts();
    const index = products.findIndex((product) => product.id === productId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= products.length) return;
    const ordered = products.slice();
    const [item] = ordered.splice(index, 1);
    ordered.splice(targetIndex, 0, item);
    ordered.forEach((product, order) => {
      product.focusOrder = order + 1;
    });
    scheduleSave();
    renderAll();
    toast("Top10 顺序已更新");
  }

  function reorderFocusProducts(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const products = focusProducts();
    const sourceIndex = products.findIndex((product) => product.id === sourceId);
    const targetIndex = products.findIndex((product) => product.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const ordered = products.slice();
    const [source] = ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, source);
    ordered.forEach((product, index) => {
      product.focusOrder = index + 1;
    });
    scheduleSave();
    renderAll();
    toast("Top10 顺序已更新");
  }

  function renderAll() {
    refreshAccountSelects();
    refreshTitleSelects();
    refreshNiches();
    hydrateInventorySettings();
    renderDashboard();
    renderTitles();
    renderAccounts();
    renderProducts();
    renderPosts();
    renderStats();
    renderInsights();
  }

  function renderDashboard() {
    const published = thisWeekPublished();
    const pending = state.posts.filter((post) => ["选题", "草稿", "待发布"].includes(post.status)).length;
    const titleCount = state.titles.length;
    const risks = state.accounts.filter((account) => frequencyInfo(account).missing > 0 && account.status === "运营中").length;
    renderRecommendedProducts();
    $("#metric-grid").innerHTML = [
      metric("本周已发布", published.length, `待发布/草稿 ${pending} 条`, "teal"),
      metric("标题库", titleCount, `最高分标题：${escapeHtml(topTitles(1)[0]?.formula || "暂无")}`, "coral"),
      metric("频率风险", risks, risks ? "有账号未达到周目标" : "账号节奏正常", "amber"),
      metric("平均点击率", avg(published.map(postClickRate)), "已发布内容口径", "blue", true),
    ].join("");

    $("#frequency-list").innerHTML = state.accounts.length ? state.accounts.map((account) => {
      const info = frequencyInfo(account);
      const tone = info.ratio < .5 ? "danger" : info.ratio < 1 ? "warn" : "";
      return `<div class="frequency-row">
        <div><strong>${escapeHtml(account.name)}</strong><div class="row-meta">${escapeHtml(account.platform)}｜${escapeHtml(account.owner || "未分配")}</div></div>
        <div><div class="bar ${tone}"><span style="width:${Math.round(info.ratio * 100)}%"></span></div><div class="row-meta">本周 ${info.done}/${info.target || 0} 条</div></div>
        <div>${info.missing ? `<span class="pill amber">缺 ${info.missing} 条</span>` : `<span class="pill">达标</span>`}</div>
      </div>`;
    }).join("") : empty("还没有账号");

    $("#recent-posts").innerHTML = state.posts.slice().sort((a, b) => String(b.publishedAt || b.scheduledAt).localeCompare(String(a.publishedAt || a.scheduledAt))).slice(0, 6).map((post) => {
      const account = accountById(post.accountId);
      return `<div class="compact-item">
        <div><strong>${escapeHtml(post.headline)}</strong><div class="row-meta">${escapeHtml(account?.name || "未关联账号")}｜${escapeHtml(post.status)}</div></div>
        <span class="pill ${post.status === "已发布" || post.status === "复盘完成" ? "" : "amber"}">${dateText(post.publishedAt || post.scheduledAt)}</span>
      </div>`;
    }).join("") || empty("还没有发布记录");
  }

  function renderRecommendedProducts() {
    const products = selectedProducts();
    const events = upcomingSeasonalEvents(4);
    $("#recommended-products").innerHTML = products.length ? products.slice(0, 10).map((product) => {
      const stock = stockInfo(product);
      const matched = events.find((event) => event.categories.includes(product.category));
      return `<article class="recommended-product-card">
        <div class="card-topline">
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="row-meta">#${number(product.focusOrder) || "-"}｜${escapeHtml(product.category)}${product.sku ? `｜${escapeHtml(product.sku)}` : ""}</div>
          </div>
          <span class="pill ${stock.tone}">${escapeHtml(stock.label)}</span>
        </div>
        <p>${escapeHtml(product.sellingPoint || "未填写内容卖点")}</p>
        <div class="recommend-reason">${matched ? `${escapeHtml(matched.name)}：${escapeHtml(matched.angle)}` : "管理员手动设为近期主推"}</div>
        <div class="card-actions">
          <button class="text-button" data-view-jump="products" type="button">管理库存</button>
        </div>
      </article>`;
    }).join("") : empty("还没有选择近期主推产品。到“产品库存”里勾选需要主推的产品。");
  }

  function renderProducts() {
    const query = $("#product-search").value.trim().toLowerCase();
    const category = $("#product-category-filter").value;
    const stockFilter = $("#product-stock-filter").value;
    const products = state.products.filter((product) => {
      const haystack = [product.name, product.sku, product.category, product.sourceCategory, product.stockStatus].join(" ").toLowerCase();
      const status = product.stockStatus || "";
      const matchStock = stockFilter === "all"
        || (stockFilter === "instock" && status === "有货")
        || (stockFilter === "preorder" && /预定/.test(status))
        || (stockFilter === "soldout" && /缺货/.test(status))
        || (stockFilter === "selected" && product.selected);
      return (!query || haystack.includes(query))
        && (category === "all" || product.category === category)
        && matchStock;
    }).sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)) || number(b.priority) - number(a.priority));
    renderMonthlyFocus();
    renderSeasonalReminders();
    $("#product-grid").innerHTML = products.length ? products.map((product) => {
      const stock = stockInfo(product);
      const events = upcomingSeasonalEvents(4).filter((event) => event.categories.includes(product.category));
      return `<article class="product-card" data-edit-product="${product.id}">
        <div class="card-topline">
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="row-meta">${escapeHtml(product.category)}${product.sourceCategory ? `｜后台：${escapeHtml(product.sourceCategory)}` : ""}${product.sku ? `｜${escapeHtml(product.sku)}` : ""}</div>
          </div>
          <span class="pill ${stock.tone}">${escapeHtml(stock.label)}</span>
        </div>
        <p>${escapeHtml(product.sellingPoint || "未填写内容卖点")}</p>
        <div class="product-meta-grid">
          <div><span>控价</span><strong>${product.price ? `¥${escapeHtml(product.price)}` : "未填"}</strong></div>
          <div><span>排序</span><strong>${product.selected ? `Top ${number(product.focusOrder) || "-"}` : "未推荐"}</strong></div>
          <div><span>节日匹配</span><strong>${events[0] ? escapeHtml(events[0].name) : "暂无"}</strong></div>
        </div>
        <div class="card-actions">
          <button class="secondary-button small" data-toggle-product="${product.id}" type="button">${product.selected ? "取消推荐" : "设为推荐"}</button>
          ${product.backendUrl ? `<a class="text-button" href="${escapeHtml(product.backendUrl)}" target="_blank" rel="noreferrer">后台链接</a>` : ""}
          <button class="text-button" data-edit-product="${product.id}" type="button">编辑</button>
        </div>
      </article>`;
    }).join("") : empty("还没有产品。先新增毛绒玩具、箱包或文创文具，并登记库存。");
  }

  function renderMonthlyFocus() {
    const products = focusProducts();
    $("#monthly-focus-list").innerHTML = products.length ? products.map((product, index) => {
      const stock = stockInfo(product);
      return `<article class="monthly-focus-card" draggable="true" data-focus-product="${product.id}">
        <span class="focus-rank">${index + 1}</span>
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <div class="row-meta">${escapeHtml(product.category)}${product.sku ? `｜${escapeHtml(product.sku)}` : ""}</div>
        </div>
        <span class="pill ${stock.tone}">${escapeHtml(stock.label)}</span>
        <div class="focus-actions">
          <button type="button" data-move-focus="${product.id}" data-direction="-1" title="上移">↑</button>
          <button type="button" data-move-focus="${product.id}" data-direction="1" title="下移">↓</button>
        </div>
      </article>`;
    }).join("") : empty("还没有本月重点产品。先同步订货后台，再把产品设为推荐。");
  }

  function renderSeasonalReminders() {
    const reminders = upcomingSeasonalEvents(6);
    $("#seasonal-reminders").innerHTML = reminders.map((event) => {
      const products = productsForEvent(event);
      return `<article class="seasonal-card ${event.daysToStart <= 0 && event.daysToEvent >= 0 ? "active" : ""}">
        <div class="card-topline">
          <div>
            <h3>${escapeHtml(event.name)}</h3>
            <div class="row-meta">${escapeHtml(event.date)}｜建议 ${dateKey(event.startDate)} 启动</div>
          </div>
          <span class="pill ${event.daysToStart <= 0 ? "amber" : ""}">${escapeHtml(seasonalStatus(event))}</span>
        </div>
        <p>${escapeHtml(event.angle)}</p>
        <div class="seasonal-products">
          ${products.length ? products.map((product) => `<span>${escapeHtml(product.name)}｜${escapeHtml(stockInfo(product).label)}</span>`).join("") : "<span>暂无匹配库存，先在产品库存里补产品</span>"}
        </div>
      </article>`;
    }).join("");
  }

  function metric(label, value, help, accent, isPercent = false) {
    return `<div class="metric-card accent-${accent}"><span>${label}</span><strong>${isPercent ? percent(value) : escapeHtml(value)}</strong><small>${help}</small></div>`;
  }

  function avg(values) {
    const clean = values.filter((value) => value != null && Number.isFinite(value));
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
  }

  function renderTitles() {
    const query = $("#title-search").value.trim().toLowerCase();
    const platform = $("#title-platform-filter").value;
    const type = $("#title-type-filter").value;
    const formula = $("#title-formula-filter").value;
    const filtered = state.titles.filter((title) => {
      const haystack = [title.title, title.niche, title.audience, title.formula, title.emotionHook, title.sourceAccount].join(" ").toLowerCase();
      return (!query || haystack.includes(query))
        && (platform === "all" || title.platform === platform)
        && (type === "all" || title.contentType === type)
        && (formula === "all" || title.formula === formula);
    }).sort((a, b) => {
      const aUsed = postsUsingTitle(a.id).length > 0;
      const bUsed = postsUsingTitle(b.id).length > 0;
      if (aUsed !== bUsed) return aUsed ? 1 : -1;
      return titleScore(b) - titleScore(a);
    });
    $("#title-library").innerHTML = filtered.length ? filtered.map((title) => titleRow(title)).join("") : `<tr><td colspan="2">${empty("没有匹配的标题")}</td></tr>`;
  }

  function titleRow(title) {
    const usedPosts = postsUsingTitle(title.id);
    const used = usedPosts.length > 0;
    const linkedNames = usedPosts.map((post) => post.headline).join("、");
    return `<tr class="title-row ${used ? "used" : "unused"}">
      <td>
        <button class="title-name-button" data-title-detail="${title.id}" title="查看来源和细节">${escapeHtml(title.title)}</button>
      </td>
      <td>
        <button class="usage-button ${used ? "used" : "unused"}" data-title-usage="${title.id}" title="${escapeHtml(linkedNames || "选择对应笔记进行关联")}">${escapeHtml(usageLabel(usedPosts))}</button>
      </td>
    </tr>`;
  }

  function parseMetricValue(raw) {
    const value = String(raw || "").trim().replace(/,/g, "");
    const match = value.match(/(\d+(?:\.\d+)?)(万|w|W|k|K)?/);
    if (!match) return 0;
    const base = Number(match[1]);
    const unit = match[2];
    if (unit === "万" || unit === "w" || unit === "W") return Math.round(base * 10000);
    if (unit === "k" || unit === "K") return Math.round(base * 1000);
    return Math.round(base);
  }

  function extractMetric(text, field) {
    const aliases = metricAliases[field] || [];
    for (const alias of aliases) {
      const pattern = new RegExp(`${alias}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?\\s*(?:万|w|W|k|K)?)`, "i");
      const match = text.match(pattern);
      if (match) return parseMetricValue(match[1]);
    }
    return 0;
  }

  function detectPlatform(text, url = "") {
    const haystack = `${text} ${url}`.toLowerCase();
    if (/xiaohongshu|xhs|小红书/.test(haystack)) return "小红书";
    if (/douyin|iesdouyin|抖音/.test(haystack)) return "抖音";
    if (/bilibili|b23\.tv|b站|哔哩/.test(haystack)) return "B站";
    if (/weixin|mp\.weixin|公众号/.test(haystack)) return "公众号";
    if (/weibo|微博/.test(haystack)) return "微博";
    if (/instagram/.test(haystack)) return "Instagram";
    if (/tiktok/.test(haystack)) return "TikTok";
    if (/linkedin/.test(haystack)) return "LinkedIn";
    if (/(^|\W)x\.com|twitter/.test(haystack)) return "X";
    return "小红书";
  }

  function detectSourceAccount(text) {
    const match = text.match(/(?:作者|博主|账号|来源账号|source)\s*[:：]\s*([^|\n，,]+)/i);
    return match ? match[1].trim() : "";
  }

  function detectContentType(title) {
    if (/避坑|不要|别再|千万|踩雷|误区|错误/.test(title)) return "避坑清单";
    if (/测评|好物|种草|推荐|开箱|平替/.test(title)) return "测评种草";
    if (/为什么|真相|不是|反常识|普通人|底层逻辑/.test(title)) return "观点反常识";
    if (/复盘|故事|经历|案例|我是如何|从.*到/.test(title)) return "故事案例";
    if (/热点|最新|刚刚|爆了|全网/.test(title)) return "热点借势";
    if (/成交|转化|私域|卖货|下单/.test(title)) return "成交转化";
    if (/人设|定位|账号包装|简介|主页/.test(title)) return "账号人设";
    return "教程干货";
  }

  function detectFormula(title) {
    if (/vs|VS|对比|前后|以前|现在/.test(title)) return "对比";
    if (/不要|别再|千万|不是|反常识|凭什么/.test(title)) return "颠覆理论";
    if (/痛|坑|踩雷|亏|错|没流量|不涨粉/.test(title)) return "痛点挖掘";
    if (/\d+|一|二|三|四|五|六|七|八|九|十/.test(title) && /天|个|条|类|步|分钟|元|块/.test(title)) return "价值体现";
    if (/普通人|新手|小白|学生|宝妈|女生|上班族|运营/.test(title)) return "用户定位";
    if (/通勤|约会|上班|开学|装修|面试|发布前|起号/.test(title)) return "场景设计";
    if (/热点|明星|爆了|全网|最新/.test(title)) return "蹭热门";
    if (/低价|只要|不到|平替|花了|预算/.test(title)) return "价格锚点";
    if (/春节|夏天|秋冬|开学季|年末|月初|周末/.test(title)) return "时间节点";
    return "诱饵悬念";
  }

  function detectEmotionHook(title) {
    if (/为什么|竟然|原来|真相|秘密|？|\?/.test(title)) return "好奇";
    if (/千万|别再|小心|警惕|焦虑|后悔/.test(title)) return "焦虑";
    if (/普通人|我|我们|打工人|女生|新手/.test(title)) return "共鸣";
    if (/不是|反而|却|居然|前后|vs|VS/.test(title)) return "反差";
    if (/凭什么|不服|别/.test(title)) return "不服气";
    if (/必看|速看|马上|赶紧|最后/.test(title)) return "紧迫感";
    if (/清单|模板|攻略|指南|收藏|保姆级/.test(title)) return "收藏欲";
    if (/太|绝了|爆了|封神|开挂/.test(title)) return "爽感";
    return "好奇";
  }

  function cleanTitleLine(line) {
    return String(line || "")
      .replace(/^\s*(?:[-*#]+|\d+[.、])\s*/, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/(?:点赞|赞|收藏|评论|分享|转发|like|likes|save|saves|comment|comments|share|shares)\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:万|w|W|k|K)?/gi, "")
      .replace(/[|｜]\s*$/, "")
      .trim();
  }

  function extractTitle(block) {
    const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const candidates = [];
    lines.forEach((line) => {
      const firstPart = line.split(/\s*[|｜]\s*/).find((part) => !/^https?:\/\//.test(part) && !/(点赞|收藏|评论|分享|作者|博主|账号)[:：]/.test(part));
      const cleaned = cleanTitleLine(firstPart || line);
      if (cleaned && cleaned.length >= 4 && cleaned.length <= 80) candidates.push(cleaned);
    });
    return candidates[0] || "";
  }

  function splitBatchBlocks(text) {
    const normalized = String(text || "").replace(/\r/g, "").trim();
    if (!normalized) return [];
    const paragraphBlocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    if (paragraphBlocks.length > 1) return paragraphBlocks;
    return normalized.split(/\n/).map((line) => line.trim()).filter(Boolean);
  }

  function parseBatchTitles(text) {
    return splitBatchBlocks(text).map((block) => {
      const sourceUrl = block.match(/https?:\/\/\S+/)?.[0]?.replace(/[，,。]+$/, "") || "";
      const title = extractTitle(block);
      if (!title) return null;
      const platform = detectPlatform(block, sourceUrl);
      const sourceAccount = detectSourceAccount(block);
      const contentType = detectContentType(title);
      const formula = detectFormula(title);
      const emotionHook = detectEmotionHook(title);
      const confidence = [
        sourceUrl ? 1 : 0,
        sourceAccount ? 1 : 0,
        Object.values(metricAliases).some((aliases) => aliases.some((alias) => new RegExp(alias, "i").test(block))) ? 1 : 0,
        title.length >= 8 ? 1 : 0,
      ].reduce((sum, item) => sum + item, 0);
      return {
        id: uid("title"),
        title,
        platform,
        sourceAccount,
        sourceUrl,
        publishedAt: "",
        capturedAt: todayDate(),
        likes: extractMetric(block, "likes"),
        saves: extractMetric(block, "saves"),
        comments: extractMetric(block, "comments"),
        shares: extractMetric(block, "shares"),
        contentType,
        niche: "",
        audience: "",
        formula,
        emotionHook,
        notes: `批量采集导入。原始片段：${block.slice(0, 220)}`,
        confidence: Math.round((confidence / 4) * 100),
      };
    }).filter(Boolean);
  }

  function renderBatchPreview() {
    const preview = $("#batch-title-preview");
    $("#save-batch-titles").disabled = batchTitleDrafts.length === 0;
    if (!batchTitleDrafts.length) {
      preview.innerHTML = `<div class="preview-empty">还没有可入库的标题。请粘贴内容后点击“解析预览”。</div>`;
      return;
    }
    preview.innerHTML = `<table class="data-table">
      <thead><tr><th>标题</th><th>平台</th><th>类型/公式</th><th>互动</th><th>识别</th></tr></thead>
      <tbody>${batchTitleDrafts.map((item) => `<tr>
        <td><div class="preview-title">${escapeHtml(item.title)}</div><div class="preview-sub">${escapeHtml(item.sourceAccount || "未识别来源账号")}${item.sourceUrl ? "｜已识别链接" : ""}</div></td>
        <td>${escapeHtml(item.platform)}</td>
        <td>${escapeHtml(item.contentType)}<div class="preview-sub">${escapeHtml(item.formula)}｜${escapeHtml(item.emotionHook)}</div></td>
        <td>赞 ${number(item.likes)}<div class="preview-sub">藏 ${number(item.saves)}｜评 ${number(item.comments)}｜享 ${number(item.shares)}</div></td>
        <td><span class="confidence-pill">${item.confidence}%</span></td>
      </tr>`).join("")}</tbody>
    </table>`;
  }

  function renderAccounts() {
    $("#account-grid").innerHTML = state.accounts.length ? state.accounts.map((account) => {
      normalizeAccount(account, state.accounts.indexOf(account));
      const info = frequencyInfo(account);
      const posts = state.posts.filter((post) => post.accountId === account.id);
      const published = posts.filter((post) => ["已发布", "复盘完成"].includes(post.status));
      return `<article class="account-card" data-edit-account="${account.id}" style="${accountStyle(account)}">
        <div class="card-topline">
          <div><h3><span class="account-color-dot"></span>${escapeHtml(account.name)}</h3><div class="row-meta">${escapeHtml(account.platform)}｜${escapeHtml(account.owner || "未分配")}</div></div>
          <span class="pill ${account.status === "暂停" ? "coral" : account.status === "观察中" ? "amber" : ""}">${escapeHtml(account.status)}</span>
        </div>
        <p>${escapeHtml(account.position || "未填写账号定位")}</p>
        <div class="bar ${info.ratio < .5 ? "danger" : info.ratio < 1 ? "warn" : ""}"><span style="width:${Math.round(info.ratio * 100)}%"></span></div>
        <div class="account-stats">
          <div><span>本周</span><strong>${info.done}/${info.target}</strong></div>
          <div><span>总发布</span><strong>${published.length}</strong></div>
          <div><span>平均点击</span><strong>${percent(avg(published.map(postClickRate)))}</strong></div>
        </div>
      </article>`;
    }).join("") : empty("还没有账号");
  }

  function renderPosts() {
    renderStagingBoard();
    renderPostCalendar();
  }

  function filteredPosts() {
    const query = $("#post-search").value.trim().toLowerCase();
    const status = $("#post-status-filter").value;
    const accountId = $("#post-account-filter").value;
    return state.posts.filter((post) => {
      const account = accountById(post.accountId);
      const haystack = [post.headline, post.niche, post.contentType, account?.name, account?.platform].join(" ").toLowerCase();
      return (!query || haystack.includes(query))
        && (status === "all" || post.status === status)
        && (accountId === "all" || post.accountId === accountId);
    });
  }

  function postHasAssignedTime(post) {
    return Boolean(post.scheduledAt || post.publishedAt);
  }

  function isProgressStepDone(post, step) {
    return Boolean(post[step.key]);
  }

  function progressDoneCount(post) {
    let count = 0;
    for (const step of progressSteps) {
      if (!isProgressStepDone(post, step)) break;
      count += 1;
    }
    return count;
  }

  function progressInfo(post) {
    const done = progressDoneCount(post);
    return { done, total: progressSteps.length, ratio: done * 20 };
  }

  function progressMarkup(post) {
    const info = progressInfo(post);
    return `<div class="progress-wrap">
      <div class="progress-summary">
        <span>制作进度</span>
        <strong>${info.ratio}%</strong>
      </div>
      <div class="progress-bar" aria-label="进度 ${info.ratio}%"><span style="width:${info.ratio}%"></span></div>
      <div class="progress-steps">
        ${progressSteps.map((step, index) => `<button class="progress-step ${index < info.done ? "done" : ""}" data-progress-post="${post.id}" data-progress-index="${index}" type="button" title="设为：${escapeHtml(step.label)}（${(index + 1) * 20}%）">
          <span>${escapeHtml(step.short)}</span>
          <small>${(index + 1) * 20}%</small>
        </button>`).join("")}
      </div>
    </div>`;
  }

  function renderStagingBoard() {
    const posts = filteredPosts()
      .filter((post) => !postHasAssignedTime(post))
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    $("#staging-board").innerHTML = posts.length ? posts.map((post) => stagingCard(post)).join("") : empty("暂存板没有未分配发布时间的内容。新增选题或清空发布时间后会出现在这里。");
  }

  function stagingCard(post) {
    const account = accountById(post.accountId);
    const info = progressInfo(post);
    return `<article class="staging-card" draggable="true" data-staging-post="${post.id}" style="${accountStyle(account)}">
      <div class="staging-topline">
            <span class="pill amber">未分配时间</span>
            <span class="row-meta">${info.done}/${info.total}</span>
      </div>
      <h3 class="staging-title">${escapeHtml(post.headline || "未命名内容")}</h3>
      <div class="row-meta">${escapeHtml(account?.name || "未选发布账号")}｜${escapeHtml(post.contentType || "未分类")}</div>
      ${progressMarkup(post)}
      <div class="staging-footer">
        <span class="row-meta">发布时间未分配</span>
        <button class="text-button" data-edit-post="${post.id}" type="button">编辑</button>
      </div>
    </article>`;
  }

  function postCalendarDate(post) {
    return String((post.status === "已发布" || post.status === "复盘完成" ? post.publishedAt : post.scheduledAt) || post.publishedAt || post.scheduledAt || "").slice(0, 10);
  }

  function postCalendarDateTime(post) {
    return (post.status === "已发布" || post.status === "复盘完成" ? post.publishedAt : post.scheduledAt) || post.publishedAt || post.scheduledAt || "";
  }

  function calendarPostClass(post) {
    if (post.status === "复盘完成") return "status-review";
    if (post.status === "已发布") return "status-published";
    return "status-draft";
  }

  function renderPostCalendar() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() || 7) - 1));
    const posts = filteredPosts();
    const postsByDate = posts.reduce((map, post) => {
      const key = postCalendarDate(post);
      if (!key) return map;
      map[key] = map[key] || [];
      map[key].push(post);
      return map;
    }, {});
    $("#calendar-title").textContent = `${monthLabel(calendarCursor)}发布日历`;
    const today = todayDate();
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = dateKey(date);
      const dayPosts = (postsByDate[key] || []).sort((a, b) => String(postCalendarDateTime(a)).localeCompare(String(postCalendarDateTime(b))));
      cells.push(`<section class="calendar-day ${date.getMonth() === month ? "" : "outside"} ${key === today ? "today" : ""}" data-calendar-date="${key}">
        <div class="calendar-day-head">
          <span class="calendar-day-number">${date.getDate()}</span>
          ${dayPosts.length ? `<span class="calendar-count">${dayPosts.length} 条</span>` : ""}
        </div>
        <div class="calendar-items">
          ${dayPosts.map((post) => calendarPost(post)).join("")}
        </div>
      </section>`);
    }
    $("#post-calendar").innerHTML = cells.join("") || `<div class="calendar-empty-note">没有符合筛选条件的内容</div>`;
  }

  function calendarPost(post) {
    const account = accountById(post.accountId);
    const publishTime = timePart(postCalendarDateTime(post), "待定");
    const shootingText = post.shootingAt ? `拍摄 ${dateText(post.shootingAt)}` : "未排拍摄";
    return `<article class="calendar-post ${calendarPostClass(post)}" draggable="true" data-calendar-post="${post.id}" style="${accountStyle(account)}">
      <div class="calendar-post-meta">
        <span>${escapeHtml(post.status)}</span>
        <span class="calendar-account"><i></i>${escapeHtml(account?.name || "未关联账号")}</span>
      </div>
      <h3>${escapeHtml(post.headline || "未命名内容")}</h3>
      <div class="calendar-post-meta">
        <span>发布 ${escapeHtml(publishTime)}</span>
        <span>点击 ${percent(postClickRate(post))}</span>
      </div>
      ${progressMarkup(post)}
      <div class="calendar-shoot">${escapeHtml(shootingText)}${post.shootingPlan ? `｜${escapeHtml(post.shootingPlan).slice(0, 32)}` : ""}</div>
      <div class="calendar-post-footer">
        <span class="row-meta">${escapeHtml(post.contentType || "未分类")}</span>
        <button class="text-button" data-edit-post="${post.id}" type="button">编辑</button>
      </div>
    </article>`;
  }

  function movePostToDate(postId, targetDate) {
    const post = state.posts.find((item) => item.id === postId);
    if (!post) return;
    const field = post.status === "已发布" || post.status === "复盘完成" ? "publishedAt" : "scheduledAt";
    const source = post[field] || post.scheduledAt || post.publishedAt || `${targetDate}T20:30`;
    post[field] = `${targetDate}T${timePart(source)}`;
    post.updatedAt = new Date().toISOString();
    scheduleSave();
    renderAll();
    toast(`已移动到 ${targetDate}`);
  }

  function applyProgressThrough(post, index) {
    progressSteps.forEach((step, stepIndex) => {
      post[step.key] = stepIndex <= index;
    });
  }

  function normalizeProgressRecord(record) {
    let lastDone = -1;
    progressSteps.forEach((step, index) => {
      if (record[step.key]) lastDone = index;
    });
    progressSteps.forEach((step, index) => {
      record[step.key] = index <= lastDone;
    });
  }

  function updatePostProgress(postId, index) {
    const post = state.posts.find((item) => item.id === postId);
    if (!post) return;
    applyProgressThrough(post, index);
    post.updatedAt = new Date().toISOString();
    scheduleSave();
    renderAll();
    toast(`制作进度已更新为 ${(index + 1) * 20}%`);
  }

  function postMonth(post) {
    return String(post.publishedAt || post.scheduledAt || "").slice(0, 7);
  }

  function daysSinceDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const today = localDate(todayDate());
    const target = localDate(dateKey(date));
    return Math.floor((today - target) / 86400000);
  }

  function postReviewDateTime(post) {
    return post.publishedAt || post.scheduledAt || "";
  }

  function postReviewAge(post) {
    return daysSinceDate(postReviewDateTime(post));
  }

  function hasCoreStats(post) {
    return totalPostMetric(post, "likes") > 0 || totalPostMetric(post, "saves") > 0 || totalPostMetric(post, "comments") > 0;
  }

  function needsStatsReminder(post) {
    const age = postReviewAge(post);
    return age != null && age >= 7 && !hasCoreStats(post);
  }

  function statsMonthOptions() {
    const months = [...new Set(state.posts.map(postMonth).filter((value) => /^\d{4}-\d{2}$/.test(value)))].sort().reverse();
    if (!months.includes(statsMonth)) months.unshift(statsMonth);
    return months;
  }

  function hydrateStatsMonthFilter() {
    const select = $("#stats-month-filter");
    if (!select) return;
    const options = statsMonthOptions();
    select.innerHTML = options.map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(month.replace("-", "年"))}月</option>`).join("");
    select.value = options.includes(statsMonth) ? statsMonth : options[0];
    statsMonth = select.value;
  }

  function filteredStatsPosts() {
    const query = $("#stats-search")?.value.trim().toLowerCase() || "";
    const accountId = $("#stats-account-filter")?.value || "all";
    return state.posts.filter((post) => {
      const account = accountById(post.accountId);
      const haystack = [post.headline, post.niche, post.contentType, account?.name, account?.platform].join(" ").toLowerCase();
      return postMonth(post) === statsMonth
        && (!query || haystack.includes(query))
        && (accountId === "all" || post.accountId === accountId);
    }).sort((a, b) => totalPostMetric(b, "likes") - totalPostMetric(a, "likes") || String(b.publishedAt || b.scheduledAt).localeCompare(String(a.publishedAt || a.scheduledAt)));
  }

  function renderStats() {
    hydrateStatsMonthFilter();
    const posts = filteredStatsPosts();
    renderStatsReminders(posts);
    renderMonthlyTopFeedback(posts);
    $("#stats-table-body").innerHTML = posts.length ? posts.map((post) => statsRow(post)).join("") : `<tr><td colspan="4">${empty("这个月份还没有可统计的发布记录。")}</td></tr>`;
  }

  function renderStatsReminders(posts) {
    const due = posts.filter(needsStatsReminder).sort((a, b) => String(postReviewDateTime(a)).localeCompare(String(postReviewDateTime(b))));
    $("#stats-reminder-list").innerHTML = due.length ? due.map((post) => {
      const account = accountById(post.accountId);
      return `<article class="stats-reminder-card" data-reminder-post="${escapeHtml(post.id)}">
        <div class="stats-reminder-main">
          <div>
            <strong>${escapeHtml(post.headline || "未命名内容")}</strong>
            <div class="row-meta">${escapeHtml(account?.name || "未关联账号")}｜发布 ${dateText(postReviewDateTime(post))}｜已过 ${postReviewAge(post)} 天</div>
          </div>
          <span class="pill amber">待填写数据</span>
        </div>
        <div class="stats-reminder-editor">
          ${statsPlatforms.map((platform) => platformStatsInputs(post, platform)).join("")}
        </div>
      </article>`;
    }).join("") : empty("当前筛选范围内没有需要补填的数据。");
  }

  function renderMonthlyTopFeedback(posts) {
    const top = posts
      .filter((post) => totalPostMetric(post, "likes") > 0)
      .slice()
      .sort((a, b) => totalPostMetric(b, "likes") - totalPostMetric(a, "likes"))
      .slice(0, 3);
    $("#monthly-top-feedback").innerHTML = top.length ? top.map((post, index) => {
    const account = accountById(post.accountId);
    const likes = totalPostMetric(post, "likes");
    const saves = totalPostMetric(post, "saves");
      const advice = index === 0
        ? "本月优先复用它的选题角度、标题表达和封面结构。"
        : saves > likes ? "收藏表现更强，适合拆成清单或教程。"
        : totalPostMetric(post, "comments") ? "评论有反馈，可以继续观察评论区需求。"
        : "先补点赞、收藏、评论，方便判断内容质量。";
      return `<article class="top-feedback-card">
        <span class="focus-rank">${index + 1}</span>
        <div>
          <h3>${escapeHtml(post.headline || "未命名内容")}</h3>
          <div class="row-meta">${escapeHtml(account?.name || "未关联账号")}｜${escapeHtml(post.contentType || "未分类")}｜${dateText(post.publishedAt || post.scheduledAt)}</div>
          <p>${escapeHtml(advice)}</p>
        </div>
        <div class="top-feedback-score">
          <strong>${likes}</strong>
          <span>合计点赞</span>
        </div>
      </article>`;
    }).join("") : empty("这个月份还没有点赞数据，先在下方表格直接填写。");
  }

  function statsRow(post) {
    const account = accountById(post.accountId);
    const totalLikes = totalPostMetric(post, "likes");
    const totalSaves = totalPostMetric(post, "saves");
    const totalComments = totalPostMetric(post, "comments");
    const totalConversions = totalPostMetric(post, "conversions");
    const reminder = needsStatsReminder(post) ? `<span class="pill amber">发布满7天待填</span>` : "";
    return `<tr data-stats-post="${escapeHtml(post.id)}">
      <td>
        <strong>${escapeHtml(post.headline || "未命名内容")}</strong>
        <div class="row-meta">${escapeHtml(account?.name || "未关联账号")}｜${escapeHtml(post.status)}｜${dateText(post.publishedAt || post.scheduledAt)}</div>
        ${reminder}
      </td>
      ${statsPlatforms.map((platform) => `<td>${platformStatsInputs(post, platform)}</td>`).join("")}
      <td>
        <div class="stats-summary">
          <span>合计点赞 <strong>${totalLikes}</strong></span>
          <span>合计收藏 <strong>${totalSaves}</strong></span>
          <span>合计评论 <strong>${totalComments}</strong></span>
          <span>合计转化 <strong>${totalConversions}</strong></span>
        </div>
      </td>
    </tr>`;
  }

  function platformStatsInputs(post, platform) {
    return `<div class="platform-stats">
      <div class="platform-stats-title">${escapeHtml(platform.label)}</div>
      ${statsMetricFields.map((field) => {
        const value = platformMetric(post, platform.key, field);
        return `<label>${escapeHtml(metricLabels[field])}<button class="stats-value ${value ? "" : "empty"}" data-stats-edit data-post-id="${escapeHtml(post.id)}" data-platform="${escapeHtml(platform.key)}" data-field="${escapeHtml(field)}" data-value="${value}" type="button">${value ? escapeHtml(value) : "未填"}</button></label>`;
      }).join("")}
    </div>`;
  }

  function updateStatsMetric(source) {
    const post = state.posts.find((item) => item.id === source.dataset.postId);
    if (!post) return;
    normalizePostMetrics(post);
    post.platformMetrics[source.dataset.platform][source.dataset.field] = Math.max(0, number(source.value));
    if (source.dataset.platform === "xhs") post[source.dataset.field] = post.platformMetrics.xhs[source.dataset.field];
    post.updatedAt = new Date().toISOString();
    scheduleSave();
    renderStats();
  }

  function startStatsEdit(button) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.inputMode = "numeric";
    input.className = "stats-inline-input";
    input.value = button.dataset.value || "0";
    input.dataset.postId = button.dataset.postId;
    input.dataset.platform = button.dataset.platform;
    input.dataset.field = button.dataset.field;
    button.replaceWith(input);
    input.focus();
    input.select();
    const save = () => updateStatsMetric(input);
    input.addEventListener("change", save, { once: true });
    input.addEventListener("blur", () => {
      if (document.body.contains(input)) save();
    }, { once: true });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") renderStats();
    });
  }

  function topTitles(count = 5) {
    return state.titles.slice().sort((a, b) => titleScore(b) - titleScore(a)).slice(0, count);
  }

  function renderInsights() {
    const formulaCounts = state.titles.reduce((map, title) => {
      map[title.formula] = (map[title.formula] || 0) + 1;
      return map;
    }, {});
    const bestFormula = Object.entries(formulaCounts).sort((a, b) => b[1] - a[1])[0];
    const lowFrequency = state.accounts.map((account) => ({ account, info: frequencyInfo(account) })).filter((item) => item.info.missing > 0 && item.account.status !== "暂停");
    const published = state.posts.filter((post) => ["已发布", "复盘完成"].includes(post.status));
    const byType = contentTypes.map((type) => {
      const posts = published.filter((post) => post.contentType === type);
      return { type, count: posts.length, engagement: avg(posts.map(postEngagement)), click: avg(posts.map(postClickRate)) };
    }).filter((item) => item.count).sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
    const bestTitles = topTitles(4);
    const seasonal = upcomingSeasonalEvents(3);

    $("#insight-grid").innerHTML = [
      insight("节日选题提醒", seasonal.length ? seasonal.map((event) => {
        const products = productsForEvent(event);
        return `<strong>${escapeHtml(event.name)}</strong>：${escapeHtml(seasonalStatus(event))}，方向 ${escapeHtml(event.angle)}${products[0] ? `，优先带 ${escapeHtml(products[0].name)}` : "，先补匹配产品库存"}`;
      }) : ["暂无近期节点。"]),
      insight("下周内容方向", [
        byType[0] ? `优先做 <strong>${escapeHtml(byType[0].type)}</strong>，当前互动率 ${percent(byType[0].engagement)}。` : "先补 3 条已发布数据，系统才能判断内容类型。",
        bestFormula ? `标题公式继续复用 <strong>${escapeHtml(bestFormula[0])}</strong>，标题库中出现 ${bestFormula[1]} 次。` : "标题库还不够，先沉淀 20 条对标标题。",
        topNicheSuggestion(),
      ]),
      insight("账号频率提醒", lowFrequency.length ? lowFrequency.map(({ account, info }) => `<strong>${escapeHtml(account.name)}</strong> 本周还缺 ${info.missing} 条，优先排到 ${escapeHtml(account.preferredSlots || "常规高峰时段")}。`) : ["运营中账号本周都已达到目标频率。"]),
      insight("标题复用池", bestTitles.length ? bestTitles.map((title) => `<strong>${escapeHtml(title.title)}</strong>｜${escapeHtml(title.formula)}｜${escapeHtml(title.emotionHook)}｜热度 ${Math.round(titleScore(title))}`) : ["暂无标题可复用。"]),
      insight("数据登记缺口", dataGaps()),
    ].join("");
  }

  function topNicheSuggestion() {
    const map = {};
    state.posts.forEach((post) => {
      if (!post.niche) return;
      map[post.niche] = map[post.niche] || { count: 0, clicks: [] };
      map[post.niche].count += 1;
      map[post.niche].clicks.push(postClickRate(post));
    });
    const best = Object.entries(map).map(([niche, data]) => ({ niche, count: data.count, click: avg(data.clicks) })).sort((a, b) => (b.click || 0) - (a.click || 0))[0];
    return best ? `赛道上优先补 <strong>${escapeHtml(best.niche)}</strong>，当前平均点击率 ${percent(best.click)}。` : "先给发布记录补充赛道字段。";
  }

  function dataGaps() {
    const gaps = state.posts.filter((post) => needsStatsReminder(post));
    if (!gaps.length) return ["发布满 7 天的内容都已补核心数据。"];
    return gaps.slice(0, 6).map((post) => `<strong>${escapeHtml(post.headline)}</strong> 发布已满 ${postReviewAge(post)} 天，缺点赞/收藏/评论数据。`);
  }

  function insight(title, lines) {
    return `<article class="insight-card"><h2>${title}</h2><ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul></article>`;
  }

  function empty(text) {
    return `<div class="empty-state">${escapeHtml(text)}</div>`;
  }

  function openDialog(id, values = {}) {
    const dialog = $(`#${id}`);
    const form = $("form", dialog);
    form.reset();
    $$("input[type='hidden']", form).forEach((input) => { input.value = ""; });
    Object.entries(values).forEach(([key, value]) => {
      const field = form.elements[key];
      if (!field) return;
      if (field.type === "checkbox") field.checked = value === true || value === "on";
      else field.value = value ?? "";
    });
    $$("[data-delete-title], [data-delete-account], [data-delete-product], [data-delete-post]", form).forEach((button) => {
      button.classList.toggle("hidden", !values.id);
    });
    dialog.showModal();
  }

  function syncProgressFieldset(changedField) {
    const form = $("#post-form");
    const index = progressSteps.findIndex((step) => step.key === changedField.name);
    if (index < 0) return;
    progressSteps.forEach((step, stepIndex) => {
      const field = form.elements[step.key];
      if (!field) return;
      if (changedField.checked) field.checked = stepIndex <= index;
      else if (stepIndex >= index) field.checked = false;
    });
  }

  function openTitleUsageDialog(titleId) {
    const title = titleById(titleId);
    if (!title) return;
    const dialog = $("#title-usage-dialog");
    const form = $("#title-usage-form");
    const usedPosts = postsUsingTitle(titleId);
    form.reset();
    form.elements.titleId.value = titleId;
    $("#title-usage-summary").innerHTML = `<strong>${escapeHtml(title.title)}</strong>
      ${usedPosts.length ? `<div class="usage-link-list">${usedPosts.map((post) => `<span>已关联：${escapeHtml(post.headline)}（${escapeHtml(accountById(post.accountId)?.name || "未关联账号")}）</span>`).join("")}</div>` : "<span>当前未使用。请选择一篇发布记录，保存后它会排到标题库底部。</span>"}`;
    refreshUsagePostSelect(titleId);
    dialog.showModal();
  }

  function refreshUsagePostSelect(titleId) {
    const select = $("#title-usage-form").elements.postId;
    const options = state.posts.map((post) => {
      const account = accountById(post.accountId);
      const linkedTitle = post.titleId ? titleById(post.titleId) : null;
      const label = `${post.headline}｜${account?.name || "未关联账号"}｜${post.status}${linkedTitle && linkedTitle.id !== titleId ? `｜已关联：${linkedTitle.title}` : ""}`;
      return `<option value="${post.id}" ${post.titleId === titleId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
    select.innerHTML = state.posts.length ? `<option value="">选择一篇笔记</option>${options}` : `<option value="">还没有发布记录，请先新增笔记</option>`;
  }

  function closeDialog(id) {
    $(`#${id}`).close();
  }

  function readForm(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function numericFields(record, fields) {
    fields.forEach((field) => { record[field] = number(record[field]); });
    return record;
  }

  function upsert(collection, record) {
    const index = state[collection].findIndex((item) => item.id === record.id);
    if (index >= 0) state[collection][index] = { ...state[collection][index], ...record };
    else state[collection].unshift(record);
  }

  function bindEvents() {
    const closeMobileMore = () => {
      $("#mobile-more-panel")?.classList.remove("open");
      $("#mobile-more-panel")?.setAttribute("aria-hidden", "true");
    };

    document.addEventListener("click", (event) => {
      const jump = event.target.closest("[data-view-jump]");
      if (!jump) return;
      $$(".form-dialog[open]").forEach((dialog) => dialog.close());
      closeMobileMore();
      switchView(jump.dataset.viewJump);
    });
    $$(".tab[data-view]").forEach((button) => button.addEventListener("click", () => {
      closeMobileMore();
      switchView(button.dataset.view);
    }));
    const openMobileMore = () => {
      const panel = $("#mobile-more-panel");
      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
    };
    $("#mobile-more-toggle")?.addEventListener("click", openMobileMore);
    $$("[data-mobile-more]").forEach((button) => button.addEventListener("click", openMobileMore));
    $$("[data-mobile-view]").forEach((button) => button.addEventListener("click", () => {
      closeMobileMore();
      switchView(button.dataset.mobileView);
    }));
    ["mobile-more-close", "mobile-more-backdrop"].forEach((id) => {
      $(`#${id}`)?.addEventListener("click", closeMobileMore);
    });
    $$("[data-view-jump]").forEach((button) => button.addEventListener("click", () => {
      $$(".form-dialog[open]").forEach((dialog) => dialog.close());
      closeMobileMore();
      switchView(button.dataset.viewJump);
    }));
    $$("[data-open]").forEach((button) => button.addEventListener("click", () => {
      const id = button.dataset.open;
      if (id === "title-dialog") openDialog(id, { capturedAt: todayDate(), platform: "小红书", contentType: contentTypes[0], formula: formulas[0], emotionHook: emotionHooks[0] });
      if (id === "batch-title-dialog") openBatchTitleDialog();
      if (id === "account-dialog") openDialog(id, { platform: "小红书", frequencyPerWeek: 5, status: "运营中", color: nextAccountColor() });
      if (id === "product-dialog") openDialog(id, { category: productCategories[0], stock: 0, incomingStock: 0, priority: 5, selected: false });
      if (id === "post-dialog") openDialog(id, { status: "选题", scheduledAt: "", publishedAt: "", shootingAt: "", contentType: contentTypes[0], accountId: "", owner: "" });
    }));
    $$("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));

    ["title-search", "title-platform-filter", "title-type-filter", "title-formula-filter"].forEach((id) => $(`#${id}`).addEventListener("input", renderTitles));
    ["post-search", "post-status-filter", "post-account-filter"].forEach((id) => $(`#${id}`).addEventListener("input", renderPosts));
    ["stats-search", "stats-account-filter"].forEach((id) => $(`#${id}`).addEventListener("input", renderStats));
    $("#stats-month-filter").addEventListener("change", (event) => {
      statsMonth = event.currentTarget.value;
      renderStats();
    });
    $("#stats-view").addEventListener("click", (event) => {
      const button = event.target.closest("[data-stats-edit]");
      if (button) startStatsEdit(button);
    });
    ["product-search", "product-category-filter", "product-stock-filter"].forEach((id) => $(`#${id}`).addEventListener("input", renderProducts));

    $("#title-library").addEventListener("click", (event) => {
      const detailButton = event.target.closest("[data-title-detail]");
      if (detailButton) openDialog("title-dialog", titleById(detailButton.dataset.titleDetail));
      const usageButton = event.target.closest("[data-title-usage]");
      if (usageButton) openTitleUsageDialog(usageButton.dataset.titleUsage);
    });
    $("#account-grid").addEventListener("click", (event) => {
      const card = event.target.closest("[data-edit-account]");
      if (card) openDialog("account-dialog", accountById(card.dataset.editAccount));
    });
    $("#product-grid").addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-toggle-product]");
      if (toggle) {
        const product = productById(toggle.dataset.toggleProduct);
        if (!product) return;
        product.selected = !product.selected;
        ensureFocusOrder(product);
        product.updatedAt = new Date().toISOString();
        scheduleSave();
        renderAll();
        toast(product.selected ? "已设为近期推荐" : "已取消近期推荐");
        return;
      }
      const card = event.target.closest("[data-edit-product]");
      if (card) openDialog("product-dialog", productById(card.dataset.editProduct));
    });
    $("#monthly-focus-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-move-focus]");
      if (button) moveFocusProduct(button.dataset.moveFocus, Number(button.dataset.direction));
    });
    $("#monthly-focus-list").addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-focus-product]");
      if (!card) return;
      event.dataTransfer.setData("text/plain", card.dataset.focusProduct);
      event.dataTransfer.effectAllowed = "move";
    });
    $("#monthly-focus-list").addEventListener("dragover", (event) => {
      const card = event.target.closest("[data-focus-product]");
      if (!card) return;
      event.preventDefault();
      card.classList.add("drag-over");
    });
    $("#monthly-focus-list").addEventListener("dragleave", (event) => {
      const card = event.target.closest("[data-focus-product]");
      if (card) card.classList.remove("drag-over");
    });
    $("#monthly-focus-list").addEventListener("drop", (event) => {
      const card = event.target.closest("[data-focus-product]");
      if (!card) return;
      event.preventDefault();
      card.classList.remove("drag-over");
      reorderFocusProducts(event.dataTransfer.getData("text/plain"), card.dataset.focusProduct);
    });
    $("#post-calendar").addEventListener("click", (event) => {
      const progressButton = event.target.closest("[data-progress-post]");
      if (progressButton) {
        updatePostProgress(progressButton.dataset.progressPost, Number(progressButton.dataset.progressIndex));
        return;
      }
      const button = event.target.closest("[data-edit-post]");
      if (button) openDialog("post-dialog", state.posts.find((post) => post.id === button.dataset.editPost));
    });
    $("#staging-board").addEventListener("click", (event) => {
      const progressButton = event.target.closest("[data-progress-post]");
      if (progressButton) {
        updatePostProgress(progressButton.dataset.progressPost, Number(progressButton.dataset.progressIndex));
        return;
      }
      const button = event.target.closest("[data-edit-post]");
      if (button) openDialog("post-dialog", state.posts.find((post) => post.id === button.dataset.editPost));
    });
    $("#staging-board").addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-staging-post]");
      if (!card) return;
      event.dataTransfer.setData("text/plain", card.dataset.stagingPost);
      event.dataTransfer.effectAllowed = "move";
    });
    $("#post-calendar").addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-calendar-post]");
      if (!card) return;
      event.dataTransfer.setData("text/plain", card.dataset.calendarPost);
      event.dataTransfer.effectAllowed = "move";
    });
    $("#post-calendar").addEventListener("dragover", (event) => {
      const day = event.target.closest("[data-calendar-date]");
      if (!day) return;
      event.preventDefault();
      day.classList.add("drag-over");
    });
    $("#post-calendar").addEventListener("dragleave", (event) => {
      const day = event.target.closest("[data-calendar-date]");
      if (day) day.classList.remove("drag-over");
    });
    $("#post-calendar").addEventListener("drop", (event) => {
      const day = event.target.closest("[data-calendar-date]");
      if (!day) return;
      event.preventDefault();
      day.classList.remove("drag-over");
      const postId = event.dataTransfer.getData("text/plain");
      if (postId) movePostToDate(postId, day.dataset.calendarDate);
    });

    $("#calendar-prev").addEventListener("click", () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
      renderPosts();
    });
    $("#calendar-next").addEventListener("click", () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
      renderPosts();
    });
    $("#calendar-today").addEventListener("click", () => {
      const now = new Date();
      calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
      renderPosts();
    });

    $("#title-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const record = numericFields(readForm(event.currentTarget), ["likes", "saves", "comments", "shares"]);
      record.id = record.id || uid("title");
      upsert("titles", record);
      closeDialog("title-dialog");
      scheduleSave();
      renderAll();
      toast("标题已保存");
    });

    $("#account-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const record = numericFields(readForm(event.currentTarget), ["frequencyPerWeek"]);
      record.id = record.id || uid("account");
      normalizeAccount(record, state.accounts.length);
      upsert("accounts", record);
      closeDialog("account-dialog");
      scheduleSave();
      renderAll();
      toast("账号已保存");
    });

    $("#product-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const record = numericFields(readForm(event.currentTarget), ["stock", "incomingStock", "priority"]);
      record.selected = Boolean(record.selected);
      record.id = record.id || uid("product");
      record.updatedAt = new Date().toISOString();
      if (record.selected) {
        const existing = productById(record.id);
        record.focusOrder = number(existing?.focusOrder) || state.products.reduce((max, item) => Math.max(max, number(item.focusOrder)), 0) + 1;
      } else {
        record.focusOrder = 0;
      }
      upsert("products", record);
      normalizeFocusOrders();
      closeDialog("product-dialog");
      scheduleSave();
      renderAll();
      toast("产品已保存");
    });

    $("#save-inventory-settings").addEventListener("click", () => {
      state.inventorySettings = {
        backendName: $("#inventory-backend-name").value.trim(),
        backendUrl: $("#inventory-backend-url").value.trim(),
        lastSyncedAt: $("#inventory-synced-at").value,
      };
      scheduleSave();
      renderAll();
      toast("订货后台设置已保存");
    });
    $("#sync-wholesale-products").addEventListener("click", syncWholesaleProducts);

    $("#post-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const record = numericFields(readForm(event.currentTarget), ["exposure", "clicks", "likes", "saves", "comments", "shares", "follows", "conversions"]);
      const existing = state.posts.find((post) => post.id === record.id);
      if (existing?.platformMetrics) record.platformMetrics = structuredClone(existing.platformMetrics);
      normalizePostMetrics(record);
      metricFields.forEach((field) => {
        record.platformMetrics.xhs[field] = number(record[field]);
      });
      progressSteps.forEach((step) => {
        record[step.key] = Boolean(record[step.key]);
      });
      normalizeProgressRecord(record);
      record.id = record.id || uid("post");
      record.updatedAt = new Date().toISOString();
      upsert("posts", record);
      closeDialog("post-dialog");
      scheduleSave();
      renderAll();
      toast("发布记录已保存");
    });

    $("#parse-batch-titles").addEventListener("click", () => {
      batchTitleDrafts = parseBatchTitles($("#batch-title-input").value);
      renderBatchPreview();
      toast(batchTitleDrafts.length ? `识别到 ${batchTitleDrafts.length} 条标题` : "没有识别到标题");
    });

    $("#save-batch-titles").addEventListener("click", () => {
      if (!batchTitleDrafts.length) return;
      const existingKeys = new Set(state.titles.map((title) => `${title.title.trim()}|${title.sourceUrl || ""}`));
      const incoming = batchTitleDrafts
        .map(({ confidence, ...item }) => item)
        .filter((item) => {
          const key = `${item.title.trim()}|${item.sourceUrl || ""}`;
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        });
      if (!incoming.length) {
        toast("没有新增，标题已存在");
        return;
      }
      state.titles.unshift(...incoming);
      batchTitleDrafts = [];
      $("#batch-title-input").value = "";
      renderBatchPreview();
      closeDialog("batch-title-dialog");
      scheduleSave();
      renderAll();
      toast(`已入库 ${incoming.length} 条标题`);
    });

    $("#title-usage-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const { titleId, postId } = readForm(event.currentTarget);
      if (!titleId || !postId) {
        toast("请选择要关联的笔记");
        return;
      }
      const post = state.posts.find((item) => item.id === postId);
      if (!post) {
        toast("没有找到这篇笔记");
        return;
      }
      post.titleId = titleId;
      if (!post.headline && titleById(titleId)) post.headline = titleById(titleId).title;
      closeDialog("title-usage-dialog");
      scheduleSave();
      renderAll();
      toast("标题已关联到笔记");
    });

    $("[data-delete-title]").addEventListener("click", () => deleteCurrent("title-dialog", "titles", "标题已删除"));
    $("[data-delete-account]").addEventListener("click", () => deleteCurrent("account-dialog", "accounts", "账号已删除"));
    $("[data-delete-product]").addEventListener("click", () => deleteCurrent("product-dialog", "products", "产品已删除"));
    $("[data-delete-post]").addEventListener("click", () => deleteCurrent("post-dialog", "posts", "记录已删除"));

    $("#export-data").addEventListener("click", exportData);
    $("#import-data").addEventListener("change", importData);
    $("#migrate-file-data").addEventListener("click", migrateFileData);
    $("#copy-brief").addEventListener("click", copyBrief);
    progressSteps.forEach((step) => {
      $("#post-form").elements[step.key].addEventListener("change", (event) => syncProgressFieldset(event.currentTarget));
    });
  }

  function deleteCurrent(dialogId, collection, message) {
    const form = $(`#${dialogId} form`);
    const id = form.elements.id.value;
    if (!id) return;
    state[collection] = state[collection].filter((item) => item.id !== id);
    if (collection === "accounts") state.posts.forEach((post) => { if (post.accountId === id) post.accountId = ""; });
    if (collection === "titles") state.posts.forEach((post) => { if (post.titleId === id) post.titleId = ""; });
    closeDialog(dialogId);
    scheduleSave();
    renderAll();
    toast(message);
  }

  function openBatchTitleDialog() {
    batchTitleDrafts = [];
    $("#batch-title-input").value = "";
    renderBatchPreview();
    $("#batch-title-dialog").showModal();
  }

  function switchView(view) {
    const secondaryViews = ["titles", "accounts", "products", "insights"];
    $$(".tab[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    $("#mobile-more-toggle")?.classList.toggle("active", secondaryViews.includes(view));
    $$("[data-mobile-view]").forEach((button) => button.classList.toggle("active", button.dataset.mobileView === view));
    $$("[data-mobile-more]").forEach((button) => button.classList.toggle("active", secondaryViews.includes(view)));
    $$(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}-view`));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `content-ops-${todayDate()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported.titles) || !Array.isArray(imported.accounts) || !Array.isArray(imported.posts)) throw new Error("invalid");
        state = normalizeState(imported);
        scheduleSave();
        hydrateControls();
        renderAll();
        toast("备份已导入");
      } catch {
        toast("导入失败，文件格式不对");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function copyBrief() {
    const lines = [];
    lines.push("内容运营简报");
    lines.push(`本周已发布：${thisWeekPublished().length} 条`);
    state.accounts.forEach((account) => {
      const info = frequencyInfo(account);
      lines.push(`${account.name}：${info.done}/${info.target}，${info.missing ? `还缺 ${info.missing} 条` : "已达标"}`);
    });
    const product = selectedProducts()[0];
    if (product) lines.push(`近期主推产品：${product.name}（库存 ${number(product.stock)}）`);
    const event = upcomingSeasonalEvents(1)[0];
    if (event) lines.push(`节日提醒：${event.name}，${seasonalStatus(event)}，建议方向：${event.angle}`);
    const title = topTitles(1)[0];
    if (title) lines.push(`可复用标题：${title.title}（${title.formula}/${title.emotionHook}）`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("简报已复制");
    } catch {
      toast("浏览器不允许复制，请手动选择导出");
    }
  }

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove("show"), 2200);
  }

  bindEvents();
  loadState();
})();
