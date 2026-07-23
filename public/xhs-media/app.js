(() => {
  const STORAGE_KEY = "xhs_media_placements_v1";
  const PLACEMENTS_STATUS_BACKUP_KEY = "xhs_media_placements_before_status_migration_v1";
  const CREATORS_STORAGE_KEY = "xhs_media_creators_v1";
  const MIRROR_CREATORS_STORAGE_KEYS = ["xhs_media_creators_seed_v2"];
  const CREATORS_BACKUP_STORAGE_KEY = "xhs_media_creators_before_last_classification_v1";
  const CREATOR_TYPES_STORAGE_KEY = "xhs_media_creator_types_v1";
  const LOCAL_META_STORAGE_KEY = "xhs_media_local_meta_v1";
  const MONTHLY_BUDGETS_STORAGE_KEY = "xhs_media_monthly_budgets_v1";
  const RECOVERY_DONE_KEY = "xhs_media_recovery_20260712_done";
  const SNAPSHOT_RESTORE_DONE_KEY = "xhs_media_snapshot_restore_20260712_done";
  const MORNING_RECOVERY_DONE_KEY = "xhs_media_morning_recovery_20260713_done";
  const RECOVERY_CREATORS_KEYS = ["xhs_media_creators_t", "xhs_media_creators_c", "xhs_media_creators_backup", CREATORS_BACKUP_STORAGE_KEY];
  const RECOVERY_PLACEMENTS_KEYS = ["placements_c", "xhs_media_placements_c", "xhs_media_placements_t", PLACEMENTS_STATUS_BACKUP_KEY];
  const CURRENT_DATA_URL = "current-data.json?v=20260712-confirmed";
  const MORNING_RECOVERY_URL = "recovered-creators-20260713-morning.json?v=20260713-morning";
  const API_URL = "/api/xhs-media/state";
  const CREATORS_SEED_URL = "creators-seed.json?v=20260710-seed-data";
  const CREATORS_SEED_SOURCE = "合作博主合并排序表.xlsx";
  const MIN_SEED_CREATOR_ROWS = 450;
  const LEGACY_TEST_PLACEMENT_IDS = new Set(["placement-1", "placement-2", "placement-3"]);
  const LEGACY_TEST_CREATORS = new Set(["梨梨爱护肤", "小鱼的生活研究所", "月月穿搭日记"]);
  const WHOLESALE_PRODUCTS_API = "/api/content-ops/wholesale-products";
  const DEFAULT_WHOLESALE_ADMIN_URL = "https://pupuhome-wholesale.onrender.com/admin.html";
  const WHOLESALE_PRODUCTS_FALLBACK_URL = "../wholesale-portal/data/products.json";
  const WHOLESALE_PORTAL_URL = "../wholesale-portal/partner.html";
  const WHOLESALE_KEYS = {
    inventory: "mtm_wholesale_inventory_v1",
    productSettings: "mtm_wholesale_product_settings_v1",
    customProducts: "mtm_wholesale_custom_products_v1",
    costSettings: "mtm_wholesale_cost_settings_v1",
  };
  const statuses = ["待建联", "待寄样", "已寄样", "已签收", "脚本已确认", "等待发布", "已发布"];
  const sampleStatuses = ["未寄样", "待寄样", "已寄样", "寄样中", "已签收", "无需寄样"];
  const draftStatuses = ["未申请", "已申请", "已通过", "需修改", "无需申请"];
  const creatorTiers = ["素人", "KOC", "腰部达人", "头部达人", "垂类博主", "品牌合作方"];
  const creatorTypes = ["未分类", "美女头像博主", "好物开箱博主", "玩偶头像博主", "vlog博主", "口播博主", "剧情种草博主", "母婴博主", "宠物博主", "家居博主", "穿搭博主", "美妆护肤博主"];
  const creatorOutreachStatuses = ["待建联", "草稿已生成", "已发出", "已回复", "已加微信", "不合适"];
  const contentTypes = ["测评种草", "合集植入", "单品笔记", "探店体验", "直播预热", "活动宣发", "买手推荐"];
  const platformOptions = ["小红书", "抖音"];
  const priorityRank = { 最高: 1, 高: 2, 中: 3, 低: 4, 暂无: 5 };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const uid = () => `xhs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const number = (value) => Number(value || 0);
  const money = (value) => `¥${Math.round(number(value)).toLocaleString("zh-CN")}`;
  const compact = (value) => number(value).toLocaleString("zh-CN");
  const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(value >= .1 ? 0 : 1)}%` : "无";
  const ratio = (value) => Number.isFinite(value) ? value.toFixed(2) : "无";
  const placementPlatform = (item) => platformOptions.includes(item?.platform) ? item.platform : "小红书";
  const today = () => new Date().toISOString().slice(0, 10);
  const creatorKey = (name) => String(name || "").replace(/\s+/g, "").toLowerCase();
  const creatorId = (name) => `creator-${String(name || "unknown").replace(/[^\u4e00-\u9fffa-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || uid()}`;
  const normalizeProfileLink = (value) => {
    const text = String(value || "").trim();
    const embeddedUrl = text.match(/https?:\/\/[^\s<>"'，。]+/i)?.[0];
    if (embeddedUrl) return embeddedUrl.replace(/[)\]】》]+$/, "");
    if (/^www\./i.test(text)) return `https://${text}`;
    if (/^(?:xiaohongshu\.com|xhslink\.com)\//i.test(text)) return `https://${text}`;
    return "";
  };
  const fanCountFromText = (value) => {
    const text = String(value || "").trim().toLowerCase().replaceAll(",", "");
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return number(value);
    const base = Number(match[1]);
    return Math.round((text.includes("w") || text.includes("万")) ? base * 10000 : base);
  };
  const creatorTierByFans = (fans) => {
    const count = number(fans);
    if (count >= 200000) return "头部";
    if (count >= 30000) return "中部";
    if (count >= 3000) return "尾部";
    return "素人";
  };
  const daysSince = (value) => {
    if (!value) return NaN;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return NaN;
    const now = new Date(`${today()}T00:00:00`);
    return Math.floor((now - date) / 86400000);
  };
  const progress = (value) => {
    const match = String(value || "0/1").match(/(\d+)\s*(?:\/|of|条|篇)\s*(\d+)?/i);
    if (!match) return { done: 0, required: 1, label: "0/1" };
    const done = number(match[1]);
    const required = number(match[2] || 1) || 1;
    return { done, required, label: `${done}/${required}` };
  };
  const normalizePlacementStatus = (value, item = {}) => {
    if (String(item.publishedAt || "").trim()) return "已发布";
    const aliases = {
      待建联: "待建联",
      建联中: "待建联",
      已建联未回复: "待建联",
      待寄样: "待寄样",
      寄样中: "已寄样",
      已寄样: "已寄样",
      已签收待发布: "已签收",
      已签收: "已签收",
      脚本确认: "脚本已确认",
      脚本已确认: "脚本已确认",
      排期中: "等待发布",
      已跟进: "等待发布",
      已发布部分: "等待发布",
      等待发布: "等待发布",
      已发布: "已发布",
      复盘完成: "已发布",
    };
    const normalizedValue = aliases[value] || value;
    if (
      String(item.sampleTrackingNumber || item.trackingNumber || item.shippingTrackingNumber || item.expressNo || item.logisticsNo || "").trim() &&
      !["已签收", "脚本已确认", "等待发布", "已发布"].includes(normalizedValue)
    ) return "已寄样";
    if (aliases[value]) return aliases[value];
    if (item.sampleStatus === "已签收") return "已签收";
    if (item.sampleStatus === "已寄样" || item.sampleStatus === "寄样中") return "已寄样";
    return "待建联";
  };
  const statusClass = (status) => ({
    待建联: "status-slate",
    待寄样: "status-amber",
    已寄样: "status-blue",
    已签收: "status-violet",
    脚本已确认: "status-coral",
    等待发布: "status-teal",
    已发布: "status-green",
  }[status] || "status-slate");

  const seedPlacements = [];
  const legacySeedPlacements = [
    {
      id: "placement-1",
      creator: "梨梨爱护肤",
      creatorTier: "垂类博主",
      product: "夏季防晒套组",
      contentType: "测评种草",
      contactMethod: "小红书私信",
      owner: "Chloe",
      status: "复盘完成",
      sampleStatus: "已签收",
      sampleDeliveredAt: "2026-06-29",
      deliverableProgress: "1/1",
      agreedPublishAt: "2026-07-03",
      draftStatus: "已通过",
      draftSubmittedAt: "2026-06-30",
      lastContactAt: "2026-07-04",
      followUpCount: 1,
      creatorResponse: "已发布",
      plannedAt: "2026-07-02",
      publishedAt: "2026-07-03",
      fee: 3800,
      extraCost: 260,
      exposure: 96000,
      clicks: 12800,
      likes: 2100,
      saves: 3280,
      comments: 316,
      shares: 240,
      leads: 184,
      orders: 52,
      gmv: 23800,
      url: "",
      noteTitle: "晒不黑的通勤防晒，我今年只留这套",
      notes: "评论区追问肤感和补涂频率，适合追加一篇通勤补涂场景。",
    },
    {
      id: "placement-2",
      creator: "小鱼的生活研究所",
      creatorTier: "KOC",
      product: "收纳香氛礼盒",
      contentType: "合集植入",
      contactMethod: "微信",
      owner: "Nora",
      status: "已发布",
      sampleStatus: "已签收",
      sampleDeliveredAt: "2026-07-02",
      deliverableProgress: "1/2",
      agreedPublishAt: "2026-07-08",
      draftStatus: "已申请",
      draftSubmittedAt: "2026-07-05",
      lastContactAt: "2026-07-06",
      followUpCount: 1,
      creatorResponse: "已发布第一篇",
      plannedAt: "2026-07-05",
      publishedAt: "2026-07-05",
      fee: 1200,
      extraCost: 180,
      exposure: 38500,
      clicks: 4300,
      likes: 620,
      saves: 880,
      comments: 72,
      shares: 96,
      leads: 46,
      orders: 11,
      gmv: 4980,
      url: "",
      noteTitle: "小卧室变香的7个低成本办法",
      notes: "收藏不错，成交弱，评论更关心留香时间。",
    },
    {
      id: "placement-3",
      creator: "月月穿搭日记",
      creatorTier: "腰部达人",
      product: "早秋通勤衬衫",
      contentType: "单品笔记",
      contactMethod: "小红书私信",
      owner: "Chloe",
      status: "脚本确认",
      sampleStatus: "已签收",
      sampleDeliveredAt: "2026-07-06",
      deliverableProgress: "0/1",
      agreedPublishAt: "2026-07-11",
      draftStatus: "未申请",
      draftSubmittedAt: "",
      lastContactAt: "2026-07-07",
      followUpCount: 0,
      creatorResponse: "已确认脚本方向",
      plannedAt: today(),
      publishedAt: "",
      fee: 5200,
      extraCost: 320,
      exposure: 0,
      clicks: 0,
      likes: 0,
      saves: 0,
      comments: 0,
      shares: 0,
      leads: 0,
      orders: 0,
      gmv: 0,
      url: "",
      noteTitle: "一件衬衫撑住早秋通勤衣橱",
      notes: "脚本需要突出免烫和版型，不要只拍氛围图。",
    },
  ];

  recoverLocalData();

  let placements = loadPlacements();
  let creators = loadCreators();
  let customCreatorTypes = loadCustomCreatorTypes();
  let monthlyBudgets = loadMonthlyBudgets();
  let productCatalog = [];
  let wholesaleCostStatus = { connected: false, orderCount: 0, costSettingsCount: 0, costSeedCount: 0, reason: "" };
  let selectedProduct = "all";
  let classificationCreatorId = "";
  let activeBriefPlacementId = "";
  let activeBriefDraft = null;
  let activeOutreachCreatorIds = [];
  let selectedCreatorIds = new Set();
  let apiOnline = false;
  let applyingServerState = false;
  let remoteSaveTimer = null;
  let remoteSaveInFlight = null;
  let remoteSaveQueued = false;
  let remoteLoadInFlight = null;
  let remoteRefreshTimer = null;
  let hasCurrentSessionChanges = false;
  let overviewPeriod = today().slice(0, 7);
  let ledgerPeriod = today().slice(0, 7);

  function loadPlacements() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const source = (Array.isArray(saved) ? saved : structuredClone(seedPlacements)).filter((item) => !isLegacyTestPlacement(item));
      const normalized = source.map((item) => ({ ...item, status: normalizePlacementStatus(item.status, item) }));
      if (Array.isArray(saved) && (saved.length !== source.length || source.some((item, index) => item.status !== normalized[index].status))) {
        if (!localStorage.getItem(PLACEMENTS_STATUS_BACKUP_KEY)) {
          localStorage.setItem(PLACEMENTS_STATUS_BACKUP_KEY, JSON.stringify(saved));
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    } catch {
      return [];
    }
  }

  function recoveryCreatorMetrics(rows) {
    return {
      total: rows.length,
      complete: rows.filter(creatorClassificationComplete).length,
      blacklisted: rows.filter((item) => item.isBlacklisted).length,
      seedRows: rows.filter((item) => item.source === CREATORS_SEED_SOURCE).length,
    };
  }

  function recoveryPlacementMetrics(rows) {
    return {
      total: rows.length,
      julyPublished: rows.filter((item) => String(item.publishedAt || "").startsWith("2026-07")).length,
      waiting: rows.filter((item) => !item.publishedAt && (item.plannedAt || item.agreedPublishAt || ["已签收", "脚本已确认", "等待发布"].includes(item.status))).length,
    };
  }

  function recoveryScoreCreators(rows) {
    const metrics = recoveryCreatorMetrics(rows);
    let score = 0;
    score -= Math.abs(metrics.complete - 103) * 10;
    score -= Math.abs(metrics.blacklisted - 2) * 25;
    score += Math.min(metrics.total, 200);
    score -= metrics.seedRows >= MIN_SEED_CREATOR_ROWS ? 500 : 0;
    return score;
  }

  function recoveryScorePlacements(rows) {
    const metrics = recoveryPlacementMetrics(rows);
    let score = 0;
    score -= Math.abs(metrics.julyPublished - 2) * 40;
    score += Math.min(metrics.waiting, 8) * 10;
    score += Math.min(metrics.total, 30);
    score -= rows.some(isLegacyTestPlacement) ? 200 : 0;
    return score;
  }

  function readArrayFromStorage(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function bestRecoveryCandidate(keys, normalize, score, minScore = -Infinity) {
    return keys
      .map((key) => ({ key, rows: readArrayFromStorage(key).map(normalize) }))
      .filter((item) => item.rows.length)
      .map((item) => ({ ...item, score: score(item.rows) }))
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score || b.rows.length - a.rows.length)[0] || null;
  }

  function recoverLocalData() {
    if (localStorage.getItem(RECOVERY_DONE_KEY)) return;
    const currentCreators = readArrayFromStorage(CREATORS_STORAGE_KEY).map(normalizeCreator);
    const currentPlacements = readArrayFromStorage(STORAGE_KEY);
    const currentCreatorMetrics = recoveryCreatorMetrics(currentCreators);
    const currentPlacementMetrics = recoveryPlacementMetrics(currentPlacements);
    const needsCreatorRecovery = currentCreatorMetrics.complete !== 103 || currentCreatorMetrics.blacklisted !== 2 || currentCreatorMetrics.seedRows >= MIN_SEED_CREATOR_ROWS;
    const needsPlacementRecovery = currentPlacementMetrics.julyPublished !== 2 || currentPlacements.some(isLegacyTestPlacement);
    const creatorCandidate = needsCreatorRecovery
      ? bestRecoveryCandidate(RECOVERY_CREATORS_KEYS, normalizeCreator, recoveryScoreCreators)
      : null;
    const placementCandidate = needsPlacementRecovery
      ? bestRecoveryCandidate(RECOVERY_PLACEMENTS_KEYS, (item) => item, recoveryScorePlacements)
      : null;

    if (creatorCandidate && creatorCandidate.score > recoveryScoreCreators(currentCreators)) {
      localStorage.setItem(`xhs_media_creators_before_recovery_${Date.now()}`, JSON.stringify(currentCreators));
      localStorage.setItem(CREATORS_STORAGE_KEY, JSON.stringify(creatorCandidate.rows));
      MIRROR_CREATORS_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, JSON.stringify(creatorCandidate.rows)));
    }

    if (placementCandidate && placementCandidate.score > recoveryScorePlacements(currentPlacements)) {
      localStorage.setItem(`xhs_media_placements_before_recovery_${Date.now()}`, JSON.stringify(currentPlacements));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(placementCandidate.rows.filter((item) => !isLegacyTestPlacement(item))));
    }

    localStorage.setItem(RECOVERY_DONE_KEY, JSON.stringify({
      at: new Date().toISOString(),
      currentCreators: currentCreatorMetrics,
      currentPlacements: currentPlacementMetrics,
      creatorCandidate: creatorCandidate ? { key: creatorCandidate.key, score: creatorCandidate.score, metrics: recoveryCreatorMetrics(creatorCandidate.rows) } : null,
      placementCandidate: placementCandidate ? { key: placementCandidate.key, score: placementCandidate.score, metrics: recoveryPlacementMetrics(placementCandidate.rows) } : null,
    }));
  }

  async function loadRecoveredSnapshot() {
    const creatorMetrics = recoveryCreatorMetrics(creators);
    const placementMetrics = recoveryPlacementMetrics(placements);
    const hasLegacyTests = creators.some(isLegacyTestCreator) || placements.some(isLegacyTestPlacement);
    const hasSavedCreators = readArrayFromStorage(CREATORS_STORAGE_KEY).length > 0;
    const hasSavedPlacements = readArrayFromStorage(STORAGE_KEY).length > 0;
    const rememberSnapshotState = (reason) => {
      localStorage.setItem(SNAPSHOT_RESTORE_DONE_KEY, JSON.stringify({
        at: new Date().toISOString(),
        reason,
        creatorMetrics,
        placementMetrics,
      }));
    };
    if (localStorage.getItem(SNAPSHOT_RESTORE_DONE_KEY) && hasSavedCreators && hasSavedPlacements && !hasLegacyTests) return;
    const alreadyRestored = (
      creatorMetrics.complete === 103 &&
      creatorMetrics.blacklisted === 2 &&
      placementMetrics.julyPublished === 2 &&
      !hasLegacyTests
    );
    if (alreadyRestored) {
      rememberSnapshotState("current-data-confirmed");
      return;
    }
    if (hasSavedCreators && hasSavedPlacements && !hasLegacyTests) {
      rememberSnapshotState("local-edits-preserved");
      return;
    }
    try {
      const response = await fetch(CURRENT_DATA_URL, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const recoveredCreators = (Array.isArray(data.creators) ? data.creators : []).map(normalizeCreator).filter((item) => !isLegacyTestCreator(item));
      const recoveredPlacements = (Array.isArray(data.placements) ? data.placements : []).filter((item) => !isLegacyTestPlacement(item));
      const recoveredCreatorMetrics = recoveryCreatorMetrics(recoveredCreators);
      const recoveredPlacementMetrics = recoveryPlacementMetrics(recoveredPlacements);
      if (
        recoveredCreatorMetrics.complete !== 103 ||
        recoveredCreatorMetrics.blacklisted !== 2 ||
        recoveredPlacementMetrics.julyPublished !== 2
      ) return;
      localStorage.setItem(`xhs_media_creators_before_snapshot_restore_${Date.now()}`, JSON.stringify(creators));
      localStorage.setItem(`xhs_media_placements_before_snapshot_restore_${Date.now()}`, JSON.stringify(placements));
      creators = recoveredCreators;
      placements = recoveredPlacements.map((item) => ({ ...item, status: normalizePlacementStatus(item.status, item) }));
      saveCreators();
      savePlacements();
      rememberSnapshotState("snapshot-restored");
      hydrateControls();
      renderAll();
      toast("已恢复到 103 位完善达人、2 个黑名单、2 条7月已发布");
    } catch {
      // Snapshot recovery is optional; local editing remains available.
    }
  }

  async function loadMorningRecovery() {
    if (localStorage.getItem(MORNING_RECOVERY_DONE_KEY)) return;
    try {
      const response = await fetch(MORNING_RECOVERY_URL, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const rows = Array.isArray(data.creators) ? data.creators.map(normalizeCreator).filter((item) => item.name) : [];
      if (!rows.length) return;
      const existing = new Set(creators.map((item) => creatorKey(item.name)));
      const missing = rows.filter((item) => !existing.has(creatorKey(item.name)));
      const markDone = () => localStorage.setItem(MORNING_RECOVERY_DONE_KEY, JSON.stringify({
        at: new Date().toISOString(),
        source: data.source || MORNING_RECOVERY_URL,
        candidates: rows.map((item) => item.name),
        restored: missing.map((item) => item.name),
      }));
      if (!missing.length) {
        markDone();
        return;
      }
      localStorage.setItem(`xhs_media_creators_before_morning_recovery_${Date.now()}`, JSON.stringify(creators));
      creators = [...creators, ...missing];
      saveCreators();
      markDone();
      hydrateControls();
      renderAll();
      toast(`已恢复今天上午新增的 ${missing.length} 位达人`);
    } catch {
      // Morning recovery is a one-time safety merge; normal editing remains available.
    }
  }

  function loadCreators() {
    try {
      const primary = parseLocalArray(CREATORS_STORAGE_KEY);
      const backup = parseLocalArray(CREATORS_BACKUP_STORAGE_KEY);
      const seedRows = primary.filter((item) => item?.source === CREATORS_SEED_SOURCE).length;
      if (backup.length && primary.length > backup.length && seedRows >= MIN_SEED_CREATOR_ROWS) {
        localStorage.setItem(CREATORS_STORAGE_KEY, JSON.stringify(backup));
        MIRROR_CREATORS_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, JSON.stringify(backup)));
      }
      const merged = new Map();
      for (const key of [CREATORS_STORAGE_KEY, ...MIRROR_CREATORS_STORAGE_KEYS]) {
        const saved = JSON.parse(localStorage.getItem(key));
        if (!Array.isArray(saved)) continue;
        saved.map(normalizeCreator).forEach((creator) => {
          if (!creator.name) return;
          const existing = merged.get(creatorKey(creator.name));
          merged.set(creatorKey(creator.name), existing ? { ...creator, ...existing } : creator);
        });
      }
      return Array.from(merged.values());
    } catch {
      return [];
    }
  }

  function parseLocalArray(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function isLegacyTestPlacement(item) {
    return Boolean(
      item &&
      (LEGACY_TEST_PLACEMENT_IDS.has(item.id) || LEGACY_TEST_CREATORS.has(item.creator)) &&
      !normalizeProfileLink(item.url)
    );
  }

  function isLegacyTestCreator(item) {
    return Boolean(item && LEGACY_TEST_CREATORS.has(item.name));
  }

  function loadLocalMeta() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_META_STORAGE_KEY));
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }

  function writeLocalMeta(meta) {
    localStorage.setItem(LOCAL_META_STORAGE_KEY, JSON.stringify({
      ...loadLocalMeta(),
      ...meta,
    }));
  }

  function markLocalChanged() {
    const clientUpdatedAt = new Date().toISOString();
    hasCurrentSessionChanges = true;
    writeLocalMeta({ clientUpdatedAt, needsSync: true });
    return clientUpdatedAt;
  }

  function markServerSynced(serverUpdatedAt, clientUpdatedAt) {
    hasCurrentSessionChanges = false;
    writeLocalMeta({
      clientUpdatedAt: clientUpdatedAt || loadLocalMeta().clientUpdatedAt || serverUpdatedAt || new Date().toISOString(),
      serverUpdatedAt: serverUpdatedAt || new Date().toISOString(),
      needsSync: false,
    });
  }

  function hasPendingLocalSync() {
    return Boolean(loadLocalMeta().needsSync);
  }

  function localStateIsNewerThanRemote(remoteState, localState) {
    const meta = loadLocalMeta();
    if (!meta.needsSync || !meta.clientUpdatedAt || !hasUsefulXhsState(localState)) return false;
    const localTime = Date.parse(meta.clientUpdatedAt);
    const remoteTime = Date.parse(remoteState?.clientUpdatedAt || remoteState?.updatedAt || "");
    if (!Number.isFinite(localTime)) return false;
    const local = xhsStateCounts(localState);
    const remote = xhsStateCounts(remoteState);
    const remoteIsOlder = !Number.isFinite(remoteTime) || localTime > remoteTime;
    return remoteIsOlder && local.creators >= remote.creators && local.placements >= remote.placements;
  }

  function saveCreators(options = {}) {
    localStorage.setItem(CREATORS_STORAGE_KEY, JSON.stringify(creators));
    MIRROR_CREATORS_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, JSON.stringify(creators)));
    if (options.markDirty !== false) markLocalChanged();
    const status = $("#save-status");
    if (status) status.textContent = `达人库已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    if (options.remote !== false) scheduleServerSave();
  }

  function loadCustomCreatorTypes() {
    try {
      const saved = JSON.parse(localStorage.getItem(CREATOR_TYPES_STORAGE_KEY));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function saveCustomCreatorTypes(options = {}) {
    localStorage.setItem(CREATOR_TYPES_STORAGE_KEY, JSON.stringify(customCreatorTypes));
    if (options.markDirty !== false) markLocalChanged();
    if (options.remote !== false) scheduleServerSave();
  }

  function loadMonthlyBudgets() {
    try {
      const saved = JSON.parse(localStorage.getItem(MONTHLY_BUDGETS_STORAGE_KEY));
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }

  function saveMonthlyBudgets(options = {}) {
    localStorage.setItem(MONTHLY_BUDGETS_STORAGE_KEY, JSON.stringify(monthlyBudgets));
    if (options.markDirty !== false) markLocalChanged();
    if (options.remote !== false) scheduleServerSave();
  }

  function savePlacements(options = {}) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(placements));
    if (options.markDirty !== false) markLocalChanged();
    $("#save-status").textContent = `已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    if (options.remote !== false) scheduleServerSave();
  }

  function writeLocalState() {
    localStorage.setItem(CREATORS_STORAGE_KEY, JSON.stringify(creators));
    MIRROR_CREATORS_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, JSON.stringify(creators)));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(placements));
    localStorage.setItem(CREATOR_TYPES_STORAGE_KEY, JSON.stringify(customCreatorTypes));
    localStorage.setItem(MONTHLY_BUDGETS_STORAGE_KEY, JSON.stringify(monthlyBudgets));
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

  function xhsRevisionTime(state) {
    const parsed = Date.parse(state?.updatedAt || state?.clientUpdatedAt || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function localServerRevisionTime() {
    const parsed = Date.parse(loadLocalMeta().serverUpdatedAt || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function localClientRevisionTime() {
    const parsed = Date.parse(loadLocalMeta().clientUpdatedAt || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function shouldSkipRemoteApply(remoteState, localState, options = {}) {
    if (options.force) return false;
    if (hasPendingLocalSync()) return false;
    const remoteTime = xhsRevisionTime(remoteState);
    if (!remoteTime || remoteTime > localServerRevisionTime()) return false;
    const remote = xhsStateCounts(remoteState);
    const local = xhsStateCounts(localState);
    return remote.creators === local.creators && remote.placements === local.placements;
  }

  function remoteStateShouldWin(remoteState, localState) {
    if (!hasUsefulXhsState(localState)) return true;
    if (!hasUsefulXhsState(remoteState)) return false;
    const remoteTime = xhsRevisionTime(remoteState);
    const localTime = localClientRevisionTime();
    const remote = xhsStateCounts(remoteState);
    const local = xhsStateCounts(localState);
    if (remoteTime && (!localTime || remoteTime >= localTime)) return true;
    if (remote.creators > local.creators || remote.placements > local.placements) return true;
    return false;
  }

  function hasOpenEditorDialog() {
    return $$("dialog").some((dialog) => dialog.open);
  }

  function isRemoteDataRegression(remoteState, localState) {
    const remote = xhsStateCounts(remoteState);
    const local = xhsStateCounts(localState);
    if (!hasUsefulXhsState(localState)) return false;
    if (!hasUsefulXhsState(remoteState)) return true;
    if (local.creators >= 50 && remote.creators < Math.floor(local.creators * 0.5)) return true;
    if (local.placements >= 10 && remote.placements < Math.floor(local.placements * 0.5)) return true;
    return false;
  }

  function backupLocalState(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    localStorage.setItem(`xhs_media_creators_backup_${reason}_${stamp}`, JSON.stringify(creators));
    localStorage.setItem(`xhs_media_placements_backup_${reason}_${stamp}`, JSON.stringify(placements));
    localStorage.setItem(`xhs_media_creator_types_backup_${reason}_${stamp}`, JSON.stringify(customCreatorTypes));
    localStorage.setItem(`xhs_media_monthly_budgets_backup_${reason}_${stamp}`, JSON.stringify(monthlyBudgets));
  }

  function xhsStatePayload() {
    const meta = loadLocalMeta();
    return {
      creators,
      placements,
      customCreatorTypes,
      monthlyBudgets,
      clientUpdatedAt: meta.clientUpdatedAt || new Date().toISOString(),
    };
  }

  function scheduleServerSave() {
    if (applyingServerState) return;
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(() => saveServerState({ force: true }), 420);
  }

  function flushServerSave() {
    clearTimeout(remoteSaveTimer);
    return saveServerState({ force: true });
  }

  function syncServerInBackground() {
    flushServerSave().then((ok) => {
      if (ok) toast("云端已同步");
    }).catch(() => {});
  }

  function scheduleServerRefresh(delay = 12000) {
    clearTimeout(remoteRefreshTimer);
    remoteRefreshTimer = setTimeout(async () => {
      await loadServerState({ silent: true });
      scheduleServerRefresh(document.hidden ? 45000 : 12000);
    }, delay);
  }

  function refreshServerSoon(delay = 1200) {
    clearTimeout(remoteRefreshTimer);
    scheduleServerRefresh(delay);
  }

  async function saveServerState(options = {}) {
    if (applyingServerState) return false;
    if (!apiOnline && !options.force) return false;
    if (remoteSaveInFlight) {
      remoteSaveQueued = true;
      return remoteSaveInFlight;
    }
    const payload = xhsStatePayload();
    if (!hasUsefulXhsState(payload)) {
      $("#save-status").textContent = "空数据未同步，避免覆盖云端";
      return false;
    }
    $("#save-status").textContent = "正在同步云端...";
    remoteSaveInFlight = (async () => {
      try {
        const response = await fetch(API_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (response.status === 409) {
          apiOnline = true;
          $("#save-status").textContent = "云端已阻止异常覆盖，请刷新同步";
          return false;
        }
        if (!response.ok) throw new Error("server save failed");
        const result = await response.json();
        apiOnline = true;
        markServerSynced(result.updatedAt, payload.clientUpdatedAt);
        $("#save-status").textContent = `云端已保存 ${new Date(result.updatedAt || Date.now()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
        refreshServerSoon(1500);
        return true;
      } catch {
        apiOnline = false;
        $("#save-status").textContent = "云端暂不可用，本机改动待同步";
        return false;
      }
    })();
    try {
      return await remoteSaveInFlight;
    } finally {
      remoteSaveInFlight = null;
      if (remoteSaveQueued) {
        remoteSaveQueued = false;
        await saveServerState({ force: true });
      }
    }
  }

  async function loadServerState(options = {}) {
    if (remoteLoadInFlight) return remoteLoadInFlight;
    if (!options.force && hasOpenEditorDialog()) {
      refreshServerSoon(3500);
      return false;
    }
    remoteLoadInFlight = (async () => {
      try {
        let response = await fetch(API_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("server unavailable");
        let data = await response.json();
        if (!Array.isArray(data.creators) || !Array.isArray(data.placements)) throw new Error("invalid server state");
        let localState = { creators, placements, customCreatorTypes, monthlyBudgets };
        if (hasPendingLocalSync() && hasUsefulXhsState(localState)) {
          apiOnline = true;
          const localShouldSave = hasCurrentSessionChanges || (localStateIsNewerThanRemote(data, localState) && !remoteStateShouldWin(data, localState));
          if (localShouldSave) {
            if (!options.silent) $("#save-status").textContent = "检测到本机有未同步改动，正在合并云端";
            await saveServerState({ force: true });
            response = await fetch(API_URL, { cache: "no-store" });
            if (!response.ok) throw new Error("server unavailable");
            data = await response.json();
            if (!Array.isArray(data.creators) || !Array.isArray(data.placements)) throw new Error("invalid server state");
            localState = { creators, placements, customCreatorTypes, monthlyBudgets };
          } else {
            backupLocalState("stale_pending_before_cloud_apply");
            hasCurrentSessionChanges = false;
            if (!options.silent) $("#save-status").textContent = "云端版本较新，已跳过本机旧缓存";
          }
        }
        if (shouldSkipRemoteApply(data, localState, options)) {
          apiOnline = true;
          return true;
        }
        if (isRemoteDataRegression(data, localState)) {
          apiOnline = true;
          if (!options.silent) $("#save-status").textContent = "云端数据疑似为空，已保留本机并回写云端";
          await saveServerState({ force: true });
          return true;
        }
        const beforeCounts = xhsStateCounts(localState);
        applyingServerState = true;
        if (!options.silent && hasUsefulXhsState(localState)) backupLocalState("before_server_apply");
        creators = data.creators.map(normalizeCreator).filter((item) => !isLegacyTestCreator(item));
        placements = data.placements.filter((item) => !isLegacyTestPlacement(item)).map((item) => ({ ...item, status: normalizePlacementStatus(item.status, item) }));
        customCreatorTypes = Array.isArray(data.customCreatorTypes) ? data.customCreatorTypes : customCreatorTypes;
        monthlyBudgets = data.monthlyBudgets && typeof data.monthlyBudgets === "object" && !Array.isArray(data.monthlyBudgets) ? data.monthlyBudgets : monthlyBudgets;
        writeLocalState();
        markServerSynced(data.updatedAt, data.clientUpdatedAt);
        apiOnline = true;
        hydrateControls();
        renderAll();
        const afterCounts = xhsStateCounts({ creators, placements });
        const countChanged = beforeCounts.creators !== afterCounts.creators || beforeCounts.placements !== afterCounts.placements;
        if (!options.silent || countChanged) {
          $("#save-status").textContent = `云端已同步 ${new Date(data.updatedAt || Date.now()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
        }
        return true;
      } catch {
        apiOnline = false;
        if (!options.silent) $("#save-status").textContent = "本机数据已启用，服务器保存未连接";
        return false;
      } finally {
        applyingServerState = false;
      }
    })();
    try {
      return await remoteLoadInFlight;
    } finally {
      remoteLoadInFlight = null;
    }
  }

  function loadLocalJson(key, fallback) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved ?? fallback;
    } catch {
      return fallback;
    }
  }

  function firstNumber(...values) {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function normalizeProduct(product) {
    const unitCost = firstNumber(product.unitCost, product.cost, product.productCost, product.purchaseCost);
    return {
      id: String(product.id || product.code || product.name || ""),
      code: String(product.code || product.sku || product.productCode || ""),
      name: String(product.name || ""),
      category: String(product.category || ""),
      status: String(product.status || product.stockStatus || "需确认"),
      price: number(product.price),
      unitCost,
      costSource: String(product.costSource || (unitCost ? "订货后台成本" : "")),
      costConnected: Boolean(product.costConnected && unitCost),
      costComponents: Array.isArray(product.costComponents) ? product.costComponents : [],
      unit: String(product.unit || "件"),
      image: String(product.image || product.imageUrl || ""),
      backendUrl: String(product.backendUrl || ""),
      specifications: String(product.specifications || ""),
      packText: String(product.packText || ""),
    };
  }

  async function loadWholesaleProducts() {
    try {
      let baseProducts = [];
      const response = await fetch(`${WHOLESALE_PRODUCTS_API}?url=${encodeURIComponent(DEFAULT_WHOLESALE_ADMIN_URL)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("products unavailable");
      const payload = await response.json();
      baseProducts = Array.isArray(payload.products) ? payload.products : [];
      wholesaleCostStatus = {
        connected: Boolean(payload.costConnected),
        orderCount: number(payload.orderCount),
        costSettingsCount: number(payload.costSettingsCount),
        costSeedCount: number(payload.costSeedCount),
        reason: String(payload.costConnectionReason || ""),
      };
      const customProducts = loadLocalJson(WHOLESALE_KEYS.customProducts, []);
      const settings = loadLocalJson(WHOLESALE_KEYS.productSettings, {});
      const inventory = loadLocalJson(WHOLESALE_KEYS.inventory, {});
      const merged = [...(Array.isArray(baseProducts) ? baseProducts : []), ...(Array.isArray(customProducts) ? customProducts : [])].map((product) => {
        const setting = settings[product.id] || {};
        return {
          ...product,
          ...setting,
          status: inventory[product.id] || setting.status || product.status,
          image: setting.image || product.image,
        };
      });
      productCatalog = Array.from(new Map(merged.map(normalizeProduct).filter((item) => item.id && item.name).map((item) => [item.id, item])).values());
      hydrateControls();
      renderAll();
    } catch {
      try {
        const response = await fetch(WHOLESALE_PRODUCTS_FALLBACK_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("fallback products unavailable");
        const baseProducts = await response.json();
        wholesaleCostStatus = { connected: false, orderCount: 0, costSettingsCount: 0, costSeedCount: 0, reason: "fallback" };
        productCatalog = Array.from(new Map((Array.isArray(baseProducts) ? baseProducts : []).map(normalizeProduct).filter((item) => item.id && item.name).map((item) => [item.id, item])).values());
        hydrateControls();
        renderAll();
      } catch {
        productCatalog = [];
      }
    }
  }

  function productUrl(product) {
    if (product?.backendUrl) return product.backendUrl;
    const query = encodeURIComponent(product?.code || product?.name || "");
    return `${WHOLESALE_PORTAL_URL}${query ? `?product=${query}` : ""}`;
  }

  function findCatalogProduct(value) {
    const key = String(value || "").trim();
    if (!key) return null;
    const direct = productCatalog.find((item) => item.id === key || item.code === key || item.name === key);
    if (direct) return direct;
    const lookupKey = productLookupKey(key);
    return productCatalog.find((item) => (
      productLookupKey(item.id) === lookupKey ||
      productLookupKey(item.code) === lookupKey ||
      productLookupKey(item.name) === lookupKey ||
      productLookupKey(productOptionLabel(item)) === lookupKey
    )) || null;
  }

  function productForPlacement(item) {
    return findCatalogProduct(item.productId) || findCatalogProduct(item.productCode) || findCatalogProduct(item.product);
  }

  function placementProducts(item) {
    const ids = Array.isArray(item.productIds) ? item.productIds : String(item.productIds || item.productId || "").split(",");
    const codes = Array.isArray(item.productCodes) ? item.productCodes : String(item.productCodes || item.productCode || "").split(",");
    const products = [...ids, ...codes].map(findCatalogProduct).filter(Boolean);
    if (products.length) return Array.from(new Map(products.map((product) => [product.id, product])).values());
    const single = productForPlacement(item);
    return single ? [single] : [];
  }

  function placementProductName(item) {
    const products = placementProducts(item);
    if (products.length) return products.map((product) => product.name).join("、");
    return item.product || "未填产品";
  }

  function productKeysForPlacement(item) {
    const values = [
      item.product,
      item.productId,
      item.productCode,
      ...(Array.isArray(item.productIds) ? item.productIds : String(item.productIds || "").split(",")),
      ...(Array.isArray(item.productCodes) ? item.productCodes : String(item.productCodes || "").split(",")),
      ...productSegments(item.product),
      ...placementProducts(item).flatMap((product) => [product.id, product.code, product.name, productOptionLabel(product)]),
    ];
    return new Set(values.map(productLookupKey).filter(Boolean));
  }

  function productKeysForPlacementForm(form) {
    const values = [
      form.elements.product?.value,
      form.elements.productId?.value,
      form.elements.productCode?.value,
      ...(form.elements.productIds?.value || "").split(","),
      ...(form.elements.productCodes?.value || "").split(","),
      ...productSegments(form.elements.product?.value || ""),
      ...selectedWholesaleProductsFromForm().flatMap((product) => [product.id, product.code, product.name, productOptionLabel(product)]),
    ];
    return new Set(values.map(productLookupKey).filter(Boolean));
  }

  function findDuplicateCooperationsFromForm() {
    const form = $("#placement-form");
    if (!form) return [];
    const creatorName = String(form.elements.creator?.value || "").trim();
    if (!creatorName) return [];
    const currentId = String(form.elements.id?.value || "");
    const draftKeys = productKeysForPlacementForm(form);
    if (!draftKeys.size) return [];
    return placements
      .filter((item) => item.id !== currentId && creatorKey(item.creator) === creatorKey(creatorName))
      .map((item) => {
        const matched = [...productKeysForPlacement(item)].filter((key) => draftKeys.has(key));
        return matched.length ? { item, matched } : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(placementDate(b.item) || b.item.updatedAt || "").localeCompare(String(placementDate(a.item) || a.item.updatedAt || "")));
  }

  function renderDuplicateCooperationWarning() {
    const panel = $("#duplicate-cooperation-panel");
    if (!panel) return;
    const matches = findDuplicateCooperationsFromForm();
    panel.hidden = !matches.length;
    if (!matches.length) {
      panel.innerHTML = "";
      return;
    }
    const creatorName = $("#placement-form")?.elements.creator?.value || "这个达人";
    panel.innerHTML = `
      <div class="duplicate-cooperation-head">
        <strong>${escapeHtml(creatorName)} 已合作过相同/相近产品</strong>
        <span>${matches.length} 条历史记录</span>
      </div>
      <div class="duplicate-cooperation-list">
        ${matches.map(({ item }) => `
          <article class="duplicate-cooperation-item">
            <div>
              <strong>${escapeHtml(placementProductName(item))}</strong>
              <span>状态 ${escapeHtml(item.status || "未填")} · 约定 ${escapeHtml(publishDueDate(item) || "未填")} · 实际 ${escapeHtml(item.publishedAt || "未填")}</span>
              <small>${compact(item.likes)}赞 · ${compact(item.saves)}收藏 · ${compact(item.comments)}评论</small>
            </div>
            <button type="button" class="secondary-button small" data-duplicate-placement="${escapeHtml(item.id)}">查看记录</button>
          </article>
        `).join("")}
      </div>
    `;
  }

  function sampleQuantity(item) {
    const quantity = number(item.sampleQuantity || item.productQuantity || 1);
    return quantity > 0 ? quantity : 1;
  }

  function productUnitCost(product) {
    return firstNumber(product?.unitCost, product?.cost, product?.productCost, product?.purchaseCost);
  }

  function productCostLabel(product) {
    const cost = productUnitCost(product);
    return cost ? `${money(cost)} ${product.costSource ? `· ${product.costSource}` : ""}` : "成本未连接";
  }

  function productsCostTotal(products, quantity = 1) {
    return uniqueProducts(products).reduce((sum, product) => sum + productUnitCost(product) * quantity, 0);
  }

  function placementProductCost(item) {
    const products = placementProducts(item);
    const liveCost = productsCostTotal(products, sampleQuantity(item));
    if (liveCost) return liveCost;
    return item.productCostConnected ? number(item.productCostSnapshot) : 0;
  }

  function placementCostStatus(item) {
    const products = placementProducts(item);
    if (!products.length) return { linked: false, complete: false, missing: true, label: "未关联产品" };
    const missing = products.filter((product) => !productUnitCost(product)).length;
    if (missing) return { linked: true, complete: false, missing: true, label: `${missing} 个产品缺成本` };
    return { linked: true, complete: true, missing: false, label: "已关联成本" };
  }

  function placementDate(item) {
    return item.publishedAt || item.agreedPublishAt || item.plannedAt || item.scheduledAt || "";
  }

  function formatChineseDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : "待确认";
  }

  function shiftDate(value, days) {
    if (!value) return "";
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function needsDraftReview(item) {
    if (item.requiresDraftReview === "no" || item.requiresDraftReview === false) return false;
    if (item.requiresDraftReview === "yes" || item.requiresDraftReview === true) return true;
    return item.draftStatus !== "无需申请";
  }

  function cooperationBriefData(item) {
    const reviewRequired = needsDraftReview(item);
    const publishDate = item.agreedPublishAt || "";
    return {
      creator: item.creator || "待确认",
      product: placementProductName(item) || "待确认",
      cooperation: String(item.notes || "").trim() || "请确认具体内容形式与拍摄要求",
      publishAt: formatChineseDate(publishDate),
      review: reviewRequired ? "需要审核" : "无需审核",
      reviewDeadline: reviewRequired ? formatChineseDate(shiftDate(publishDate, -1)) : "不适用",
      changeNotice: publishDate
        ? `如无法按约定时间发布，请最晚于${formatChineseDate(shiftDate(publishDate, -7))}告知。`
        : "如无法按约定时间发布，请至少提前一周告知。",
    };
  }

  function cooperationBriefText(item) {
    const brief = cooperationBriefData(item);
    return [
      "合作要求确认",
      `博主账号：${brief.creator}`,
      `合作产品：${brief.product}`,
      `合作形式：${brief.cooperation}`,
      `约定发布时间：${brief.publishAt}`,
      `稿件审核：${brief.review}`,
      `最晚提交审核稿时间：${brief.reviewDeadline}`,
      `发布时间变更：${brief.changeNotice}`,
      "宝宝请确认一下以上的合作内容，特别是时间以及内容～",
    ].join("\n");
  }

  function openCooperationBrief(item) {
    if (!item) return;
    activeBriefPlacementId = item.id || "";
    activeBriefDraft = { ...item };
    const brief = cooperationBriefData(item);
    $("#brief-preview").innerHTML = `
      <div class="brief-creator">
        <span>合作确认单</span>
        <strong>${escapeHtml(brief.creator)}</strong>
      </div>
      <dl class="brief-fields">
        <div><dt>合作产品</dt><dd>${escapeHtml(brief.product)}</dd></div>
        <div><dt>合作形式</dt><dd>${escapeHtml(brief.cooperation)}</dd></div>
        <div><dt>约定发布时间</dt><dd>${escapeHtml(brief.publishAt)}</dd></div>
        <div><dt>稿件审核</dt><dd>${escapeHtml(brief.review)}</dd></div>
        <div><dt>最晚提交审核稿</dt><dd>${escapeHtml(brief.reviewDeadline)}</dd></div>
        <div><dt>发布时间变更</dt><dd>${escapeHtml(brief.changeNotice)}</dd></div>
      </dl>
      <p class="brief-confirmation">宝宝请确认一下以上的合作内容，特别是时间以及内容～</p>
    `;
    $("#brief-dialog").showModal();
  }

  function activeBriefItem() {
    return activeBriefDraft || placements.find((placement) => placement.id === activeBriefPlacementId);
  }

  function placementFormDraft() {
    const form = $("#placement-form");
    if (!form.reportValidity()) return null;
    return formToPlacement(form);
  }

  function openPlacementFormBrief() {
    const item = placementFormDraft();
    if (!item) return;
    openCooperationBrief(item);
  }

  function downloadPlacementFormBriefImage() {
    const item = placementFormDraft();
    if (!item) return;
    downloadCooperationBriefImage(item);
  }

  function canvasLines(context, text, maxWidth) {
    const lines = [];
    String(text || "").split("\n").forEach((paragraph) => {
      let line = "";
      Array.from(paragraph).forEach((char) => {
        const next = line + char;
        if (line && context.measureText(next).width > maxWidth) {
          lines.push(line);
          line = char;
        } else {
          line = next;
        }
      });
      lines.push(line || " ");
    });
    return lines;
  }

  function downloadCooperationBriefImage(item) {
    const brief = cooperationBriefData(item);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const width = 1200;
    const fields = [
      ["博主账号", brief.creator],
      ["合作产品", brief.product],
      ["合作形式", brief.cooperation],
      ["约定发布时间", brief.publishAt],
      ["稿件审核", brief.review],
      ["最晚提交审核稿", brief.reviewDeadline],
      ["发布时间变更", brief.changeNotice],
    ];
    context.font = '36px "PingFang SC", "Microsoft YaHei", sans-serif';
    const measured = fields.map(([label, value]) => ({ label, lines: canvasLines(context, value, 960) }));
    const height = Math.max(1260, 390 + measured.reduce((sum, field) => sum + 82 + field.lines.length * 54, 0));
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#f7f4ee";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#123c43";
    context.fillRect(0, 0, width, 220);
    context.fillStyle = "#d5ad67";
    context.font = '700 28px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText("COLLABORATION BRIEF", 80, 78);
    context.fillStyle = "#ffffff";
    context.font = '700 58px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText("合作要求确认", 80, 158);
    let y = 290;
    measured.forEach((field) => {
      context.fillStyle = "#9a6b2f";
      context.font = '700 26px "PingFang SC", "Microsoft YaHei", sans-serif';
      context.fillText(field.label, 80, y);
      y += 54;
      context.fillStyle = "#182235";
      context.font = '36px "PingFang SC", "Microsoft YaHei", sans-serif';
      field.lines.forEach((line) => {
        context.fillText(line, 80, y);
        y += 54;
      });
      y += 28;
      context.strokeStyle = "#ddd4c6";
      context.beginPath();
      context.moveTo(80, y);
      context.lineTo(width - 80, y);
      context.stroke();
      y += 44;
    });
    context.fillStyle = "#17665d";
    context.font = '700 30px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText("宝宝请确认一下以上的合作内容，特别是时间以及内容～", 80, height - 70);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `合作要求-${String(item.creator || "博主").replace(/[^\u4e00-\u9fffa-zA-Z0-9]+/g, "-")}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast("合作要求图片已生成");
    }, "image/png");
  }

  function creatorEmail(item) {
    const text = [item.email, item.contactAddress, item.wechat].join(" ");
    return String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  }

  function creatorWechat(item) {
    return String(item?.wechat || "").trim();
  }

  function creatorOutreachStatus(item) {
    if (String(item.wechat || "").trim()) return "已加微信";
    return item.outreachStatus || "待建联";
  }

  function canOutreachCreator(item) {
    return Boolean(item && !item.isBlacklisted && !String(item.wechat || "").trim() && creatorOutreachStatus(item) !== "不合适");
  }

  function canEmailOutreachCreator(item) {
    return Boolean(item && !item.isBlacklisted && creatorEmail(item) && creatorOutreachStatus(item) !== "不合适");
  }

  function canOutreachTarget(item) {
    return canOutreachCreator(item) || canEmailOutreachCreator(item);
  }

  function canWechatQueueCreator(item) {
    return Boolean(item && !item.isBlacklisted && creatorWechat(item));
  }

  function canSelectCreator(item) {
    return canOutreachTarget(item) || canWechatQueueCreator(item);
  }

  function creatorCreatedDate(item) {
    return String(item?.createdAt || "").slice(0, 10);
  }

  function creatorEmailSentDate(item) {
    return String(item?.outreachEmailSentAt || "").slice(0, 10);
  }

  function creatorHasSentEmail(item) {
    return Boolean(creatorEmailSentDate(item) || creatorOutreachStatus(item) === "已发出");
  }

  function matchesCreatorAddedFilter(item, filter) {
    const createdAt = creatorCreatedDate(item);
    if (filter === "all") return true;
    if (filter === "no-date") return !createdAt;
    if (!createdAt) return false;
    const age = daysSince(createdAt);
    if (filter === "today") return age === 0;
    if (filter === "yesterday") return age === 1;
    if (filter === "7days") return Number.isFinite(age) && age >= 0 && age <= 7;
    return true;
  }

  function creatorOutreachSubject(item) {
    return `小红书合作邀约｜${item.name || "博主"}`;
  }

  function creatorOutreachText(item) {
    return [
      "宝宝你好呀，我是Chloe。",
      "",
      "看到你的账号内容风格很适合我们这边的小红书合作，想先和你建联沟通一下～",
      "",
      `博主账号：${item.name || "待确认"}`,
      "合作方向：小红书种草/测评/合集等内容合作，具体产品和形式可以根据你的账号风格沟通确认",
      "",
      "如果你这边方便的话，麻烦回复一下微信或常用联系方式，以及近期可合作档期和报价，我这边再同步具体产品和内容细节～",
    ].join("\n");
  }

  function outreachDialogRows() {
    const addedFilter = $("#outreach-added-filter")?.value || "today";
    const emailFilter = $("#outreach-email-filter")?.value || "unsent-email";
    const statusFilter = $("#outreach-status-filter")?.value || "all";
    return creators
      .filter((item) => activeOutreachCreatorIds.includes(item.id))
      .filter(canOutreachTarget)
      .filter((item) => {
        if (!matchesCreatorAddedFilter(item, addedFilter)) return false;
        const hasEmail = Boolean(creatorEmail(item));
        const hasSent = creatorHasSentEmail(item);
        if (emailFilter === "unsent-email" && (!hasEmail || hasSent)) return false;
        if (emailFilter === "email" && !hasEmail) return false;
        if (emailFilter === "sent" && !hasSent) return false;
        if (statusFilter !== "all" && creatorOutreachStatus(item) !== statusFilter) return false;
        return true;
      });
  }

  function renderOutreachDialog() {
    const items = outreachDialogRows();
    const selectedCount = activeOutreachCreatorIds.length;
    const emailCount = items.filter((item) => creatorEmail(item)).length;
    const sentCount = items.filter(creatorHasSentEmail).length;
    $("#outreach-email-target").textContent = `已选择 ${selectedCount} 位达人，当前筛选 ${items.length} 位`;
    $("#outreach-filter-summary").innerHTML = `
      <span>当前可发邮箱 ${emailCount} 位</span>
      <span>已发过邮件 ${sentCount} 位</span>
      <span>筛选会保留手动勾选的达人范围</span>
    `;
    $("#outreach-preview").innerHTML = items.length ? items.map((item) => {
      const emailSentAt = creatorEmailSentDate(item);
      return `
        <article class="outreach-draft" data-outreach-draft="${escapeHtml(item.id)}">
          <div class="outreach-draft-head">
            <div>
              <span class="eyebrow">DRAFT</span>
              <strong>${escapeHtml(item.name)}</strong>
              <div class="outreach-draft-meta">
                <span>新增：${escapeHtml(creatorCreatedDate(item) || "未记录")}</span>
                <span>邮件：${emailSentAt ? `已发 ${escapeHtml(emailSentAt)}` : "未发"}</span>
                ${item.outreachEmailSentCount ? `<span>次数：${number(item.outreachEmailSentCount)}</span>` : ""}
              </div>
            </div>
            <span class="pill ${creatorEmail(item) ? "green" : "amber"}">${creatorEmail(item) ? "有邮箱" : "缺邮箱"}</span>
          </div>
          <div class="outreach-editor-grid">
            <label>收件邮箱<input data-outreach-to value="${escapeHtml(creatorEmail(item))}" placeholder="没有邮箱时可先复制正文" /></label>
            <label>邮件标题<input data-outreach-subject value="${escapeHtml(creatorOutreachSubject(item))}" /></label>
            <label class="wide">邮件正文<textarea data-outreach-body rows="8">${escapeHtml(creatorOutreachText(item))}</textarea></label>
          </div>
        </article>
      `;
    }).join("") : `<div class="empty-state">当前筛选下没有可建联达人。可以切换新增时间或邮件状态。</div>`;
  }

  function openCreatorOutreachDialog(rows) {
    const items = rows.filter(canOutreachTarget);
    if (!items.length) {
      toast("请先选择有邮箱或可建联的达人");
      return;
    }
    activeOutreachCreatorIds = items.map((item) => item.id);
    const hasToday = items.some((item) => matchesCreatorAddedFilter(item, "today"));
    $("#outreach-added-filter").value = hasToday ? "today" : "all";
    $("#outreach-email-filter").value = "unsent-email";
    $("#outreach-status-filter").value = "all";
    renderOutreachDialog();
    $("#outreach-dialog").showModal();
  }

  function outreachDraftsFromDialog() {
    return $$("[data-outreach-draft]", $("#outreach-preview")).map((node) => ({
      id: node.dataset.outreachDraft,
      email: $("[data-outreach-to]", node).value.trim(),
      subject: $("[data-outreach-subject]", node).value.trim(),
      body: $("[data-outreach-body]", node).value.trim(),
    }));
  }

  function updateCreatorsFromOutreachDrafts(drafts, status, options = {}) {
    drafts.forEach((draft) => {
      const creator = creators.find((item) => item.id === draft.id);
      if (!creator) return;
      if (draft.email) creator.email = draft.email;
      if (!String(creator.wechat || "").trim()) creator.outreachStatus = status;
      creator.lastOutreachAt = today();
      if (options.emailSent && draft.email) {
        creator.outreachEmailSentAt = today();
        creator.outreachEmailSentCount = number(creator.outreachEmailSentCount) + 1;
        creator.outreachEmailSubject = draft.subject;
      }
    });
    saveCreators();
    renderCreators();
    if ($("#outreach-dialog")?.open) renderOutreachDialog();
  }

  async function copyOutreachDrafts() {
    const drafts = outreachDraftsFromDialog();
    if (!drafts.length) return;
    const text = drafts.map((draft, index) => [
      `${index + 1}. ${creators.find((item) => item.id === draft.id)?.name || "达人"}`,
      draft.email ? `收件邮箱：${draft.email}` : "收件邮箱：未填写",
      `邮件标题：${draft.subject}`,
      draft.body,
    ].join("\n")).join("\n\n---\n\n");
    updateCreatorsFromOutreachDrafts(drafts, "草稿已生成");
    await copyText(text, "建联草稿已复制");
  }

  function openCreatorMailDrafts() {
    const drafts = outreachDraftsFromDialog();
    const emailDrafts = drafts.filter((draft) => draft.email);
    if (!emailDrafts.length) {
      copyOutreachDrafts();
      return;
    }
    emailDrafts.forEach((draft, index) => {
      const subject = encodeURIComponent(draft.subject);
      const body = encodeURIComponent(draft.body);
      setTimeout(() => {
        window.location.href = `mailto:${draft.email}?subject=${subject}&body=${body}`;
      }, index * 650);
    });
    updateCreatorsFromOutreachDrafts(emailDrafts, "已发出", { emailSent: true });
    toast(`已准备打开 ${emailDrafts.length} 封邮件草稿，并已记录发送日期`);
  }

  function openWechatQueueDialog(rows) {
    const items = rows.filter(canWechatQueueCreator);
    if (!items.length) {
      toast("当前筛选里没有已填写微信号的达人");
      return;
    }
    $("#wechat-target").textContent = `已整理 ${items.length} 位达人，复制后到微信里搜索添加`;
    $("#wechat-preview").innerHTML = items.map((item, index) => `
      <article class="wechat-row" data-wechat-row="${escapeHtml(item.id)}">
        <span>${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(item.creatorType || "未分类")} · ${escapeHtml(item.fansText || compact(item.fanCount))}</small>
        </div>
        <code>${escapeHtml(creatorWechat(item))}</code>
        <button type="button" class="secondary-button small" data-copy-wechat="${escapeHtml(item.id)}">复制</button>
      </article>
    `).join("");
    $("#wechat-dialog").showModal();
  }

  function wechatQueueText() {
    return $$("[data-wechat-row]", $("#wechat-preview")).map((node, index) => {
      const item = creators.find((creator) => creator.id === node.dataset.wechatRow);
      return item ? `${index + 1}. ${item.name}｜${creatorWechat(item)}` : "";
    }).filter(Boolean).join("\n");
  }

  async function copyWechatQueue() {
    const text = wechatQueueText();
    if (!text) return;
    await copyText(text, "微信待添加清单已复制");
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    toast(successMessage);
  }

  function normalizeCreator(input) {
    const fanCount = number(input.fanCount) || fanCountFromText(input.fansText);
    return {
      id: input.id || creatorId(input.name),
      name: String(input.name || input.creator || "").trim(),
      profileLink: input.profileLink || input.creatorProfile || "",
      creatorType: String(input.creatorType || "").trim() || "未分类",
      tier: creatorTierByFans(fanCount),
      fansText: input.fansText || (fanCount ? String(fanCount) : ""),
      fanCount,
      email: input.email || "",
      wechat: input.wechat || "",
      contactAddress: input.contactAddress || "",
      outreachStatus: input.wechat ? "已加微信" : (input.outreachStatus || "待建联"),
      lastOutreachAt: input.lastOutreachAt || "",
      outreachNote: input.outreachNote || "",
      createdAt: input.createdAt || input.addedAt || "",
      updatedAt: input.updatedAt || "",
      cooperationCount: number(input.cooperationCount),
      placementIds: Array.isArray(input.placementIds) ? input.placementIds : [],
      isBlacklisted: Boolean(input.isBlacklisted),
      blacklistReason: input.blacklistReason || "",
      lastProduct: input.lastProduct || "",
      collaboratedProductsManual: input.collaboratedProductsManual || input.collaboratedProducts || input.cooperatedProducts || "",
      creatorTags: creatorTagList(input.creatorTags || input.tags || input.creatorTagsText || input.labels || input.tagText || ""),
      lastCooperationAt: input.lastCooperationAt || "",
      source: input.source || "手动/投放台账",
    };
  }

  function upsertCreator(nextCreator, options = {}) {
    const normalized = normalizeCreator(nextCreator);
    if (!normalized.name) return;
    const key = creatorKey(normalized.name);
    const index = creators.findIndex((item) => creatorKey(item.name) === key);
    const placementId = options.placementId || "";
    if (index < 0) {
      creators.push({
        ...normalized,
        placementIds: placementId ? [placementId] : normalized.placementIds,
        cooperationCount: options.increment ? Math.max(1, normalized.cooperationCount) : normalized.cooperationCount,
      });
      return;
    }
    const current = normalizeCreator(creators[index]);
    const alreadyCounted = placementId && current.placementIds.includes(placementId);
    const placementIds = placementId && !alreadyCounted ? [...current.placementIds, placementId] : current.placementIds;
    const fanCount = Math.max(current.fanCount, normalized.fanCount);
    creators[index] = {
      ...current,
      ...normalized,
      fanCount,
      fansText: normalized.fanCount >= current.fanCount ? normalized.fansText || current.fansText : current.fansText,
      tier: creatorTierByFans(fanCount),
      creatorType: current.creatorType !== "未分类" ? current.creatorType : normalized.creatorType,
      placementIds,
      cooperationCount: Math.max(current.cooperationCount, normalized.cooperationCount) + (options.increment && !alreadyCounted ? 1 : 0),
      lastProduct: normalized.lastProduct || current.lastProduct,
      lastCooperationAt: normalized.lastCooperationAt || current.lastCooperationAt,
      wechat: current.wechat || normalized.wechat,
      email: current.email || normalized.email,
      contactAddress: current.contactAddress || normalized.contactAddress,
      profileLink: current.profileLink || normalized.profileLink,
      outreachStatus: current.wechat || normalized.wechat ? "已加微信" : (current.outreachStatus || normalized.outreachStatus),
      lastOutreachAt: current.lastOutreachAt || normalized.lastOutreachAt,
      outreachNote: current.outreachNote || normalized.outreachNote,
      createdAt: current.createdAt || normalized.createdAt,
      updatedAt: normalized.updatedAt || current.updatedAt,
      isBlacklisted: current.isBlacklisted || normalized.isBlacklisted,
      blacklistReason: current.blacklistReason || normalized.blacklistReason,
      collaboratedProductsManual: current.collaboratedProductsManual || normalized.collaboratedProductsManual,
      creatorTags: creatorTagList([...creatorTagList(current.creatorTags), ...creatorTagList(normalized.creatorTags)]),
    };
  }

  function syncCreatorsFromPlacements(options = {}) {
    placements.forEach((item) => {
      upsertCreator({
        name: item.creator,
        profileLink: item.creatorProfile || "",
        creatorType: item.creatorLibraryType || "未分类",
        fansText: item.creatorFansText || "",
        fanCount: fanCountFromText(item.creatorFansText),
        wechat: item.contactMethod?.includes("微信") ? item.contactMethod : "",
        contactAddress: "",
        cooperationCount: 0,
        lastProduct: item.product,
        collaboratedProductsManual: "",
        lastCooperationAt: item.publishedAt || item.agreedPublishAt || item.plannedAt || "",
      }, { increment: true, placementId: item.id });
    });
    saveCreators(options);
  }

  async function loadSeedCreators(force = false) {
    try {
      const existingSeedRows = creators.filter((item) => item.source === CREATORS_SEED_SOURCE).length;
      if (!force && existingSeedRows >= MIN_SEED_CREATOR_ROWS) return;
      const response = await fetch(CREATORS_SEED_URL, { cache: "no-store" });
      if (!response.ok) return;
      const seed = await response.json();
      if (!Array.isArray(seed)) return;
      seed.forEach((item) => upsertCreator(item));
      syncCreatorsFromPlacements();
      saveCreators();
      renderAll();
    } catch {
      // Seed loading is optional; manual and CSV data still work.
    }
  }

  function calc(item) {
    const spend = number(item.fee) + number(item.extraCost);
    const interactions = number(item.likes) + number(item.saves) + number(item.comments) + number(item.shares);
    const interactionRate = number(item.clicks) ? interactions / number(item.clicks) : NaN;
    const clickRate = number(item.exposure) ? number(item.clicks) / number(item.exposure) : NaN;
    const cpm = number(item.exposure) ? spend / number(item.exposure) * 1000 : NaN;
    const cpe = interactions ? spend / interactions : NaN;
    const cpl = number(item.leads) ? spend / number(item.leads) : NaN;
    const roas = spend ? number(item.gmv) / spend : NaN;
    const roiLabel = feedbackType(item, { interactionRate, cpm, roas, spend });
    return { spend, interactions, interactionRate, clickRate, cpm, cpe, cpl, roas, roiLabel };
  }

  function feedbackType(item, values = calc(item)) {
    if (item.status !== "已发布") return "optimize";
    if (!hasPlacementPerformanceData(item)) return "pending-data";
    if (number(item.likes) < 200) return "pause";
    if (number(item.likes) >= 500 || number(item.saves) >= 200 || number(item.comments) >= 50) return "scale";
    return "optimize";
  }

  function feedbackLabel(type) {
    if (type === "scale") return "可加投";
    if (type === "pause") return "暂停观察";
    if (type === "pending-data") return "待填数据";
    return "需优化";
  }

  function feedbackClass(type) {
    if (type === "scale") return "";
    if (type === "pause") return "coral";
    if (type === "pending-data") return "blue";
    return "amber";
  }

  function feedbackReason(item) {
    if (item.status !== "已发布") return "还未进入完整数据期，先盯排期、脚本卖点和发布时间。";
    if (!hasPlacementPerformanceData(item)) return `${publishedAgeText(item) || "已发布"}，先补录点赞、收藏、评论后再判断反馈。`;
    if (number(item.likes) < 200) return `点赞 ${compact(item.likes)}，数据较差，优先复查选人和内容方向。`;
    if (number(item.likes) >= 500 || number(item.saves) >= 200 || number(item.comments) >= 50) {
      return `${compact(item.likes)}赞 · ${compact(item.saves)}收藏 · ${compact(item.comments)}评论，互动表现较好。`;
    }
    return "互动数据中段，建议优化标题、首图和内容卖点。";
  }

  function hasPlacementPerformanceData(item) {
    return Boolean(item.performanceReviewedAt) || [item.likes, item.saves, item.comments].some((value) => number(value) > 0);
  }

  function isDay7ReviewDue(item) {
    const publishedDays = daysSince(item.publishedAt);
    return item.status === "已发布" && Number.isFinite(publishedDays) && publishedDays >= 7 && !hasPlacementPerformanceData(item);
  }

  function isPublishedWaitingForDay7(item) {
    const publishedDays = daysSince(item.publishedAt);
    return item.status === "已发布" && Number.isFinite(publishedDays) && publishedDays >= 0 && publishedDays < 7 && !hasPlacementPerformanceData(item);
  }

  function publishDueDate(item) {
    return item.agreedPublishAt || "";
  }

  function publishDelayDays(item) {
    if (String(item.publishedAt || "").trim() || item.status === "已发布") return NaN;
    const dueDate = publishDueDate(item);
    const delayedDays = daysSince(dueDate);
    return Number.isFinite(delayedDays) && delayedDays >= 0 ? delayedDays : NaN;
  }

  function publishDelayLevel(days) {
    if (!Number.isFinite(days)) return null;
    if (days >= 10) return { key: "delay10", label: "发布拖延10天以上", tone: "coral", rank: 3, note: `拖延${days}天` };
    if (days >= 5) return { key: "delay5", label: "发布拖延达5天", tone: "amber", rank: 2, note: `拖延${days}天` };
    return { key: "overdue", label: "约定时间未发布", tone: "blue", rank: 1, note: days ? `拖延${days}天` : "今天到期" };
  }

  function sampleTrackingNumber(item) {
    return String(item?.sampleTrackingNumber || item?.trackingNumber || item?.shippingTrackingNumber || item?.expressNo || item?.logisticsNo || "").trim();
  }

  function needsSampleShipment(item) {
    if (String(item.publishedAt || "").trim() || ["已发布", "已签收", "脚本已确认", "等待发布"].includes(item.status)) return false;
    if (["已签收", "无需寄样", "已寄样", "寄样中"].includes(item.sampleStatus)) return false;
    return item.status === "待寄样" || (item.status !== "待建联" && ["待寄样", "未寄样"].includes(item.sampleStatus));
  }

  function isWaitingForPublication(item) {
    if (String(item.publishedAt || "").trim() || item.status === "已发布") return false;
    if (Number.isFinite(publishDelayDays(item))) return false;
    if (needsSampleShipment(item)) return false;
    if (["已寄样", "已签收", "脚本已确认", "等待发布"].includes(item.status)) return true;
    return Boolean(publishDueDate(item) && ["已寄样", "寄样中", "已签收", "无需寄样"].includes(item.sampleStatus));
  }

  function followupTask(item) {
    const itemProgress = progress(item.deliverableProgress);
    const deliveredDays = daysSince(item.sampleDeliveredAt);
    const contactDays = daysSince(item.lastContactAt);
    const daysToPublish = Number.isFinite(daysSince(item.agreedPublishAt)) ? -daysSince(item.agreedPublishAt) : NaN;
    const draftDone = Boolean(item.draftSubmittedAt) || ["已申请", "已通过", "无需申请"].includes(item.draftStatus);
    const draftDueMissed = Number.isFinite(daysToPublish) && daysToPublish <= 2 && daysToPublish >= 0 && !draftDone;
    const notes = [item.notes, item.creatorResponse].join(" ");
    const publishedDays = daysSince(item.publishedAt);
    const day7ReviewDue = isDay7ReviewDue(item);
    const delayedDays = publishDelayDays(item);
    const delayLevel = publishDelayLevel(delayedDays);
    const dueDate = publishDueDate(item);
    const warnings = [];
    if (item.sampleStatus === "已签收" && itemProgress.done === 0 && deliveredDays >= 7) warnings.push("样品签收超过7天仍未发布");
    if (delayLevel) warnings.push(`${delayLevel.label}：${delayLevel.note}`);
    if (draftDueMissed) warnings.push("距约定发布日期不足2天，稿件申请仍未完成");
    if (number(item.followUpCount) >= 2 && itemProgress.done < itemProgress.required && !String(item.creatorResponse || "").includes("已确认")) warnings.push("已跟进2次以上仍未完成");
    if (itemProgress.done > 0 && itemProgress.done < itemProgress.required && daysSince(item.publishedAt) >= 5) warnings.push("首篇发布超过5天仍缺剩余内容");
    if (/失联|不回复|无回复|不愿|不配合|拒绝|拖/i.test(notes)) warnings.push("备注中出现长期无回复或配合风险");

    if (needsSampleShipment(item)) {
      return {
        priority: "高",
        rank: priorityRank["高"],
        kind: "sample-shipping",
        reason: "当前状态是待寄样，尚未填写快递单号。",
        action: "尽快寄样，并在这里填写快递单号；填写后会自动变成已寄样。",
        warnings,
      };
    }

    if (delayLevel) {
      return {
        priority: "最高",
        rank: priorityRank["最高"],
        kind: "publish-overdue",
        delayLevel,
        delayDays: delayedDays,
        reason: `${delayLevel.label}：约定发布日期是${dueDate}，目前仍未填写实际发布时间。`,
        action: delayedDays >= 10
          ? "严重拖延，优先确认是否还能发布，必要时暂停后续合作。"
          : delayedDays >= 5
            ? "已拖延5天以上，催确认最终发布时间，并标记风险。"
            : "约定时间已到，确认今天是否发布或重新约定时间。",
        warnings,
      };
    }

    if (isWaitingForPublication(item)) {
      const due = publishDueDate(item);
      const daysUntil = Number.isFinite(daysSince(due)) ? -daysSince(due) : NaN;
      return {
        priority: "中",
        rank: priorityRank["中"],
        kind: "waiting-publish",
        reason: due
          ? Number.isFinite(daysUntil) && daysUntil >= 0
            ? `等待发布，距离约定发布时间还有${daysUntil}天。`
            : `等待发布，约定发布时间是${due}。`
          : "等待发布，尚未填写约定发布时间。",
        action: "集中观察排期，到约定日期仍未发布会自动转到发布时间提醒。",
        warnings,
      };
    }

    if (day7ReviewDue) {
      return {
        priority: "最高",
        rank: priorityRank["最高"],
        kind: "day7-review",
        reason: `已发布${publishedDays}天，点赞、收藏、评论仍未录入。`,
        action: item.url ? "打开笔记，填写点赞、收藏、评论。" : "先补充笔记链接，再填写点赞、收藏、评论。",
        warnings,
      };
    }
    if (isPublishedWaitingForDay7(item)) {
      const remainingDays = Math.max(0, 7 - publishedDays);
      return {
        priority: "低",
        rank: priorityRank["低"],
        kind: "published-waiting",
        reason: `已发布${publishedDays}天，未到7天数据统计期。`,
        action: remainingDays ? `还有${remainingDays}天到7天，先放在跟进任务里观察。` : "今天进入7天统计期，可准备补录数据。",
        warnings,
      };
    }
    if (item.status === "已发布" || itemProgress.done >= itemProgress.required) {
      return { priority: "暂无", rank: priorityRank["暂无"], reason: "已发布，无需今日跟进。", action: "归档观察", warnings };
    }
    if (draftDueMissed) {
      return { priority: "最高", rank: priorityRank["最高"], reason: `约定发布日期是${item.agreedPublishAt}，稿件需提前3天申请，目前仍未完成。`, action: "提醒稿件申请，并同步确认最终发布时间", warnings };
    }
    if (item.sampleStatus === "已签收" && itemProgress.done === 0 && deliveredDays >= 2) {
      return { priority: "最高", rank: priorityRank["最高"], reason: `样品已签收${deliveredDays}天，内容进度仍是 ${itemProgress.label}。`, action: "发送首次催拍，提醒脚本卖点和发布时间", warnings };
    }
    if (itemProgress.done > 0 && itemProgress.done < itemProgress.required) {
      return { priority: "高", rank: priorityRank["高"], reason: `已发布 ${itemProgress.label}，还有剩余内容未交付。`, action: "催剩余笔记/视频，并确认发布时间", warnings };
    }
    if (item.status === "等待发布" && contactDays >= 1 && itemProgress.done < itemProgress.required) {
      return { priority: "中", rank: priorityRank["中"], reason: `上次跟进已过${contactDays}天，对方还未完成交付。`, action: "发送第二次跟进，确认卡点", warnings };
    }
    if (item.status === "待建联" && contactDays >= 2) {
      return { priority: "低", rank: priorityRank["低"], reason: `建联后${contactDays}天未推进，样品状态为${item.sampleStatus || "未填写"}。`, action: "轻提醒合作意向，或换下一批达人", warnings };
    }
    return { priority: "暂无", rank: priorityRank["暂无"], reason: "暂未触发今日跟进规则。", action: "保持观察", warnings };
  }

  function followupTasks() {
    return placements
      .map((item) => ({ ...item, task: followupTask(item) }))
      .sort((a, b) => (
        Number(b.task.kind === "publish-overdue") - Number(a.task.kind === "publish-overdue") ||
        number(b.task.delayLevel?.rank) - number(a.task.delayLevel?.rank) ||
        number(b.task.delayDays) - number(a.task.delayDays) ||
        Number(b.task.kind === "day7-review") - Number(a.task.kind === "day7-review") ||
        a.task.rank - b.task.rank ||
        (daysSince(b.sampleDeliveredAt) || 0) - (daysSince(a.sampleDeliveredAt) || 0)
      ));
  }

  function productNames() {
    return Array.from(new Set(placements.flatMap((item) => {
      const products = placementProducts(item);
      return products.length ? products.map((product) => product.name) : [item.product].filter(Boolean);
    })));
  }

  function productTextList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return productSegments(value).filter(Boolean);
  }

  function creatorTagList(value) {
    const raw = Array.isArray(value) ? value : String(value || "").split(/[、,，+;；\n\r\s]+/);
    return Array.from(new Set(raw.map((item) => String(item || "").trim()).filter(Boolean)));
  }

  function creatorPlacementProducts(creatorName) {
    return placements
      .filter((item) => creatorKey(item.creator) === creatorKey(creatorName))
      .flatMap((item) => {
        const products = placementProducts(item);
        return products.length ? products.map((product) => product.name) : productTextList(item.product);
      });
  }

  function creatorManualProducts(item) {
    return productTextList(item?.collaboratedProductsManual || item?.collaboratedProducts || item?.cooperatedProducts || "");
  }

  function creatorCooperatedProducts(item) {
    return Array.from(new Set([...creatorPlacementProducts(item?.name), ...creatorManualProducts(item)]));
  }

  function creatorDelayTag(item) {
    const delays = placements
      .filter((placement) => creatorKey(placement.creator) === creatorKey(item?.name))
      .map(publishDelayDays)
      .filter(Number.isFinite);
    if (!delays.length) return null;
    return publishDelayLevel(Math.max(...delays));
  }

  function creatorTypeOptions() {
    return Array.from(new Set([...creatorTypes, ...customCreatorTypes, ...creators.map((item) => item.creatorType).filter(Boolean)]));
  }

  function scopedPlacements() {
    if (selectedProduct === "all") return placements;
    return placements.filter((item) => {
      const products = placementProducts(item);
      return products.length ? products.some((product) => product.name === selectedProduct) : item.product === selectedProduct;
    });
  }

  function periodLabel(period) {
    if (period === "unpublished") return "未发布 / 待排期";
    if (/^\d{4}$/.test(period)) return `${period}年全年`;
    const [year, month] = String(period).split("-");
    return year && month ? `${year}年${month}月` : "当前周期";
  }

  function placementsForPeriod(period) {
    if (period === "unpublished") return placements.filter((item) => !String(item.publishedAt || "").trim());
    return placements.filter((item) => {
      const publishedAt = String(item.publishedAt || "").slice(0, 10);
      if (!publishedAt) return false;
      return /^\d{4}$/.test(period) ? publishedAt.startsWith(`${period}-`) : publishedAt.slice(0, 7) === period;
    });
  }

  function budgetMonthsForPeriod(period) {
    if (/^\d{4}$/.test(period)) {
      return Array.from({ length: 12 }, (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`);
    }
    return /^\d{4}-\d{2}$/.test(period) ? [period] : [];
  }

  function budgetForPeriod(period) {
    return budgetMonthsForPeriod(period).reduce((sum, month) => sum + number(monthlyBudgets[month]), 0);
  }

  function periodFinanceSummary(period) {
    const rows = placementsForPeriod(period);
    const paidCooperation = rows.reduce((sum, item) => sum + number(item.fee), 0);
    const fulfillmentCost = rows.reduce((sum, item) => sum + number(item.extraCost), 0);
    const productCost = rows.reduce((sum, item) => sum + placementProductCost(item), 0);
    const orders = rows.reduce((sum, item) => sum + number(item.orders), 0);
    const gmv = rows.reduce((sum, item) => sum + number(item.gmv), 0);
    const budget = budgetForPeriod(period);
    const linkedProducts = rows.filter((item) => placementCostStatus(item).linked).length;
    const missingCost = rows.filter((item) => placementCostStatus(item).missing).length;
    const paidCount = rows.filter((item) => number(item.fee) > 0).length;
    const totalCost = paidCooperation + fulfillmentCost + productCost;
    return {
      rows,
      budget,
      paidCooperation,
      paidCount,
      remaining: budget - paidCooperation,
      budgetRate: budget ? paidCooperation / budget : 0,
      fulfillmentCost,
      productCost,
      totalCost,
      orders,
      gmv,
      linkedProducts,
      missingCost,
      roas: totalCost ? gmv / totalCost : NaN,
    };
  }

  function filterSelectedProduct(rows) {
    if (selectedProduct === "all") return rows;
    return rows.filter((item) => {
      const products = placementProducts(item);
      return products.length ? products.some((product) => product.name === selectedProduct) : item.product === selectedProduct;
    });
  }

  function overviewPlacements() {
    return filterSelectedProduct(placementsForPeriod(overviewPeriod));
  }

  function cooperationStarted(item) {
    if (item.status === "待建联") return false;
    if (sampleTrackingNumber(item)) return true;
    if (["已寄样", "寄样中", "已签收"].includes(item.sampleStatus)) return true;
    return ["已寄样", "已签收", "脚本已确认", "等待发布", "已发布"].includes(item.status);
  }

  function cooperationStartedAt(item) {
    return [item.sampleDeliveredAt, item.plannedAt, item.agreedPublishAt, item.publishedAt, item.createdAt, item.updatedAt]
      .map((value) => String(value || "").slice(0, 10))
      .find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)) || "";
  }

  function monthlyStartedPlacements(period) {
    const month = /^\d{4}-\d{2}$/.test(period) ? period : today().slice(0, 7);
    return placements.filter((item) => cooperationStarted(item) && cooperationStartedAt(item).startsWith(month));
  }

  function reportYears() {
    return Array.from(new Set([
      today().slice(0, 4),
      ...placements.map((item) => String(item.publishedAt || "").slice(0, 4)).filter((year) => /^\d{4}$/.test(year)),
    ])).sort((a, b) => b.localeCompare(a));
  }

  function periodOptions(includeUnpublished = false) {
    const options = reportYears().flatMap((year) => [
      { value: year, label: `${year}年全年` },
      ...Array.from({ length: 12 }, (_, index) => {
        const month = String(12 - index).padStart(2, "0");
        return { value: `${year}-${month}`, label: `${year}年${month}月` };
      }),
    ]);
    if (includeUnpublished) options.unshift({ value: "unpublished", label: "未发布 / 待排期" });
    return options;
  }

  function renderPeriodControls() {
    [
      ["#overview-period", overviewPeriod, false],
      ["#ledger-period", ledgerPeriod, true],
    ].forEach(([selector, current, includeUnpublished]) => {
      const select = $(selector);
      if (!select) return;
      select.innerHTML = periodOptions(includeUnpublished).map((option) => `<option value="${option.value}">${option.label}</option>`).join("");
      select.value = current;
    });
  }

  function renderProductBoard() {
    const periodRows = placementsForPeriod(overviewPeriod);
    const label = periodLabel(overviewPeriod);
    const products = productNames()
      .map((product) => {
        const rows = periodRows.filter((item) => {
          const products = placementProducts(item);
          return products.length ? products.some((catalogProduct) => catalogProduct.name === product) : item.product === product;
        });
        const spend = rows.reduce((sum, item) => sum + calc(item).spend + placementProductCost(item), 0);
        const gmv = rows.reduce((sum, item) => sum + number(item.gmv), 0);
        const latest = rows.map(placementDate).sort().at(-1) || "暂无日期";
        const catalog = rows.flatMap(placementProducts).find((item) => item.name === product) || productForPlacement(rows[0] || {});
        return { product, rows, spend, gmv, latest, catalog };
      })
      .filter((item) => item.rows.length)
      .sort((a, b) => b.rows.length - a.rows.length || String(b.latest).localeCompare(String(a.latest)))
      .slice(0, 3);
    if (selectedProduct !== "all" && !products.some((item) => item.product === selectedProduct)) selectedProduct = "all";
    const totalSpend = periodRows.reduce((sum, item) => sum + calc(item).spend + placementProductCost(item), 0);
    const totalGmv = periodRows.reduce((sum, item) => sum + number(item.gmv), 0);
    const startedRows = monthlyStartedPlacements(overviewPeriod);
    const startedPeriod = /^\d{4}-\d{2}$/.test(overviewPeriod) ? overviewPeriod : today().slice(0, 7);
    $("#product-board-title").textContent = `${label} 合作产品 Top 3`;
    $("#monthly-started-card").innerHTML = `
      <span>${escapeHtml(startedPeriod.replace("-", "年"))}月已发起合作</span>
      <strong>${startedRows.length}</strong>
      <small>已寄快递/进入寄样后续，不含待建联</small>
    `;
    $("#product-board").innerHTML = `
      <div class="product-chip ${selectedProduct === "all" ? "active" : ""}" data-product="all" role="button" tabindex="0">
        <strong>${label} 全部产品</strong>
          <span>${periodRows.length} 条 · 含产品成本 ROAS ${totalSpend ? ratio(totalGmv / totalSpend) : "无"}</span>
      </div>
      ${products.map((item) => `
        <div class="product-chip ${selectedProduct === item.product ? "active" : ""}" data-product="${escapeHtml(item.product)}" role="button" tabindex="0">
          <strong>${escapeHtml(item.product)}</strong>
          <span>${item.rows.length} 条 · 含产品成本 ROAS ${item.spend ? ratio(item.gmv / item.spend) : "无"}</span>
          ${item.catalog ? `<a href="${escapeHtml(productUrl(item.catalog))}" target="_blank" rel="noreferrer" class="product-stock-link">库存</a>` : ""}
        </div>
      `).join("")}
    `;
  }

  function renderBudgetPanel() {
    const panel = $("#budget-panel");
    if (!panel) return;
    const label = periodLabel(overviewPeriod);
    const summary = periodFinanceSummary(overviewPeriod);
    const isMonthly = /^\d{4}-\d{2}$/.test(overviewPeriod);
    const progress = summary.budget ? Math.min(summary.budgetRate, 1) : 0;
    const tone = summary.budget && summary.paidCooperation > summary.budget ? "over" : summary.budgetRate >= 0.8 ? "warning" : "";
    const budgetNote = isMonthly
      ? "只扣合作费；免费合作不会占用预算"
      : "全年视图汇总已设置的月度预算";
    const inputValue = isMonthly ? number(monthlyBudgets[overviewPeriod]) || "" : "";
    const connectionNote = wholesaleCostStatus.connected
      ? `订货后台已连接：${wholesaleCostStatus.costSeedCount + wholesaleCostStatus.costSettingsCount} 组成本，${wholesaleCostStatus.orderCount} 笔订单`
      : "订货后台成本未连接，请先配置后台账号环境变量";
    const costNote = summary.missingCost
      ? `${summary.missingCost} 条投放未完整关联真实成本`
      : "已按订货后台真实成本累计";
    panel.innerHTML = `
      <div class="budget-head">
        <div>
          <span class="eyebrow">MONTHLY BUDGET</span>
          <h2>${escapeHtml(label)} 合作预算与成本</h2>
          <p>${escapeHtml(`${budgetNote}；${connectionNote}`)}</p>
        </div>
        <label class="budget-input">
          <span>${isMonthly ? "本月合作预算" : "月预算汇总"}</span>
          <input id="monthly-budget-input" type="number" min="0" step="100" value="${escapeHtml(inputValue)}" ${isMonthly ? "" : "disabled"} placeholder="${isMonthly ? "填写预算" : money(summary.budget)}" />
        </label>
      </div>
      <div class="budget-progress ${tone}">
        <span style="width:${Math.round(progress * 100)}%"></span>
      </div>
      <div class="budget-grid">
        <div><span>付费合作已用</span><strong>${money(summary.paidCooperation)}</strong><small>${summary.paidCount} 条付费合作</small></div>
        <div><span>预算剩余</span><strong class="${summary.remaining < 0 ? "negative" : ""}">${summary.budget ? money(summary.remaining) : "未设置"}</strong><small>${summary.budget ? `已用 ${Math.round(summary.budgetRate * 100)}%` : "先填写本月预算"}</small></div>
        <div><span>产品成本累计</span><strong>${summary.productCost ? money(summary.productCost) : "未连接"}</strong><small>${escapeHtml(costNote)}</small></div>
        <div><span>样品/履约成本</span><strong>${money(summary.fulfillmentCost)}</strong><small>来自台账手填成本</small></div>
        <div><span>订单与GMV</span><strong>${compact(summary.orders)} 单</strong><small>GMV ${money(summary.gmv)}</small></div>
        <div><span>总成本口径</span><strong>${money(summary.totalCost)}</strong><small>合作费 + 产品成本 + 履约成本</small></div>
      </div>
    `;
  }

  function renderMetrics() {
    const rows = overviewPlacements();
    const likes = rows.reduce((sum, item) => sum + number(item.likes), 0);
    const saves = rows.reduce((sum, item) => sum + number(item.saves), 0);
    const comments = rows.reduce((sum, item) => sum + number(item.comments), 0);
    const poor = rows.filter((item) => hasPlacementPerformanceData(item) && number(item.likes) < 200).length;
    const metrics = [
      ["已发布投放", compact(rows.length), periodLabel(overviewPeriod), "accent-teal"],
      ["点赞", compact(likes), `平均 ${rows.length ? compact(Math.round(likes / rows.length)) : 0}`, "accent-blue"],
      ["收藏", compact(saves), `平均 ${rows.length ? compact(Math.round(saves / rows.length)) : 0}`, "accent-amber"],
      ["评论", compact(comments), `平均 ${rows.length ? compact(Math.round(comments / rows.length)) : 0}`, "accent-violet"],
      ["数据较差", compact(poor), "已录入数据且点赞少于 200", "accent-coral"],
    ];
    $("#metric-grid").innerHTML = metrics.map(([label, value, note, cls]) => `
      <article class="metric-card ${cls}">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${note}</small>
      </article>
    `).join("");
  }

  function renderMonthlyStats() {
    const label = periodLabel(overviewPeriod);
    const rows = placementsForPeriod(overviewPeriod);
    const groups = Array.from(rows.reduce((map, item) => {
      const names = placementProducts(item).map((product) => product.name);
      const productNamesForRow = names.length ? names : [item.product || "未填产品"];
      productNamesForRow.forEach((name) => {
        const group = map.get(name) || { name, rows: [], spend: 0, productCost: 0, gmv: 0, exposure: 0, interactions: 0, clicks: 0, leads: 0, orders: 0 };
        const values = calc(item);
        group.rows.push(item);
        group.spend += values.spend;
        group.productCost += placementProductCost(item);
        group.gmv += number(item.gmv);
        group.exposure += number(item.exposure);
        group.interactions += values.interactions;
        group.clicks += number(item.clicks);
        group.leads += number(item.leads);
        group.orders += number(item.orders);
        map.set(name, group);
      });
      return map;
    }, new Map()).values()).map((group) => ({
      ...group,
      totalCost: group.spend + group.productCost,
      roas: group.spend + group.productCost ? group.gmv / (group.spend + group.productCost) : 0,
      interactionRate: group.clicks ? group.interactions / group.clicks : 0,
    }));
    const creatorsByLikes = Array.from(rows.reduce((map, item) => {
      const name = item.creator || "未填达人";
      const group = map.get(name) || { name, rows: [], likes: 0 };
      group.rows.push(item);
      group.likes += number(item.likes);
      map.set(name, group);
      return map;
    }, new Map()).values()).sort((a, b) => b.likes - a.likes || b.rows.length - a.rows.length).slice(0, 3);
    const most = [...groups].sort((a, b) => b.rows.length - a.rows.length || b.gmv - a.gmv).slice(0, 3);
    const best = [...groups].filter((item) => item.rows.some((row) => row.status === "已发布")).sort((a, b) => b.roas - a.roas || b.interactionRate - a.interactionRate || b.gmv - a.gmv).slice(0, 3);
    const productBlock = (title, items, empty) => `
      <article class="monthly-card">
        <h3>${title}</h3>
        ${items.length ? `<ol>${items.map((item) => `
          <li>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${item.rows.length} 条 · 订单 ${compact(item.orders)} · 产品成本 ${money(item.productCost)} · ROAS ${ratio(item.roas)}</span>
          </li>
        `).join("")}</ol>` : `<p class="muted">${empty}</p>`}
      </article>
    `;
    const creatorBlock = `
      <article class="monthly-card">
        <h3>${label} 点赞达人 Top 3</h3>
        ${creatorsByLikes.length ? `<ol>${creatorsByLikes.map((item) => `
          <li>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${compact(item.likes)} 赞 · ${item.rows.length} 条合作</span>
          </li>
        `).join("")}</ol>` : `<p class="muted">当前周期还没有点赞数据。</p>`}
      </article>
    `;
    $("#period-review-title").textContent = `${label} 产品复盘`;
    $("#monthly-product-stats").innerHTML = `
      ${productBlock(`${label} 投放最多 Top 3`, most, "当前周期还没有投放记录。")}
      ${productBlock(`${label} 数据最好 Top 3`, best, "当前周期还没有可复盘的已发布数据。")}
      ${creatorBlock}
    `;
  }

  function renderAnnualTrend() {
    const panel = $("#annual-trend-panel");
    if (!panel) return;
    const isAnnual = /^\d{4}$/.test(overviewPeriod);
    panel.hidden = !isAnnual;
    if (!isAnnual) return;

    const rows = filterSelectedProduct(placementsForPeriod(overviewPeriod));
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      const monthRows = rows.filter((item) => String(item.publishedAt || "").slice(0, 7) === `${overviewPeriod}-${month}`);
      return {
        label: `${index + 1}月`,
        likes: monthRows.reduce((sum, item) => sum + number(item.likes), 0),
        saves: monthRows.reduce((sum, item) => sum + number(item.saves), 0),
        comments: monthRows.reduce((sum, item) => sum + number(item.comments), 0),
      };
    });
    const maxValue = Math.max(1, ...months.flatMap((month) => [month.likes, month.saves, month.comments]));
    const width = 920;
    const height = 270;
    const left = 58;
    const right = 24;
    const top = 20;
    const bottom = 42;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const x = (index) => left + (plotWidth / 11) * index;
    const y = (value) => top + plotHeight - (value / maxValue) * plotHeight;
    const series = [
      { key: "likes", color: "#17665d", label: "点赞" },
      { key: "saves", color: "#c78a21", label: "收藏" },
      { key: "comments", color: "#b04444", label: "评论" },
    ];
    const grid = [0, .25, .5, .75, 1].map((ratioValue) => {
      const gridY = top + plotHeight - plotHeight * ratioValue;
      return `<line x1="${left}" y1="${gridY}" x2="${width - right}" y2="${gridY}" class="chart-grid-line" />
        <text x="${left - 10}" y="${gridY + 4}" text-anchor="end" class="chart-axis-label">${compact(Math.round(maxValue * ratioValue))}</text>`;
    }).join("");
    const lines = series.map((item) => {
      const points = months.map((month, index) => `${x(index)},${y(month[item.key])}`).join(" ");
      const dots = months.map((month, index) => `<circle cx="${x(index)}" cy="${y(month[item.key])}" r="4" fill="${item.color}"><title>${month.label} ${item.label} ${compact(month[item.key])}</title></circle>`).join("");
      return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />${dots}`;
    }).join("");
    const xLabels = months.map((month, index) => `<text x="${x(index)}" y="${height - 14}" text-anchor="middle" class="chart-axis-label">${month.label}</text>`).join("");
    $("#annual-trend-title").textContent = `${overviewPeriod}年互动趋势`;
    $("#annual-trend-chart").innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${overviewPeriod}年每月点赞收藏评论折线图">
        ${grid}${lines}${xLabels}
      </svg>
    `;
  }

  function renderStatusBoard() {
    const rows = overviewPlacements();
    const total = Math.max(rows.length, 1);
    const tiles = statuses.map((status) => {
      const count = rows.filter((item) => item.status === status).length;
      return `
        <article class="status-tile ${statusClass(status)}">
          <span>${status}</span>
          <strong>${count}</strong>
          <div class="bar"><span style="width: ${Math.round(count / total * 100)}%"></span></div>
        </article>
      `;
    });
    $("#status-board").innerHTML = tiles.join("");
  }

  function renderRanking() {
    const ranked = overviewPlacements()
      .sort((a, b) => number(b.likes) - number(a.likes) || number(b.saves) - number(a.saves) || number(b.comments) - number(a.comments))
      .slice(0, 5);
    $("#creator-ranking").innerHTML = ranked.length ? ranked.map((item) => {
      return `
        <div class="rank-item">
          <div>
            <strong>${escapeHtml(item.creator)}</strong>
            <div class="muted">${escapeHtml(item.product)} · ${compact(item.likes)}赞 · ${compact(item.saves)}收藏 · ${compact(item.comments)}评论</div>
          </div>
          <span class="rank-score">${compact(item.likes)} 赞</span>
        </div>
      `;
    }).join("") : `<div class="empty-state">发布后录入点赞、收藏和评论，这里会自动出现达人互动排行。</div>`;
  }

  function renderFollowups() {
    const tasks = followupTasks();
    const bucket = (predicate) => tasks.filter((item) => predicate(item));
    const buckets = {
      sampleShipping: bucket((item) => item.task.kind === "sample-shipping"),
      waitingPublish: bucket((item) => item.task.kind === "waiting-publish"),
      publishOverdue: bucket((item) => item.task.kind === "publish-overdue" && item.task.delayLevel?.key === "overdue"),
      publishDelay5: bucket((item) => item.task.kind === "publish-overdue" && item.task.delayLevel?.key === "delay5"),
      publishDelay10: bucket((item) => item.task.kind === "publish-overdue" && item.task.delayLevel?.key === "delay10"),
      publishedWaiting: bucket((item) => item.task.kind === "published-waiting"),
      day7Review: bucket((item) => item.task.kind === "day7-review"),
    };
    const summaryGroups = [
      {
        title: "合作推进",
        note: "寄样和等待发布先放这里",
        cards: [
          ["新增合作未寄样", buckets.sampleShipping.length, "寄了后勾选并填单号", "accent-amber", "followup-sample-shipping"],
          ["等待发布", buckets.waitingPublish.length, "已推进到发布排期", "accent-blue", "followup-waiting-publish"],
        ],
      },
      {
        title: "发布",
        note: "只看约定时间到了但没发布的",
        cards: [
          ["约定时间未发布", buckets.publishOverdue.length, "到期0-4天", "accent-coral", "followup-publish-overdue"],
          ["发布拖延达5天", buckets.publishDelay5.length, "拖延5-9天", "accent-amber", "followup-publish-delay5"],
          ["发布拖延10天以上", buckets.publishDelay10.length, "严重拖延", "accent-coral", "followup-publish-delay10"],
        ],
      },
      {
        title: "填数据",
        note: "发布后的7天数据补录",
        cards: [
          ["已发布未满7天", buckets.publishedWaiting.length, "先观察，到7天再填", "accent-teal", "followup-published-waiting"],
          ["已发布达7天待填", buckets.day7Review.length, "录入点赞、收藏、评论", "accent-violet", "followup-day7-review"],
        ],
      },
    ];
    $("#followup-summary").innerHTML = summaryGroups.map((group) => `
      <section class="followup-summary-group">
        <div class="followup-summary-head">
          <h2>${escapeHtml(group.title)}</h2>
          <span>${escapeHtml(group.note)}</span>
        </div>
        <div class="followup-summary-cards">
          ${group.cards.map(([label, value, note, cls, target]) => `
            <button class="metric-card followup-jump-card ${cls}" type="button" data-jump-target="${target}">
              <span>${label}</span>
              <strong>${value}</strong>
              <small>${note}</small>
            </button>
          `).join("")}
        </div>
      </section>
    `).join("");
    const groups = [
      {
        title: "合作推进",
        note: "先处理寄样和发布排期，不和数据统计混在一起。",
        sections: [
          ["followup-sample-shipping", "新增合作未寄样", "寄出后直接勾选，并填写快递单号。", buckets.sampleShipping],
          ["followup-waiting-publish", "等待发布", "已经进入发布排期，但还没到约定时间。", buckets.waitingPublish],
        ],
      },
      {
        title: "发布",
        note: "只看约定时间到了但还没有实际发布时间的记录。",
        sections: [
          ["followup-publish-overdue", "约定时间未发布", "拖延5天以内，先确认是否今天发布或改期。", buckets.publishOverdue],
          ["followup-publish-delay5", "发布拖延达5天", "拖延5-9天，建议标记风险并催最终时间。", buckets.publishDelay5],
          ["followup-publish-delay10", "发布拖延10天以上", "严重拖延，优先处理是否暂停合作。", buckets.publishDelay10],
        ],
      },
      {
        title: "填数据",
        note: "发布后按7天统计周期管理数据补录。",
        sections: [
          ["followup-published-waiting", "已发布未满7天", "先观察，不急着填最终数据。", buckets.publishedWaiting],
          ["followup-day7-review", "已发布达7天等待填写数据", "到期后直接在这里填点赞、收藏、评论。", buckets.day7Review],
        ],
      },
    ];
    $("#followup-list").innerHTML = groups.map((group) => `
      <section class="followup-block">
        <div class="followup-block-head">
          <h2>${escapeHtml(group.title)}</h2>
          <span class="muted">${escapeHtml(group.note)}</span>
        </div>
        <div class="followup-section-list">
          ${group.sections.map(([id, title, note, items]) => followupBucket(id, title, note, items)).join("")}
        </div>
      </section>
    `).join("");
  }

  function followupBucket(id, title, note, items) {
    return `
      <section class="followup-bucket" id="${escapeHtml(id)}">
        <div class="followup-bucket-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <span class="muted">${escapeHtml(note)}</span>
          </div>
          <strong>${items.length}</strong>
        </div>
        <div class="task-list">
          ${items.length ? items.map(renderFollowupTaskCard).join("") : `<div class="empty-state">暂无记录。</div>`}
        </div>
      </section>
    `;
  }

  function renderFollowupTaskCard(item) {
    const task = item.task;
    const delayLevel = task.delayLevel;
    const cls = delayLevel?.tone || (task.priority === "最高" ? "coral" : task.priority === "高" ? "amber" : task.priority === "中" ? "blue" : "gray");
    return `
      <article class="task-card ${task.kind === "publish-overdue" ? "publish-overdue-card" : ""} ${task.kind === "sample-shipping" ? "sample-shipping-card" : ""} ${task.kind === "day7-review" ? "day7-review-card" : ""}">
        <div>
          <h3>${escapeHtml(item.creator)} · ${escapeHtml(item.product)}</h3>
          <p>${escapeHtml(task.reason)}</p>
          <p>${escapeHtml(task.action)}</p>
          <div class="task-meta">
            <span class="pill ${cls}">${task.priority}优先级</span>
            ${delayLevel ? `<span class="pill ${delayLevel.tone}">${escapeHtml(delayLevel.label)} · ${escapeHtml(delayLevel.note)}</span>` : ""}
            <span class="pill gray">实际发布 ${escapeHtml(item.publishedAt || "未填")}</span>
            <span class="pill gray">约定发布 ${escapeHtml(publishDueDate(item) || "未填")}</span>
            <span class="pill gray">单号 ${escapeHtml(sampleTrackingNumber(item) || "未填")}</span>
          </div>
          ${task.kind === "sample-shipping" ? sampleShipmentForm(item) : ""}
          ${task.kind === "day7-review" ? performanceReviewForm(item) : ""}
          ${task.warnings.length ? `<p><strong>风险提醒：</strong>${task.warnings.map(escapeHtml).join("；")}。</p>` : ""}
        </div>
        <div class="task-action">
          ${task.kind === "day7-review" && normalizeProfileLink(item.url) ? `<a class="secondary-button small" href="${escapeHtml(normalizeProfileLink(item.url))}" target="_blank" rel="noreferrer">打开笔记</a>` : ""}
          <button class="secondary-button small" data-edit="${item.id}">${task.kind === "day7-review" ? "编辑全部" : "编辑记录"}</button>
          <span class="muted">${escapeHtml(item.contactMethod || "未填联系方式")}</span>
        </div>
      </article>
    `;
  }

  function performanceReviewForm(item) {
    return `
      <form class="review-quick-form" data-review-form="${escapeHtml(item.id)}">
        <label>点赞<input data-review-field="likes" type="number" min="0" step="1" inputmode="numeric" value="${number(item.likes)}" /></label>
        <label>收藏<input data-review-field="saves" type="number" min="0" step="1" inputmode="numeric" value="${number(item.saves)}" /></label>
        <label>评论<input data-review-field="comments" type="number" min="0" step="1" inputmode="numeric" value="${number(item.comments)}" /></label>
        <button class="primary-button small" type="submit">保存数据</button>
      </form>
    `;
  }

  function filteredCreators() {
    const query = $("#creator-search")?.value.trim().toLowerCase() || "";
    const type = $("#creator-type-filter")?.value || "all";
    const tier = $("#creator-tier-filter")?.value || "all";
    const outreach = $("#creator-outreach-filter")?.value || "all";
    const added = $("#creator-added-filter")?.value || "all";
    const contact = $("#creator-contact-filter")?.value || "all";
    const sort = $("#creator-sort")?.value || "fans";
    const rows = creators.filter((item) => {
      const status = creatorOutreachStatus(item);
      const products = creatorCooperatedProducts(item).join(" ");
      const tags = creatorTagList(item.creatorTags).join(" ");
      const delayTag = creatorDelayTag(item)?.label || "";
      const haystack = [item.name, item.email, item.wechat, item.contactAddress, item.lastProduct, products, tags, delayTag, item.source, status, creatorCreatedDate(item)].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (type !== "all" && item.creatorType !== type) return false;
      if (tier !== "all" && item.tier !== tier) return false;
      if (outreach === "need" && !canOutreachCreator(item)) return false;
      if (outreach === "sent" && !["草稿已生成", "已发出", "已回复"].includes(status)) return false;
      if (outreach === "wechat" && status !== "已加微信") return false;
      if (!matchesCreatorAddedFilter(item, added)) return false;
      if (contact === "email" && !creatorEmail(item)) return false;
      if (contact === "wechat" && !creatorWechat(item)) return false;
      if (contact === "email-no-wechat" && (!creatorEmail(item) || creatorWechat(item))) return false;
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === "count") return number(b.cooperationCount) - number(a.cooperationCount) || number(b.fanCount) - number(a.fanCount);
      if (sort === "recent") return String(b.lastCooperationAt || "").localeCompare(String(a.lastCooperationAt || "")) || number(b.fanCount) - number(a.fanCount);
      if (sort === "created") return String(creatorCreatedDate(b)).localeCompare(String(creatorCreatedDate(a))) || number(b.fanCount) - number(a.fanCount);
      return number(b.fanCount) - number(a.fanCount);
    });
  }

  function renderCreators() {
    fillSelect("#creator-type-filter", creatorTypeOptions(), "全部类型");
    $("#creator-type-list").innerHTML = creatorTypeOptions().map((type) => `<option value="${escapeHtml(type)}"></option>`).join("");
    selectedCreatorIds = new Set([...selectedCreatorIds].filter((id) => canSelectCreator(creators.find((item) => item.id === id))));
    const total = creators.length;
    const head = creators.filter((item) => item.tier === "头部").length;
    const middle = creators.filter((item) => item.tier === "中部").length;
    const tail = creators.filter((item) => item.tier === "尾部").length;
    const amateur = creators.filter((item) => item.tier === "素人").length;
    const completedProfiles = creators.filter(creatorClassificationComplete).length;
    const needsOutreach = creators.filter(canOutreachCreator).length;
    const hasWechat = creators.filter((item) => creatorOutreachStatus(item) === "已加微信").length;
    const blacklisted = creators.filter((item) => item.isBlacklisted).length;
    const delayTagged = creators.filter(creatorDelayTag).length;
    const summary = [
      ["达人总数", total, "Excel与合作台账合并去重", "accent-teal"],
      ["待建联", needsOutreach, "未加微信且未拉黑", "accent-amber"],
      ["已加微信", hasWechat, "可继续完善资料", "accent-blue"],
      ["头部达人", head, "粉丝数 20w 以上", "accent-coral"],
      ["中部达人", middle, "粉丝数 3w-20w", "accent-amber"],
      ["尾部达人", tail, "粉丝数 3k-3w", "accent-blue"],
      ["素人达人", amateur, "粉丝数 500-3k", "accent-violet"],
      ["资料已完善", completedProfiles, "主页、粉丝数与类型均已填写", "accent-violet"],
      ["黑名单", blacklisted, "原因可在表格内维护", "accent-coral"],
      ["拖延标签", delayTagged, "约定发布后仍未发布", "accent-coral"],
    ];
    $("#creator-summary").innerHTML = summary.map(([label, value, note, cls]) => `
      <article class="metric-card ${cls}">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${note}</small>
      </article>
    `).join("");
    renderClassificationWorkbench();

    const rows = filteredCreators();
    $("#creator-table").innerHTML = rows.length ? rows.map((item) => {
      const delayTag = creatorDelayTag(item);
      const cooperatedProducts = creatorCooperatedProducts(item);
      const creatorTags = creatorTagList(item.creatorTags);
      return `
        <tr>
          <td>
            <input type="checkbox" data-select-creator="${escapeHtml(item.id)}" ${selectedCreatorIds.has(item.id) ? "checked" : ""} ${canSelectCreator(item) ? "" : "disabled"} aria-label="选择${escapeHtml(item.name)}建联" />
          </td>
          <td>
            <div class="cell-title">
              <strong>${escapeHtml(item.name)}</strong>
              ${delayTag ? `<span class="pill ${delayTag.tone}">${escapeHtml(delayTag.label)}</span>` : ""}
              ${item.profileLink ? `<a href="${escapeHtml(item.profileLink)}" target="_blank" rel="noreferrer">打开主页</a>` : ""}
              <span class="muted">${escapeHtml(item.source || "达人库")} · ${escapeHtml(item.id)}</span>
              <span class="muted">新增：${escapeHtml(creatorCreatedDate(item) || "未记录")}</span>
              ${creatorTags.length ? `<div class="creator-tags-inline">${creatorTags.map((tag) => `<span class="pill blue">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
            </div>
          </td>
          <td><span class="pill gray">${escapeHtml(item.creatorType || "未分类")}</span></td>
          <td><span class="pill ${item.tier === "头部" ? "coral" : item.tier === "中部" ? "amber" : item.tier === "尾部" ? "blue" : "gray"}">${escapeHtml(item.tier)}</span></td>
          <td>
            <strong>${escapeHtml(item.fansText || compact(item.fanCount))}</strong>
            <div class="muted">${compact(item.fanCount)}</div>
          </td>
          <td>${compact(item.cooperationCount)}</td>
          <td>
            <div class="creator-products-inline">
              ${cooperatedProducts.slice(0, 5).map((product) => `<span class="pill gray">${escapeHtml(product)}</span>`).join("") || `<span class="muted">未记录</span>`}
            </div>
            <div class="muted">${escapeHtml(item.lastCooperationAt || "暂无日期")}</div>
          </td>
          <td>
            <div class="muted">邮箱：${escapeHtml(creatorEmail(item) || "未填")}</div>
            <div class="muted">微信：${escapeHtml(item.wechat || "未填")}</div>
            <div class="muted">地址：${escapeHtml(item.contactAddress || "未填")}</div>
          </td>
          <td>
            <span class="pill ${outreachStatusClass(creatorOutreachStatus(item))}">${escapeHtml(creatorOutreachStatus(item))}</span>
            <div class="muted">邮件：${creatorEmailSentDate(item) ? `已发 ${escapeHtml(creatorEmailSentDate(item))}` : "未发"}</div>
            <div class="muted">最近建联：${escapeHtml(item.lastOutreachAt || "未记录")}</div>
          </td>
          <td>
            ${item.isBlacklisted ? `<span class="pill coral">黑名单</span><div class="muted">${escapeHtml(item.blacklistReason || "未填写原因")}</div>` : `<span class="pill gray">正常</span>`}
          </td>
          <td>
            ${canOutreachTarget(item) ? `<button class="secondary-button small" data-creator-outreach="${escapeHtml(item.id)}">建联</button>` : ""}
            <button class="secondary-button small" data-edit-creator="${escapeHtml(item.id)}">编辑</button>
          </td>
        </tr>
      `;
    }).join("") : `<tr><td colspan="11"><div class="empty-state">暂无匹配达人。</div></td></tr>`;
    const selectableRows = rows.filter(canSelectCreator);
    const selectAll = $("#select-all-outreach");
    if (selectAll) {
      selectAll.checked = selectableRows.length > 0 && selectableRows.every((item) => selectedCreatorIds.has(item.id));
      selectAll.indeterminate = selectableRows.some((item) => selectedCreatorIds.has(item.id)) && !selectAll.checked;
    }
    renderBlacklist();
  }

  function outreachStatusClass(status) {
    return {
      待建联: "amber",
      草稿已生成: "blue",
      已发出: "blue",
      已回复: "status-teal",
      已加微信: "status-green",
      不合适: "gray",
    }[status] || "gray";
  }

  function creatorClassificationComplete(item) {
    return Boolean(
      item &&
      normalizeProfileLink(item.profileLink) &&
      number(item.fanCount) > 0 &&
      item.creatorType &&
      item.creatorType !== "未分类"
    );
  }

  function pendingClassificationCreators() {
    const missingCount = (item) => (
      (!normalizeProfileLink(item.profileLink) ? 1 : 0) +
      (!number(item.fanCount) ? 1 : 0) +
      (!item.creatorType || item.creatorType === "未分类" ? 1 : 0)
    );
    return creators
      .filter((item) => !creatorClassificationComplete(item))
      .sort((a, b) => (
        missingCount(a) - missingCount(b) ||
        number(b.fanCount) - number(a.fanCount) ||
        number(b.cooperationCount) - number(a.cooperationCount)
      ));
  }

  function renderClassificationWorkbench() {
    const content = $("#classification-content");
    if (!content) return;
    const pending = pendingClassificationCreators();
    const completed = creators.length - pending.length;
    const percentDone = creators.length ? Math.round((completed / creators.length) * 100) : 0;
    $("#classification-progress").innerHTML = `
      <strong>${completed} / ${creators.length}</strong>
      <span>${percentDone}% 已完善</span>
      <div class="progress-track"><i style="width:${percentDone}%"></i></div>
    `;

    if (!pending.length) {
      classificationCreatorId = "";
      content.innerHTML = `<div class="empty-state">达人资料已全部完善。</div>`;
      return;
    }

    let current = pending.find((item) => item.id === classificationCreatorId);
    if (!current) current = pending[0];
    classificationCreatorId = current.id;
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(current.name)}`;
    const types = creatorTypeOptions().filter((type) => type !== "未分类");
    const tier = creatorTierByFans(current.fanCount);
    const missing = [
      !normalizeProfileLink(current.profileLink) ? "主页链接" : "",
      !number(current.fanCount) ? "粉丝数" : "",
      !current.creatorType || current.creatorType === "未分类" ? "达人类型" : "",
    ].filter(Boolean);

    content.innerHTML = `
      <div class="classification-layout">
        <aside class="classification-queue" aria-label="待完善达人队列">
          <div class="queue-title">
            <strong>待完善 ${pending.length} 位</strong>
            <span class="pill gray">人工确认模式</span>
          </div>
          <div class="queue-list">
            ${pending.slice(0, 8).map((item) => `
              <button type="button" class="queue-item ${item.id === current.id ? "active" : ""}" data-classification-select="${escapeHtml(item.id)}">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.creatorType || "未分类")} · ${escapeHtml(item.fansText || "粉丝待核对")}</span>
              </button>
            `).join("")}
          </div>
        </aside>
        <form id="classification-form" class="classification-form">
          <input type="hidden" name="id" value="${escapeHtml(current.id)}" />
          <input type="hidden" name="creatorName" value="${escapeHtml(current.name)}" />
          <div class="classification-identity">
            <div>
              <span class="eyebrow">CURRENT CREATOR</span>
              <h3>${escapeHtml(current.name)}</h3>
              <div class="missing-fields">${missing.map((field) => `<span>${escapeHtml(field)}待补充</span>`).join("")}</div>
            </div>
            <div class="classification-actions-top">
              <button type="button" class="secondary-button small" data-copy-classification-name>复制名称</button>
              <a class="primary-button small" href="${escapeHtml(searchUrl)}" target="_blank" rel="noreferrer">打开小红书搜索</a>
            </div>
          </div>
          <div class="classification-fields">
            <label class="wide">主页链接<input name="profileLink" type="text" inputmode="url" required value="${escapeHtml(current.profileLink || "")}" placeholder="可粘贴完整网址、短链接或小红书分享文案" /></label>
            <label>粉丝数量<input name="fansText" required value="${escapeHtml(current.fansText || (current.fanCount ? compact(current.fanCount) : ""))}" placeholder="例如：3.2w 或 32000" /></label>
            <label>达人类型
              <select name="creatorType" required>
                <option value="">请选择</option>
                ${types.map((type) => `<option value="${escapeHtml(type)}" ${type === current.creatorType ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="classification-footer">
            <div class="tier-preview">自动量级：<strong id="classification-tier-preview">${escapeHtml(tier)}</strong></div>
            <div>
              <button type="button" class="secondary-button" data-classification-skip>暂时跳过</button>
              <button type="button" class="primary-button" data-classification-save>保存并下一位</button>
            </div>
          </div>
        </form>
      </div>
    `;
  }

  function renderBlacklist() {
    const rows = creators.filter((item) => item.isBlacklisted);
    $("#blacklist-list").innerHTML = rows.length ? rows.map((item) => `
      <article class="task-card blacklist-card">
        <div>
          <h3>${escapeHtml(item.name)} · ${escapeHtml(item.tier)}</h3>
          <p>${escapeHtml(item.blacklistReason || "未填写原因")}</p>
          <div class="task-meta">
            <span class="pill coral">黑名单</span>
            <span class="pill gray">${escapeHtml(item.creatorType || "未分类")}</span>
            <span class="pill gray">${escapeHtml(item.fansText || compact(item.fanCount))}</span>
          </div>
        </div>
        <div class="task-action">
          <button class="secondary-button small" data-clear-blacklist="${escapeHtml(item.id)}">移出黑名单</button>
        </div>
      </article>
    `).join("") : `<div class="empty-state">暂无黑名单博主。</div>`;
  }

  async function saveClassificationCreator(form) {
    if (!form || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const nameKey = creatorKey(data.creatorName);
    const index = creators.findIndex((item) => item.id === data.id && creatorKey(item.name) === nameKey) >= 0
      ? creators.findIndex((item) => item.id === data.id && creatorKey(item.name) === nameKey)
      : creators.findIndex((item) => creatorKey(item.name) === nameKey);
    if (index < 0) {
      toast("没有找到当前达人，请重新选择");
      return;
    }
    const fanCount = fanCountFromText(data.fansText);
    if (!fanCount) {
      toast("请填写有效粉丝数量");
      return;
    }
    const profileLink = normalizeProfileLink(data.profileLink);
    if (!profileLink) {
      toast("未识别到有效主页链接，请重新粘贴");
      form.elements.profileLink.focus();
      return;
    }
    const pendingBeforeSave = pendingClassificationCreators();
    const currentIndex = pendingBeforeSave.findIndex((item) => item.id === data.id);
    const nextCreator = pendingBeforeSave[currentIndex + 1] || pendingBeforeSave[0] || null;
    try {
      localStorage.setItem(CREATORS_BACKUP_STORAGE_KEY, JSON.stringify(creators));
    } catch {
      toast("本机存储空间不足，尚未修改达人资料");
      return;
    }
    creators[index] = {
      ...creators[index],
      profileLink,
      fansText: String(data.fansText || "").trim(),
      fanCount,
      tier: creatorTierByFans(fanCount),
      creatorType: String(data.creatorType || "").trim() || "未分类",
      updatedAt: new Date().toISOString(),
    };
    saveCreators();
    await flushServerSave();
    const persistedCreators = loadCreators();
    const persisted = persistedCreators.find((item) => creatorKey(item.name) === nameKey);
    const savedCorrectly = persisted &&
      persisted.profileLink === creators[index].profileLink &&
      persisted.fanCount === creators[index].fanCount &&
      persisted.creatorType === creators[index].creatorType;
    if (!savedCorrectly) {
      toast("保存未成功，请先导出数据备份后重试");
      return;
    }
    creators = persistedCreators;
    const persistedNext = nextCreator && creatorKey(nextCreator.name) !== nameKey
      ? creators.find((item) => creatorKey(item.name) === creatorKey(nextCreator.name))
      : null;
    classificationCreatorId = persistedNext?.id || "";
    hydrateControls();
    renderCreators();
    $("#save-status").textContent = `达人资料已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    toast("达人资料已保存，已进入下一位");
  }

  function filteredPlacements() {
    const query = $("#search-input")?.value.trim().toLowerCase() || "";
    const status = $("#status-filter")?.value || "all";
    const content = $("#content-filter")?.value || "all";
    const result = $("#result-filter")?.value || "all";
    const dataEntry = $("#data-entry-filter")?.value || "all";
    return filterSelectedProduct(placementsForPeriod(ledgerPeriod)).filter((item) => {
      const haystack = [item.creator, item.product, item.noteTitle, item.owner, item.contactMethod, item.creatorResponse, item.notes, placementPlatform(item)].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (status !== "all" && item.status !== status) return false;
      if (content !== "all" && item.contentType !== content) return false;
      if (result !== "all" && feedbackType(item) !== result) return false;
      if (dataEntry === "missing" && hasPlacementPerformanceData(item)) return false;
      if (dataEntry === "filled" && !hasPlacementPerformanceData(item)) return false;
      return true;
    });
  }

  function ledgerNoProgressRecord(item) {
    if (item.status !== "待建联") return false;
    if (needsSampleShipment(item)) return false;
    if (String(item.publishedAt || "").trim() || publishDueDate(item)) return false;
    if (String(item.sampleDeliveredAt || "").trim() || sampleTrackingNumber(item)) return false;
    if (String(item.draftSubmittedAt || "").trim() || String(item.lastContactAt || "").trim()) return false;
    return progress(item.deliverableProgress).done === 0;
  }

  function ledgerCompletedRecord(item) {
    return item.status === "已发布" && hasPlacementPerformanceData(item);
  }

  function ledgerVisibleRecord(item) {
    return ledgerNoProgressRecord(item) || ledgerCompletedRecord(item);
  }

  function publishedAge(item) {
    if (item.status !== "已发布" || !item.publishedAt) return NaN;
    return daysSince(item.publishedAt);
  }

  function publishedAgeText(item) {
    if (item.status !== "已发布") return "";
    if (!item.publishedAt) return "已发布 · 实际日期未填";
    const age = publishedAge(item);
    return Number.isFinite(age) ? `已发布${age}天` : "已发布 · 日期待确认";
  }

  function missingMetricSort(a, b) {
    const dueA = isDay7ReviewDue(a);
    const dueB = isDay7ReviewDue(b);
    const ageA = Number.isFinite(publishedAge(a)) ? publishedAge(a) : -1;
    const ageB = Number.isFinite(publishedAge(b)) ? publishedAge(b) : -1;
    return Number(dueB) - Number(dueA) ||
      ageB - ageA ||
      String(b.publishedAt || b.agreedPublishAt || b.plannedAt || "").localeCompare(String(a.publishedAt || a.agreedPublishAt || a.plannedAt || ""));
  }

  function filledMetricSort(a, b) {
    const mode = $("#metric-sort")?.value || "time";
    if (mode === "likes") {
      return number(b.likes) - number(a.likes) ||
        number(b.saves) - number(a.saves) ||
        number(b.comments) - number(a.comments) ||
        String(b.publishedAt || b.agreedPublishAt || "").localeCompare(String(a.publishedAt || a.agreedPublishAt || ""));
    }
    return String(b.publishedAt || b.agreedPublishAt || b.plannedAt || "").localeCompare(String(a.publishedAt || a.agreedPublishAt || a.plannedAt || "")) ||
      number(b.likes) - number(a.likes);
  }

  function ledgerGroupHeader(title, count, note, tone = "gray") {
    return `
      <tr class="ledger-group-row ${tone}">
        <td colspan="8">
          <div class="ledger-group-title">
            <strong>${escapeHtml(title)}</strong>
            <span>${compact(count)} 条</span>
            <small>${escapeHtml(note)}</small>
          </div>
        </td>
      </tr>
    `;
  }

  function placementRow(item) {
    const values = calc(item);
    const type = feedbackType(item, values);
    const task = followupTask(item);
    const catalogProducts = placementProducts(item);
    const productText = catalogProducts.length
      ? catalogProducts.map((product) => `<a href="${escapeHtml(productUrl(product))}" target="_blank" rel="noreferrer">${escapeHtml(product.name)}</a>`).join("、")
      : escapeHtml(placementProductName(item));
    const creatorRecord = creators.find((creator) => creatorKey(creator.name) === creatorKey(item.creator));
    const creatorProfile = normalizeProfileLink(creatorRecord?.profileLink || item.creatorProfile);
    const creatorName = creatorProfile
      ? `<a class="creator-profile-link" href="${escapeHtml(creatorProfile)}" target="_blank" rel="noreferrer">${escapeHtml(item.creator)}</a>`
      : `<span>${escapeHtml(item.creator)}</span>`;
    const agreedPublishAt = item.agreedPublishAt || "未填写";
    const publishedAt = item.publishedAt || "未填写";
    const ageText = publishedAgeText(item);
    const placementNotes = String(item.notes || "").trim() || "未填写";
    const platform = placementPlatform(item);
    const missingMetrics = !hasPlacementPerformanceData(item);
    const isDay7Due = isDay7ReviewDue(item);
    const isPoorPerformance = hasPlacementPerformanceData(item) && Boolean(item.publishedAt) && number(item.likes) < 200;
    const productCost = placementProductCost(item);
    const costStatus = placementCostStatus(item);
    const link = item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.noteTitle || item.product)}</a>` : `<strong>${escapeHtml(item.noteTitle || item.product)}</strong>`;
    return `
      <tr class="${isPoorPerformance ? "poor-performance-row" : ""} ${isDay7Due ? "day7-due-row" : ""}">
        <td><span class="pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
        <td>
          <div class="cell-title">
            <div class="placement-title-line">${link}${isPoorPerformance ? `<span class="pill coral">数据较差</span>` : ""}${isDay7Due ? `<span class="pill coral">发布7天待填</span>` : ""}</div>
            <span class="muted">${creatorName} · ${escapeHtml(item.creatorTier)} · ${productText}</span>
            <span class="placement-detail-line">
              <span>约定发布：${escapeHtml(agreedPublishAt)}</span>
              <span>实际发布：${escapeHtml(publishedAt)}</span>
              <span>快递单号：${escapeHtml(sampleTrackingNumber(item) || "未填写")}</span>
              ${ageText ? `<span class="${missingMetrics && item.status === "已发布" ? "publish-age-warning" : ""}">${escapeHtml(ageText)}</span>` : ""}
              <span>备注：${escapeHtml(placementNotes)}</span>
            </span>
            <span class="platform-badge ${platform === "抖音" ? "douyin" : "xhs"}">${escapeHtml(platform)}</span>
          </div>
        </td>
        <td>${money(values.spend)}<div class="muted">合作 ${money(item.fee)} / 其他 ${money(item.extraCost)}</div><div class="muted">产品 ${money(productCost)} · ${escapeHtml(costStatus.label)}</div></td>
        <td>
          ${ledgerMetricsDisplay(item)}
        </td>
        <td>${compact(item.leads)} 线索<div class="muted">${compact(item.orders)} 单 · ${money(item.gmv)}</div></td>
        <td><span class="pill ${task.priority === "最高" ? "coral" : task.priority === "高" ? "amber" : task.priority === "中" ? "blue" : "gray"}">${task.priority}</span><div class="muted">${escapeHtml(task.action)}</div></td>
        <td><span class="pill ${feedbackClass(type)}">${feedbackLabel(type)}</span><div class="muted">${feedbackReason(item)}</div></td>
        <td>
          <button class="text-button" data-edit="${item.id}">编辑</button>
          <button class="text-button danger-text" data-remove="${item.id}">删除</button>
        </td>
      </tr>
    `;
  }

  function renderTable() {
    const rows = filteredPlacements();
    const ledgerRows = rows.filter(ledgerVisibleRecord);
    if (!ledgerRows.length) {
      $("#placement-table").innerHTML = `<tr><td colspan="8"><div class="empty-state">当前筛选下没有台账记录；已发布未满7天、7天待填、到期未发布等中间状态会集中到跟进任务。</div></td></tr>`;
      return;
    }
    const idleRows = ledgerRows.filter(ledgerNoProgressRecord).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || String(b.id || "").localeCompare(String(a.id || "")));
    const completedRows = ledgerRows.filter(ledgerCompletedRecord).sort(filledMetricSort);
    const dataEntry = $("#data-entry-filter")?.value || "all";
    const sections = [];
    if (dataEntry !== "filled" && idleRows.length) {
      sections.push(ledgerGroupHeader("未启动 / 无进度", idleRows.length, "还没有排期、寄样、发布或跟进动作", "gray"));
      sections.push(...idleRows.map(placementRow));
    }
    if (dataEntry !== "missing" && completedRows.length) {
      const sortLabel = ($("#metric-sort")?.value || "time") === "likes" ? "按点赞从高到低" : "按发布时间从新到旧";
      sections.push(ledgerGroupHeader("已发布并已填写数据", completedRows.length, sortLabel, "teal"));
      sections.push(...completedRows.map(placementRow));
    }
    $("#placement-table").innerHTML = sections.join("") || `<tr><td colspan="8"><div class="empty-state">当前筛选下没有台账记录；请到跟进任务查看未到7天、7天待填和到期未发布。</div></td></tr>`;
  }

  function ledgerMetricsDisplay(item) {
    const reviewed = hasPlacementPerformanceData(item);
    const due = isDay7ReviewDue(item);
    const publishedDays = daysSince(item.publishedAt);
    const note = reviewed
      ? item.performanceReviewedAt ? `已补录 ${String(item.performanceReviewedAt).slice(0, 10)}` : "已录入"
      : due ? "跟进任务待填" : Number.isFinite(publishedDays) ? `发布${publishedDays}天` : "未发布";
    return `
      <div class="ledger-metrics ${reviewed ? "" : "pending"}">
        <div class="ledger-metric"><span>赞</span><strong>${compact(item.likes)}</strong></div>
        <div class="ledger-metric"><span>收藏</span><strong>${compact(item.saves)}</strong></div>
        <div class="ledger-metric"><span>评论</span><strong>${compact(item.comments)}</strong></div>
        <div class="metric-note">${escapeHtml(note)}</div>
      </div>
    `;
  }

  function sampleShipmentForm(item) {
    return `
      <form class="review-quick-form shipping-quick-form" data-shipment-form="${escapeHtml(item.id)}">
        <label class="shipping-check-line"><input data-shipment-field="shipped" type="checkbox" /> 已寄出</label>
        <label>快递单号<input data-shipment-field="sampleTrackingNumber" value="${escapeHtml(sampleTrackingNumber(item))}" maxlength="80" placeholder="填写单号" /></label>
        <button class="primary-button small" type="submit">保存单号</button>
      </form>
    `;
  }

  async function savePerformanceReview(form) {
    const id = form.dataset.reviewForm;
    const item = placements.find((placement) => placement.id === id);
    if (!item) return;
    ["likes", "saves", "comments"].forEach((field) => {
      const input = form.querySelector(`[data-review-field="${field}"]`);
      item[field] = number(input?.value);
    });
    item.performanceReviewedAt = new Date().toISOString();
    item.updatedAt = item.performanceReviewedAt;
    savePlacements();
    syncCreatorsFromPlacements();
    await flushServerSave();
    renderAll();
    toast("互动数据已保存，跟进任务已归档");
  }

  async function saveSampleShipment(form) {
    const id = form.dataset.shipmentForm;
    const item = placements.find((placement) => placement.id === id);
    if (!item) return;
    const trackingNumber = String(form.querySelector("[data-shipment-field='sampleTrackingNumber']")?.value || "").trim();
    if (!trackingNumber) {
      toast("请先填写快递单号");
      return;
    }
    item.sampleTrackingNumber = trackingNumber;
    item.sampleStatus = "已寄样";
    if (!["已签收", "脚本已确认", "等待发布", "已发布"].includes(item.status)) item.status = "已寄样";
    item.updatedAt = new Date().toISOString();
    savePlacements();
    syncCreatorsFromPlacements();
    renderAll();
    toast("单号已保存，状态已变成已寄样");
    syncServerInBackground();
  }


  function renderFeedback() {
    const rows = scopedPlacements();
    const groups = {
      scale: rows.filter((item) => feedbackType(item) === "scale"),
      optimize: rows.filter((item) => feedbackType(item) === "optimize"),
      pause: rows.filter((item) => feedbackType(item) === "pause"),
    };
    const pending = rows.filter((item) => item.status !== "已发布");
    $("#feedback-grid").innerHTML = `
      ${feedbackCard("可加投", groups.scale, "优先谈二次合作、同类达人扩量、评论区承接优化。")}
      ${feedbackCard("需优化", groups.optimize, "优先看首图、标题钩子、卖点清晰度和私信路径。")}
      ${feedbackCard("暂停观察", groups.pause, "暂缓同类达人扩量，复查人群匹配和内容交付质量。")}
      <article class="feedback-card full">
        <h2>本周执行提醒</h2>
        <ul>
          <li><strong>${pending.length} 条</strong>投放还在交付链路中，优先催脚本、寄样、发布时间和链接回收。</li>
          <li><strong>复盘口径</strong>建议统一为发布后 24 小时、72 小时、7 天三次记录，避免只看首日波动。</li>
          <li><strong>下一轮选人</strong>优先复制高收藏、高评论提问、高 ROAS 达人的人设与内容结构。</li>
        </ul>
      </article>
    `;
  }

  function feedbackCard(title, items, emptyText) {
    const body = items.length ? items.slice(0, 5).map((item) => `<li><strong>${escapeHtml(item.creator)}</strong>：${feedbackReason(item)}</li>`).join("") : `<li>${emptyText}</li>`;
    return `<article class="feedback-card"><h2>${title}</h2><ul>${body}</ul></article>`;
  }

  function renderAll() {
    renderPeriodControls();
    renderProductBoard();
    renderCreators();
    renderMetrics();
    renderBudgetPanel();
    renderMonthlyStats();
    renderAnnualTrend();
    renderStatusBoard();
    renderRanking();
    renderFollowups();
    renderTable();
    renderFeedback();
  }

  function fillSelect(selector, values, allLabel) {
    $$(selector).forEach((select) => {
      const current = select.value;
      const includeAll = select.id && allLabel;
      select.innerHTML = `${includeAll ? `<option value="all">${allLabel}</option>` : ""}${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
      if (values.includes(current) || current === "all") select.value = current;
    });
  }

  function hydrateControls() {
    fillSelect("[name='status'], #status-filter", statuses, "全部状态");
    fillSelect("[name='sampleStatus']", sampleStatuses);
    fillSelect("[name='draftStatus']", draftStatuses);
    fillSelect("#creator-form [name='creatorType']", creatorTypeOptions());
    fillSelect("#creator-form [name='outreachStatus']", creatorOutreachStatuses);
    fillSelect("#creator-type-filter", creatorTypeOptions(), "全部类型");
    fillSelect("[name='contentType'], #content-filter", contentTypes, "全部类型");
    fillSelect("[name='platform']", platformOptions);
    fillWholesaleProductSelect();
    $("#creator-type-list").innerHTML = creatorTypeOptions().map((type) => `<option value="${escapeHtml(type)}"></option>`).join("");
    $("#creator-name-list").innerHTML = creators.map((creator) => `<option value="${escapeHtml(creator.name)}" label="${escapeHtml(`${creator.creatorType || "未分类"} · ${creator.fansText || compact(creator.fanCount)}`)}"></option>`).join("");
  }

  function productOptionLabel(product) {
    return product.code ? `${product.code} · ${product.name}` : product.name;
  }

  function productSegments(value) {
    return String(value || "").split(/[、,，+]/).map((item) => item.trim()).filter(Boolean);
  }

  function productLookupKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[·•・：:;；,，、()（）【】\[\]_\-—–]/g, "");
  }

  function productsFromProductText(value) {
    const segments = productSegments(value);
    const segmentMatches = segments.map((segment) => {
      const direct = findCatalogProduct(segment);
      if (direct) return direct;
      const segmentKey = productLookupKey(segment);
      return productCatalog.find((product) => {
        const nameKey = productLookupKey(product.name);
        const codeKey = productLookupKey(product.code);
        return (nameKey && (segmentKey.includes(nameKey) || nameKey.includes(segmentKey))) ||
          (codeKey && (segmentKey.includes(codeKey) || codeKey.includes(segmentKey)));
      });
    }).filter(Boolean);
    if (segmentMatches.length) return uniqueProducts(segmentMatches);
    const textKey = productLookupKey(value);
    if (!textKey) return [];
    return uniqueProducts(productCatalog.filter((product) => {
      const nameKey = productLookupKey(product.name);
      const codeKey = productLookupKey(product.code);
      return (nameKey && textKey.includes(nameKey)) || (codeKey && textKey.includes(codeKey));
    }));
  }

  function uniqueProducts(products) {
    return Array.from(new Map(products.filter(Boolean).map((product) => [product.id, product])).values());
  }

  function fillWholesaleProductSelect() {
    renderProductPickerOptions();
  }

  function selectedWholesaleProductsFromForm() {
    const form = $("#placement-form");
    if (!form) return [];
    const byText = productsFromProductText(form.elements.product?.value || "");
    const ids = productSegments(form.elements.productIds?.value || "");
    const byId = ids.map(findCatalogProduct).filter(Boolean);
    return uniqueProducts([...byId, ...byText]);
  }

  function updatePlacementProductCostDisplay() {
    const form = $("#placement-form");
    if (!form?.elements.productCostDisplay) return;
    const products = selectedWholesaleProductsFromForm();
    const quantity = sampleQuantity({ sampleQuantity: form.elements.sampleQuantity?.value || 1 });
    const cost = productsCostTotal(products, quantity);
    const missing = products.filter((product) => !productUnitCost(product)).length;
    form.elements.productCostDisplay.value = products.length
      ? `${cost ? money(cost) : "成本未连接"}${quantity > 1 ? `（每个产品 ${quantity} 件）` : ""}${missing ? `，${missing} 个缺真实成本` : ""}`
      : "未关联订货产品";
  }

  function renderProductPickerOptions() {
    const menu = $("#product-picker-menu");
    const list = $("#product-picker-options");
    const search = $("#product-picker-search");
    if (!menu || !list) return;
    const selectedIds = new Set(selectedWholesaleProductsFromForm().map((product) => product.id));
    const query = String(search?.value || "").trim().toLowerCase();
    const rows = productCatalog.filter((product) => {
      if (!query) return true;
      return `${product.code} ${product.name} ${product.category}`.toLowerCase().includes(query);
    }).slice(0, 80);
    list.innerHTML = rows.length ? rows.map((product) => {
      const selected = selectedIds.has(product.id);
      return `
        <button type="button" class="product-picker-option ${selected ? "selected" : ""}" data-product-option="${escapeHtml(product.id)}">
          <span class="checkmark">${selected ? "✓" : ""}</span>
          <span>
            <strong>${escapeHtml(productOptionLabel(product))}</strong>
            <small>${escapeHtml(product.category || "未分类")} · ${escapeHtml(product.status || "需确认")} · 成本 ${escapeHtml(productCostLabel(product))}</small>
          </span>
        </button>
      `;
    }).join("") : `<div class="product-picker-empty">没有匹配产品，可直接手动填写。</div>`;
  }

  function toggleProductInForm(productId) {
    const product = findCatalogProduct(productId);
    if (!product) return;
    const current = new Map(selectedWholesaleProductsFromForm().map((item) => [item.id, item]));
    if (current.has(product.id)) current.delete(product.id);
    else current.set(product.id, product);
    applyWholesaleProductsToForm([...current.values()]);
    renderProductPickerOptions();
  }

  function setProductPickerOpen(open) {
    const menu = $("#product-picker-menu");
    if (!menu) return;
    if (open) renderProductPickerOptions();
    menu.hidden = !open;
  }

  function applyWholesaleProductsToForm(products = [], options = {}) {
    const form = $("#placement-form");
    const link = $("#product-stock-link");
    const updateProductText = options.updateProductText !== false;
    const selected = products.filter(Boolean);
    const ids = selected.map((product) => product.id);
    const codes = selected.map((product) => product.code).filter(Boolean);
    const categories = Array.from(new Set(selected.map((product) => product.category).filter(Boolean)));
    const statusesForProducts = Array.from(new Set(selected.map((product) => product.status).filter(Boolean)));
    form.elements.productId.value = ids[0] || "";
    form.elements.productIds.value = ids.join(",");
    form.elements.productCode.value = codes[0] || "";
    form.elements.productCodes.value = codes.join(",");
    form.elements.productCategory.value = categories.join(" / ");
    form.elements.productStatus.value = statusesForProducts.join(" / ");
    form.elements.productStatusDisplay.value = selected.length ? selected.map((product) => `${product.code || product.name}：${product.status || "需确认"}`).join("；") : "";
    form.elements.productUrl.value = selected.length === 1 ? productUrl(selected[0]) : "";
    if (selected.length && updateProductText) form.elements.product.value = selected.map((product) => product.name).join("、");
    updatePlacementProductCostDisplay();
    renderDuplicateCooperationWarning();
    if (link) {
      link.href = selected.length === 1 ? productUrl(selected[0]) : WHOLESALE_PORTAL_URL;
      link.textContent = selected.length === 1
        ? `打开订货站查看库存：${selected[0].code || selected[0].name}`
        : selected.length > 1
          ? `打开订货站查看库存：已选 ${selected.length} 件产品`
          : "打开订货站查看库存";
    }
  }

  function openForm(item = null) {
    const dialog = $("#placement-dialog");
    const form = $("#placement-form");
    form.reset();
    hydrateControls();
    $("[data-delete]", form).style.visibility = item ? "visible" : "hidden";
    if (item) {
      Object.entries(item).forEach(([key, value]) => {
        if (form.elements[key]) form.elements[key].value = value;
      });
      form.elements.sampleTrackingNumber.value = sampleTrackingNumber(item);
      form.elements.requiresDraftReview.value = needsDraftReview(item) ? "yes" : "no";
      form.elements.sampleQuantity.value = sampleQuantity(item);
      applyWholesaleProductsToForm(placementProducts(item));
    } else {
      form.elements.id.value = "";
      form.elements.owner.value = "Chloe";
      form.elements.status.value = "待建联";
      form.elements.platform.value = "小红书";
      form.elements.sampleStatus.value = "待寄样";
      form.elements.draftStatus.value = "未申请";
      form.elements.requiresDraftReview.value = "yes";
      form.elements.deliverableProgress.value = "0/1";
      form.elements.followUpCount.value = 0;
      form.elements.plannedAt.value = "";
      form.elements.sampleQuantity.value = 1;
      applyWholesaleProductsToForm([]);
    }
    renderDuplicateCooperationWarning();
    dialog.showModal();
  }

  function openCreatorForm(item) {
    const dialog = $("#creator-dialog");
    const form = $("#creator-form");
    form.reset();
    hydrateControls();
    $("#creator-dialog-title").textContent = item ? "编辑达人" : "新增达人";
    form.elements.id.value = item?.id || "";
    form.elements.name.value = item?.name || "";
    form.elements.creatorType.value = item?.creatorType || "未分类";
    if (form.elements.creatorTypeCustom) form.elements.creatorTypeCustom.value = "";
    form.elements.fansText.value = item ? item.fansText || (item.fanCount ? compact(item.fanCount) : "") : "";
    form.elements.email.value = item?.email || "";
    form.elements.wechat.value = item?.wechat || "";
    form.elements.outreachStatus.value = item ? creatorOutreachStatus(item) : "待建联";
    form.elements.profileLink.value = item?.profileLink || "";
    form.elements.creatorTags.value = creatorTagList(item?.creatorTags || item?.tags || "").join("、");
    form.elements.collaboratedProductsManual.value = item?.collaboratedProductsManual || "";
    const autoProducts = item ? Array.from(new Set(creatorPlacementProducts(item.name))) : [];
    $("#creator-auto-products").innerHTML = autoProducts.length
      ? autoProducts.map((product) => `<span class="pill gray">${escapeHtml(product)}</span>`).join("")
      : `<span class="muted">暂无台账合作产品</span>`;
    form.elements.contactAddress.value = item?.contactAddress || "";
    form.elements.isBlacklisted.checked = Boolean(item?.isBlacklisted);
    form.elements.blacklistReason.value = item?.blacklistReason || "";
    dialog.showModal();
  }

  function formToCreator(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const current = creators.find((item) => item.id === data.id) || {};
    const fansText = String(data.fansText || "").trim();
    const fanCount = fanCountFromText(fansText);
    const creatorType = String(data.creatorTypeCustom || data.creatorType || "").trim() || "未分类";
    return {
      ...current,
      id: data.id || current.id || creatorId(data.name),
      name: String(data.name || "").trim() || "未命名达人",
      creatorType,
      fansText,
      fanCount,
      tier: creatorTierByFans(fanCount),
      email: String(data.email || "").trim(),
      wechat: String(data.wechat || "").trim(),
      outreachStatus: String(data.wechat || "").trim() ? "已加微信" : String(data.outreachStatus || "待建联").trim(),
      profileLink: String(data.profileLink || "").trim(),
      creatorTags: creatorTagList(data.creatorTags),
      collaboratedProductsManual: productTextList(data.collaboratedProductsManual).join("、"),
      contactAddress: String(data.contactAddress || "").trim(),
      isBlacklisted: form.elements.isBlacklisted.checked,
      blacklistReason: String(data.blacklistReason || "").trim(),
      createdAt: current.createdAt || (current.id ? "" : today()),
      updatedAt: today(),
    };
  }

  function applyCreatorToPlacementForm(name) {
    const creator = creators.find((item) => creatorKey(item.name) === creatorKey(name));
    if (!creator) return;
    const form = $("#placement-form");
    const type = creator.creatorType && creator.creatorType !== "未分类" ? creator.creatorType : "";
    form.elements.creatorTier.value = [type, creator.tier].filter(Boolean).join(" / ") || "未分类";
    if (creator.wechat && !form.elements.contactMethod.value) form.elements.contactMethod.value = creator.wechat;
  }

  function formToPlacement(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const current = placements.find((item) => item.id === data.id) || {};
    const selectedProducts = selectedWholesaleProductsFromForm();
    data.sampleStatus = data.sampleStatus || current.sampleStatus || "待寄样";
    data.sampleDeliveredAt = data.sampleDeliveredAt || current.sampleDeliveredAt || "";
    data.deliverableProgress = data.deliverableProgress || current.deliverableProgress || "0/1";
    data.requiresDraftReview = data.requiresDraftReview || current.requiresDraftReview || "yes";
    data.draftStatus = data.draftStatus || current.draftStatus || "未申请";
    data.draftSubmittedAt = data.draftSubmittedAt || current.draftSubmittedAt || "";
    data.lastContactAt = data.lastContactAt || current.lastContactAt || "";
    data.creatorResponse = data.creatorResponse || current.creatorResponse || "";
    data.plannedAt = data.agreedPublishAt || "";
    data.followUpCount = data.followUpCount || current.followUpCount || 0;
    ["fee", "extraCost", "sampleQuantity", "exposure", "clicks", "likes", "saves", "comments", "shares", "leads", "orders", "gmv", "followUpCount"].forEach((key) => {
      data[key] = number(data[key]);
    });
    data.sampleTrackingNumber = sampleTrackingNumber(data);
    if (data.sampleTrackingNumber) {
      if (!["已签收", "无需寄样"].includes(data.sampleStatus)) data.sampleStatus = "已寄样";
      if (!["已签收", "脚本已确认", "等待发布", "已发布"].includes(data.status)) data.status = "已寄样";
    }
    data.sampleQuantity = sampleQuantity(data);
    data.productIds = selectedProducts.map((product) => product.id);
    data.productCodes = selectedProducts.map((product) => product.code).filter(Boolean);
    data.productId = data.productIds[0] || "";
    data.productCode = data.productCodes[0] || "";
    data.productCategory = Array.from(new Set(selectedProducts.map((product) => product.category).filter(Boolean))).join(" / ");
    data.productStatus = Array.from(new Set(selectedProducts.map((product) => product.status).filter(Boolean))).join(" / ");
    data.productUrl = selectedProducts.length === 1 ? productUrl(selectedProducts[0]) : "";
    const missingCost = selectedProducts.some((product) => !productUnitCost(product));
    data.productCostSnapshot = missingCost ? 0 : productsCostTotal(selectedProducts, data.sampleQuantity);
    data.productCostConnected = selectedProducts.length > 0 && !missingCost;
    data.productCostSource = data.productCostConnected ? "订货后台真实成本" : "";
    if (selectedProducts.length) data.product = selectedProducts.map((product) => product.name).join("、");
    data.creatorTier = form.elements.creatorTier.value || data.creatorTier || "";
    data.platform = placementPlatform(data);
    data.status = normalizePlacementStatus(data.status, data);
    data.id = data.id || uid();
    data.createdAt = current.createdAt || today();
    data.updatedAt = new Date().toISOString();
    return data;
  }

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 1800);
  }

  function buildReport() {
    const rows = scopedPlacements();
    const published = rows.filter((item) => item.status === "已发布");
    const cooperationSpend = rows.reduce((sum, item) => sum + calc(item).spend, 0);
    const productCost = rows.reduce((sum, item) => sum + placementProductCost(item), 0);
    const spend = cooperationSpend + productCost;
    const gmv = rows.reduce((sum, item) => sum + number(item.gmv), 0);
    const scale = rows.filter((item) => feedbackType(item) === "scale");
    const optimize = rows.filter((item) => feedbackType(item) === "optimize");
    const pause = rows.filter((item) => feedbackType(item) === "pause");
    const urgent = followupTasks().filter((item) => item.task.priority !== "暂无").slice(0, 5);
    return [
      `小红书媒介投放复盘${selectedProduct === "all" ? "" : `｜${selectedProduct}`}`,
      `投放记录：${rows.length} 条，已发布：${published.length} 条`,
      `总花费：${money(spend)}（合作/履约 ${money(cooperationSpend)}，产品成本 ${money(productCost)}），GMV：${money(gmv)}，总 ROAS：${spend ? ratio(gmv / spend) : "无"}`,
      `今日跟进：${urgent.map((item) => `${item.creator}（${item.task.priority}）`).join("、") || "暂无"}`,
      `可加投：${scale.map((item) => item.creator).join("、") || "暂无"}`,
      `需优化：${optimize.map((item) => item.creator).join("、") || "暂无"}`,
      `暂停观察：${pause.map((item) => item.creator).join("、") || "暂无"}`,
      "下一步：优先复制高 ROAS 达人的内容结构；中段数据优化首图、标题和私信承接；低互动低转化达人暂停扩量。",
    ].join("\n");
  }

  function buildFollowupReport() {
    const tasks = followupTasks().filter((item) => item.task.priority !== "暂无");
    return [
      "小红书媒介今日跟进清单",
      `需跟进：${tasks.length} 条`,
      ...tasks.map((item, index) => `${index + 1}. ${item.creator}｜${item.product}｜${item.task.priority}｜${item.task.reason}｜${item.task.action}`),
    ].join("\n");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(cell);
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
  }

  function csvValue(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function downloadText(filename, text, type = "text/plain") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  const csvHeaders = ["达人昵称", "达人主页", "联系方式", "达人类型", "订货站产品ID", "产品货号", "产品/活动", "平台", "内容类型", "负责人", "投放状态", "样品状态", "快递单号", "样品签收日期", "内容进度", "约定发布日期", "稿件申请状态", "稿件申请日期", "上次联系日期", "跟进次数", "达人回复", "计划发布时间", "实际发布时间", "合作费", "样品/履约成本", "样品数量", "产品成本快照", "曝光", "阅读/点击", "点赞", "收藏", "评论", "分享", "新增私信/线索", "成交单数", "GMV", "笔记链接", "笔记标题", "备注"];

  function buildCsvTemplate() {
    const example = ["小红书达人A", "https://www.xiaohongshu.com/user/profile/example", "小红书私信", "KOC", "", "", "新品试用", "小红书", "测评种草", "Chloe", "已签收", "已签收", "SF1234567890", today(), "0/1", today(), "未申请", "", today(), "0", "已确认收到", today(), "", "1200", "150", "1", "", "", "", "", "", "", "", "", "", "", "", "新品试用真实测评", "样品已签收，等待发布时间"];
    return [csvHeaders, example].map((row) => row.map(csvValue).join(",")).join("\n");
  }

  function rowToPlacement(row) {
    const get = (...names) => {
      for (const name of names) {
        if (row[name] !== undefined && row[name] !== "") return row[name];
      }
      return "";
    };
    const productIds = String(get("订货站产品ID", "productId", "productIds")).split(",").map((item) => item.trim()).filter(Boolean);
    const productCodes = String(get("产品货号", "productCode", "productCodes")).split(",").map((item) => item.trim()).filter(Boolean);
    const trackingNumber = get("快递单号", "物流单号", "运单号", "sampleTrackingNumber", "trackingNumber", "expressNo", "logisticsNo");
    const sampleStatus = trackingNumber ? "已寄样" : (get("样品状态", "Sample shipping status", "sampleStatus") || "未寄样");
    return {
      id: uid(),
      creator: get("达人昵称", "Creator username", "creator"),
      creatorProfile: get("达人主页", "Creator profile link", "profileLink"),
      contactMethod: get("联系方式", "Contact method", "contactMethod"),
      creatorTier: get("达人类型", "creatorTier") || "KOC",
      productId: productIds[0] || "",
      productIds,
      productCode: productCodes[0] || "",
      productCodes,
      product: get("产品/活动", "Product", "product"),
      platform: placementPlatform({ platform: get("平台", "platform") }),
      contentType: get("内容类型", "contentType") || "测评种草",
      owner: get("负责人", "owner") || "Chloe",
      status: normalizePlacementStatus(get("投放状态", "Current status", "status") || "待建联", {
        publishedAt: get("实际发布时间", "First video posted date", "publishedAt"),
        sampleStatus,
        sampleTrackingNumber: trackingNumber,
      }),
      sampleStatus,
      sampleTrackingNumber: trackingNumber,
      sampleDeliveredAt: get("样品签收日期", "Sample delivered date", "sampleDeliveredAt"),
      deliverableProgress: get("内容进度", "Video progress", "deliverableProgress") || "0/1",
      agreedPublishAt: get("约定发布日期", "Agreed publish date", "agreedPublishAt"),
      draftStatus: get("稿件申请状态", "Draft status", "draftStatus") || "未申请",
      draftSubmittedAt: get("稿件申请日期", "Draft submitted date", "draftSubmittedAt"),
      lastContactAt: get("上次联系日期", "Last contact date", "lastContactAt"),
      followUpCount: number(get("跟进次数", "Last follow-up count", "followUpCount")),
      creatorResponse: get("达人回复", "Last creator response", "creatorResponse"),
      plannedAt: get("计划发布时间", "plannedAt"),
      publishedAt: get("实际发布时间", "First video posted date", "publishedAt"),
      fee: number(get("合作费", "fee")),
      extraCost: number(get("样品/履约成本", "extraCost")),
      sampleQuantity: sampleQuantity({ sampleQuantity: get("样品数量", "sampleQuantity") || 1 }),
      productCostSnapshot: number(get("产品成本快照", "productCostSnapshot")),
      exposure: number(get("曝光", "exposure")),
      clicks: number(get("阅读/点击", "clicks")),
      likes: number(get("点赞", "likes")),
      saves: number(get("收藏", "saves")),
      comments: number(get("评论", "comments")),
      shares: number(get("分享", "shares")),
      leads: number(get("新增私信/线索", "leads")),
      orders: number(get("成交单数", "orders")),
      gmv: number(get("GMV", "gmv")),
      url: get("笔记链接", "url"),
      noteTitle: get("笔记标题", "noteTitle"),
      notes: get("备注", "Notes", "notes"),
    };
  }

  function bindEvents() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchView(tab.dataset.view));
    });
    $$("[data-view-jump]").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.viewJump));
    });
    $("#sync-cloud")?.addEventListener("click", async () => {
      $("#save-status").textContent = "正在读取云端数据...";
      const ok = await loadServerState({ force: true });
      toast(ok ? "云端数据已刷新" : "云端暂时连接不上");
    });
    $("#followup-summary")?.addEventListener("click", (event) => {
      const targetId = event.target.closest("[data-jump-target]")?.dataset.jumpTarget;
      if (!targetId) return;
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $$("[data-open='placement-dialog']").forEach((button) => {
      button.addEventListener("click", () => openForm());
    });
    $$("[data-close='placement-dialog']").forEach((button) => {
      button.addEventListener("click", () => $("#placement-dialog").close());
    });
    $$("[data-close='creator-dialog']").forEach((button) => {
      button.addEventListener("click", () => $("#creator-dialog").close());
    });
    $$("[data-close='brief-dialog']").forEach((button) => {
      button.addEventListener("click", () => $("#brief-dialog").close());
    });
    $$("[data-close='outreach-dialog']").forEach((button) => {
      button.addEventListener("click", () => $("#outreach-dialog").close());
    });
    $$("[data-close='wechat-dialog']").forEach((button) => {
      button.addEventListener("click", () => $("#wechat-dialog").close());
    });
    $("#placement-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = formToPlacement(event.currentTarget);
      const index = placements.findIndex((item) => item.id === next.id);
      if (index >= 0) placements[index] = next;
      else placements.unshift(next);
      savePlacements();
      syncCreatorsFromPlacements();
      $("#placement-dialog").close();
      renderAll();
      toast("投放记录已保存，正在同步云端");
      syncServerInBackground();
    });
    $("[data-delete]").addEventListener("click", async () => {
      const id = $("#placement-form").elements.id.value;
      placements = placements.filter((item) => item.id !== id);
      savePlacements();
      syncCreatorsFromPlacements();
      await flushServerSave();
      $("#placement-dialog").close();
      renderAll();
      toast("投放记录已删除");
    });
    $("#placement-form").addEventListener("click", (event) => {
      const placementId = event.target.closest("[data-duplicate-placement]")?.dataset.duplicatePlacement;
      if (!placementId) return;
      const record = placements.find((item) => item.id === placementId);
      if (record) openForm(record);
    });
    $("#open-placement-brief").addEventListener("click", openPlacementFormBrief);
    $("#download-placement-brief-image").addEventListener("click", downloadPlacementFormBriefImage);
    $("#placement-table").addEventListener("click", async (event) => {
      const editId = event.target.closest("[data-edit]")?.dataset.edit;
      const removeId = event.target.closest("[data-remove]")?.dataset.remove;
      if (editId) openForm(placements.find((item) => item.id === editId));
      if (removeId) {
        placements = placements.filter((item) => item.id !== removeId);
        savePlacements();
        syncCreatorsFromPlacements();
        await flushServerSave();
        renderAll();
        toast("投放记录已删除");
      }
    });
    $("#followup-list").addEventListener("click", (event) => {
      const editId = event.target.closest("[data-edit]")?.dataset.edit;
      if (editId) openForm(placements.find((item) => item.id === editId));
    });
    $("#followup-list").addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-review-form]");
      const shipmentForm = event.target.closest("[data-shipment-form]");
      if (!form && !shipmentForm) return;
      event.preventDefault();
      if (form) await savePerformanceReview(form);
      if (shipmentForm) await saveSampleShipment(shipmentForm);
    });
    $("#overview-period").addEventListener("change", (event) => {
      overviewPeriod = event.target.value;
      ledgerPeriod = overviewPeriod;
      renderAll();
    });
    $("#ledger-period").addEventListener("change", (event) => {
      ledgerPeriod = event.target.value;
      if (ledgerPeriod !== "unpublished") overviewPeriod = ledgerPeriod;
      renderAll();
    });
    $("#budget-panel").addEventListener("change", (event) => {
      if (event.target.id !== "monthly-budget-input" || !/^\d{4}-\d{2}$/.test(overviewPeriod)) return;
      monthlyBudgets[overviewPeriod] = number(event.target.value);
      saveMonthlyBudgets();
      renderBudgetPanel();
    });
    ["search-input", "status-filter", "content-filter", "result-filter", "data-entry-filter", "metric-sort"].forEach((id) => {
      $(`#${id}`).addEventListener("input", renderTable);
    });
    ["creator-search", "creator-type-filter", "creator-tier-filter", "creator-outreach-filter", "creator-added-filter", "creator-contact-filter", "creator-sort"].forEach((id) => {
      $(`#${id}`).addEventListener("input", renderCreators);
    });
    $("#product-board").addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const chip = event.target.closest("[data-product]");
      if (!chip) return;
      selectedProduct = chip.dataset.product;
      renderAll();
    });
    $("#placement-form [name='product']").addEventListener("focus", () => {
      setProductPickerOpen(true);
    });
    $("#placement-form [name='product']").addEventListener("change", (event) => {
      const exactProducts = productsFromProductText(event.target.value);
      if (exactProducts.length) applyWholesaleProductsToForm(exactProducts);
      else {
        updatePlacementProductCostDisplay();
        renderDuplicateCooperationWarning();
      }
    });
    $("#placement-form [name='product']").addEventListener("input", renderDuplicateCooperationWarning);
    $("#placement-form [name='sampleQuantity']").addEventListener("input", () => {
      updatePlacementProductCostDisplay();
      renderDuplicateCooperationWarning();
    });
    $("#placement-form [name='sampleTrackingNumber']").addEventListener("input", (event) => {
      if (!String(event.target.value || "").trim()) return;
      const form = $("#placement-form");
      if (!["已签收", "无需寄样"].includes(form.elements.sampleStatus.value)) form.elements.sampleStatus.value = "已寄样";
      if (!["已签收", "脚本已确认", "等待发布", "已发布"].includes(form.elements.status.value)) form.elements.status.value = "已寄样";
    });
    $("#product-picker-search").addEventListener("input", renderProductPickerOptions);
    $("#product-picker-toggle").addEventListener("click", () => {
      const menu = $("#product-picker-menu");
      setProductPickerOpen(menu.hidden);
    });
    $("#product-picker-menu").addEventListener("click", (event) => {
      const option = event.target.closest("[data-product-option]");
      if (!option) return;
      toggleProductInForm(option.dataset.productOption);
      setProductPickerOpen(true);
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".product-picker")) setProductPickerOpen(false);
    });
    ["input", "change"].forEach((eventName) => {
      $("#placement-form [name='creator']").addEventListener(eventName, (event) => {
        applyCreatorToPlacementForm(event.target.value);
        renderDuplicateCooperationWarning();
      });
    });
    $("#add-creator").addEventListener("click", () => openCreatorForm());
    $("#bulk-outreach").addEventListener("click", () => {
      const selectedRows = creators.filter((item) => selectedCreatorIds.has(item.id));
      const rows = selectedRows.length ? selectedRows : filteredCreators().filter(canOutreachTarget);
      openCreatorOutreachDialog(rows);
    });
    $("#bulk-wechat").addEventListener("click", () => {
      const selectedRows = creators.filter((item) => selectedCreatorIds.has(item.id));
      const rows = selectedRows.length ? selectedRows : filteredCreators().filter(canWechatQueueCreator);
      openWechatQueueDialog(rows);
    });
    $("#select-all-outreach").addEventListener("change", (event) => {
      filteredCreators().filter(canSelectCreator).forEach((item) => {
        if (event.target.checked) selectedCreatorIds.add(item.id);
        else selectedCreatorIds.delete(item.id);
      });
      renderCreators();
    });
    $("#copy-wechat-list").addEventListener("click", copyWechatQueue);
    ["outreach-added-filter", "outreach-email-filter", "outreach-status-filter"].forEach((id) => {
      $(`#${id}`)?.addEventListener("input", renderOutreachDialog);
    });
    $("#wechat-preview").addEventListener("click", async (event) => {
      const id = event.target.closest("[data-copy-wechat]")?.dataset.copyWechat;
      if (!id) return;
      const creator = creators.find((item) => item.id === id);
      if (creator) await copyText(creatorWechat(creator), "微信号已复制");
    });
    $("#creator-table").addEventListener("click", (event) => {
      const outreachId = event.target.closest("[data-creator-outreach]")?.dataset.creatorOutreach;
      if (outreachId) {
        const creator = creators.find((item) => item.id === outreachId);
        openCreatorOutreachDialog(creator ? [creator] : []);
        return;
      }
      const id = event.target.closest("[data-edit-creator]")?.dataset.editCreator;
      if (!id) return;
      const creator = creators.find((item) => item.id === id);
      openCreatorForm(creator);
    });
    $("#creator-table").addEventListener("change", (event) => {
      const id = event.target.closest("[data-select-creator]")?.dataset.selectCreator;
      if (!id) return;
      if (event.target.checked) selectedCreatorIds.add(id);
      else selectedCreatorIds.delete(id);
      renderCreators();
    });
    $("#classification-workbench").addEventListener("click", async (event) => {
      if (event.target.closest("[data-classification-save]")) {
        await saveClassificationCreator($("#classification-form"));
        return;
      }
      const selectId = event.target.closest("[data-classification-select]")?.dataset.classificationSelect;
      if (selectId) {
        classificationCreatorId = selectId;
        renderClassificationWorkbench();
        return;
      }
      if (event.target.closest("[data-classification-skip]")) {
        const pending = pendingClassificationCreators();
        const currentIndex = pending.findIndex((item) => item.id === classificationCreatorId);
        classificationCreatorId = pending[(currentIndex + 1) % pending.length]?.id || "";
        renderClassificationWorkbench();
        return;
      }
      if (event.target.closest("[data-copy-classification-name]")) {
        const current = creators.find((item) => item.id === classificationCreatorId);
        if (!current) return;
        await navigator.clipboard.writeText(current.name);
        toast("达人名称已复制");
      }
    });
    $("#classification-workbench").addEventListener("input", (event) => {
      if (event.target.name !== "fansText") return;
      const preview = $("#classification-tier-preview");
      if (preview) preview.textContent = creatorTierByFans(fanCountFromText(event.target.value));
    });
    $("#classification-workbench").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (event.target.id === "classification-form") await saveClassificationCreator(event.target);
    });
    $("#creator-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = formToCreator(event.currentTarget);
      const index = creators.findIndex((item) => item.id === next.id);
      if (index >= 0) creators[index] = next;
      else creators.push(next);
      if (next.creatorType && !creatorTypeOptions().includes(next.creatorType)) {
        customCreatorTypes.push(next.creatorType);
        saveCustomCreatorTypes();
      }
      saveCreators();
      $("#creator-dialog").close();
      hydrateControls();
      renderCreators();
      toast("达人资料已保存，正在同步云端");
      syncServerInBackground();
    });
    $("#blacklist-list").addEventListener("click", async (event) => {
      const id = event.target.closest("[data-clear-blacklist]")?.dataset.clearBlacklist;
      if (!id) return;
      const creator = creators.find((item) => item.id === id);
      if (!creator) return;
      creator.isBlacklisted = false;
      creator.blacklistReason = "";
      saveCreators();
      await flushServerSave();
      renderCreators();
      toast("已移出黑名单");
    });
    $("#add-creator-type").addEventListener("click", async () => {
      const input = $("#new-creator-type");
      const value = input.value.trim();
      if (!value) return;
      if (!creatorTypeOptions().includes(value)) {
        customCreatorTypes.push(value);
        saveCustomCreatorTypes();
        await flushServerSave();
      }
      input.value = "";
      hydrateControls();
      renderCreators();
      toast("达人类型已新增");
    });
    $("#resync-creators").addEventListener("click", async () => {
      syncCreatorsFromPlacements();
      await flushServerSave();
      renderAll();
      toast("已根据当前真实台账同步合作记录");
    });
    $("#download-template").addEventListener("click", () => {
      downloadText(`xhs-media-template-${today()}.csv`, buildCsvTemplate(), "text/csv;charset=utf-8");
    });
    $("#export-data").addEventListener("click", () => {
      downloadText(`xhs-media-${today()}.json`, JSON.stringify({ placements, creators, customCreatorTypes, monthlyBudgets }, null, 2), "application/json");
    });
    $("#import-data").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        placements = Array.isArray(data) ? data : data.placements;
        if (!Array.isArray(placements)) throw new Error("invalid data");
        if (Array.isArray(data.creators)) creators = data.creators.map(normalizeCreator);
        if (Array.isArray(data.customCreatorTypes)) customCreatorTypes = data.customCreatorTypes;
        if (data.monthlyBudgets && typeof data.monthlyBudgets === "object" && !Array.isArray(data.monthlyBudgets)) monthlyBudgets = data.monthlyBudgets;
        savePlacements();
        saveCreators();
        saveCustomCreatorTypes();
        saveMonthlyBudgets();
        syncCreatorsFromPlacements();
        await flushServerSave();
        renderAll();
        toast("数据已导入");
      } catch {
        toast("导入失败，请检查文件");
      } finally {
        event.target.value = "";
      }
    });
    $("#import-csv").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const rows = parseCsv(await file.text());
        const headers = rows.shift()?.map((header) => header.trim()) || [];
        const imported = rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ""]))).map(rowToPlacement).filter((item) => item.creator && item.product);
        if (!imported.length) throw new Error("empty csv");
        placements = [...imported, ...placements];
        savePlacements();
        syncCreatorsFromPlacements();
        await flushServerSave();
        renderAll();
        toast(`已导入 ${imported.length} 条CSV记录`);
      } catch {
        toast("CSV导入失败，请检查模板");
      } finally {
        event.target.value = "";
      }
    });
    $("#copy-report").addEventListener("click", async () => {
      await copyText(buildReport(), "复盘简报已复制");
    });
    $("#copy-followups").addEventListener("click", async () => {
      await copyText(buildFollowupReport(), "跟进清单已复制");
    });
    $("#copy-brief").addEventListener("click", async () => {
      const item = activeBriefItem();
      if (!item) return;
      await copyText(cooperationBriefText(item), "合作要求已复制");
    });
    $("#download-brief-image").addEventListener("click", () => {
      const item = activeBriefItem();
      if (!item) return;
      downloadCooperationBriefImage(item);
    });
    $("#copy-outreach-email").addEventListener("click", async () => {
      await copyOutreachDrafts();
    });
    $("#open-mailto").addEventListener("click", () => {
      openCreatorMailDrafts();
    });
  }

  function switchView(name) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}-view`));
  }

  function sendPendingStateOnUnload() {
    if (!hasPendingLocalSync() || !hasUsefulXhsState({ creators, placements })) return;
    if (!hasCurrentSessionChanges) return;
    clearTimeout(remoteSaveTimer);
    try {
      fetch(API_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(xhsStatePayload()),
        keepalive: true,
      });
    } catch {
      // The local pending-sync flag remains, so the next open will retry.
    }
  }

  hydrateControls();
  bindEvents();
  window.addEventListener("storage", (event) => {
    if ([CREATORS_STORAGE_KEY, ...MIRROR_CREATORS_STORAGE_KEYS].includes(event.key)) {
      creators = loadCreators();
      hydrateControls();
      renderCreators();
    }
    if (Object.values(WHOLESALE_KEYS).includes(event.key)) loadWholesaleProducts();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sendPendingStateOnUnload();
    else {
      loadWholesaleProducts();
      loadServerState({ force: true, silent: true });
      scheduleServerRefresh(12000);
    }
  });
  window.addEventListener("focus", () => loadServerState({ force: true, silent: true }));
  window.addEventListener("pagehide", sendPendingStateOnUnload);
  window.addEventListener("beforeunload", (event) => {
    if (!hasPendingLocalSync()) return;
    sendPendingStateOnUnload();
    event.preventDefault();
    event.returnValue = "";
  });
  syncCreatorsFromPlacements({ markDirty: false, remote: false });
  renderAll();
  loadServerState({ force: true }).then(() => {
    if (!apiOnline) loadRecoveredSnapshot().finally(loadMorningRecovery);
  }).finally(() => scheduleServerRefresh(12000));
  loadWholesaleProducts();
})();
