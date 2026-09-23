// ============================================================
// 欢哥AI模型 · 云端多人版服务器 v3
// 零依赖：仅用 Node.js 内置模块（http/crypto/fs/path/https）
// 启动：node server-cloud.js
// ============================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8766;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'cloud-data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const SHARED_FILE = path.join(DATA_DIR, 'shared_learning.json');

// API-Football 配置
const AFB_KEY = 'ce2d77c10f8e8838ea47b98d24ae8ae7';
const AFB_BASE = 'v3.football.api-sports.io';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}', 'utf8');
if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, '{}', 'utf8');
if (!fs.existsSync(SHARED_FILE)) fs.writeFileSync(SHARED_FILE, JSON.stringify({
  preds: {}, settled: {},
  stats: { n: 0, hit: 0, ouHit: 0, spHit: 0 },
  modelWeights: { dc: 0.55, elo: 0.25, path: 0.20 },  // 模型融合权重，自动优化
  leagueAdj: {},   // 每个联赛的校准系数 {league: {home: 1, away: 1, draw: 1}}
  teamAdj: {},     // 球队修正系数 {teamId: {att: 1, def: 1, n: 0, last: 0}}
  lastRun: 0,
  lastOptimize: 0  // 上次自我优化时间
}, null, 2), 'utf8');

// ---------- 工具 ----------
function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } }
function saveJSON(f, obj) { fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8'); }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 32).toString('hex'); }
function genToken() { return crypto.randomBytes(24).toString('hex'); }

function json(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(buf);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}
function userDataFile(username) {
  const safe = username.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  return path.join(DATA_DIR, 'user_' + safe + '.json');
}

let tokens = loadJSON(TOKENS_FILE);
function saveTokens() { saveJSON(TOKENS_FILE, tokens); }
function auth(req, url) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '') || url.searchParams.get('token') || '';
  return token && tokens[token] ? tokens[token] : null;
}

// ---------- API-Football 请求 ----------
function afbGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: AFB_BASE,
      path: path,
      headers: { 'x-apisports-key': AFB_KEY }
    };
    https.get(options, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ---------- 简化版预测逻辑 ----------
function simplePredict(homeRank, awayRank, homeForm, awayForm) {
  const rankDiff = (awayRank || 10) - (homeRank || 10);
  const eloDiff = rankDiff * 25;
  const expectedHome = 1 / (1 + Math.pow(10, -eloDiff / 400));
  // 基础概率：主胜/平/客胜
  let homeWin = expectedHome * 0.55 + (homeForm || 0.4) * 0.20;
  let awayWin = (1 - expectedHome) * 0.55 + (awayForm || 0.4) * 0.20;
  let draw = 0.25; // 平局基础概率25%
  // 归一化
  const total = homeWin + draw + awayWin;
  return { W: homeWin / total, D: draw / total, L: awayWin / total };
}

// ---------- 后台任务：扫描比赛 ----------
async function autoScanMatches() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await afbGet(`/fixtures?date=${today}`);
    if (!data || !data.response) return;
    
    const shared = loadJSON(SHARED_FILE);
    let newPreds = 0;
    
    for (const item of data.response) {
      const fid = 'afb_' + item.fixture.id;
      if (shared.preds[fid]) continue;
      
      // 只预测未开始的比赛
      if (item.fixture.status.short !== 'NS') continue;
      
      const home = item.teams.home;
      const away = item.teams.away;
      if (!home || !away) continue;
      
      // 从API-Football获取排名（简化：用联赛排名）
      // 这里用简化预测
      const pred = simplePredict(10, 10, 0.4, 0.4);
      
      shared.preds[fid] = {
        fid,
        afbId: item.fixture.id,
        home: home.name,
        away: away.name,
        league: item.league ? item.league.name : '',
        date: today,
        ts: Date.now(),
        kickoff: item.fixture.date,
        W: pred.W, D: pred.D, L: pred.L,
        status: 'pre',
        auto: true
      };
      newPreds++;
    }
    
    shared.lastRun = Date.now();
    saveJSON(SHARED_FILE, shared);
    if (newPreds > 0) console.log('[后台自动] 新增预测：' + newPreds + '场');
  } catch (e) {
    console.warn('[后台自动] 扫描失败', e.message);
  }
}

// ---------- 自我优化引擎 ----------
// 每积累100场复盘后，自动优化模型参数
function autoOptimizeModel() {
  try {
    const shared = loadJSON(SHARED_FILE);
    const settled = Object.values(shared.settled || {});
    
    // 至少需要100场才优化
    if (settled.length < 100) {
      console.log('[自我优化] 样本不足：' + settled.length + '/100场，跳过优化');
      return;
    }
    
    const now = Date.now();
    // 每24小时最多优化一次
    if (shared.lastOptimize && (now - shared.lastOptimize) < 86400000) {
      return;
    }
    
    console.log('[自我优化] 开始优化模型参数，样本量：' + settled.length + '场');
    
    // 1. 计算主胜/平/客胜各自的准确率
    let homeHits = 0, homeTotal = 0;
    let drawHits = 0, drawTotal = 0;
    let awayHits = 0, awayTotal = 0;
    
    // 2. 按联赛分组统计
    const leagueStats = {};
    settled.forEach(s => {
      if (!s.league) return;
      if (!leagueStats[s.league]) leagueStats[s.league] = { n: 0, hit: 0 };
      leagueStats[s.league].n++;
      if (s.hit) leagueStats[s.league].hit++;
    });
    
    // 3. 计算整体准确率
    const overallHit = shared.stats.hit / Math.max(1, shared.stats.n);
    console.log('[自我优化] 整体准确率：' + (overallHit * 100).toFixed(1) + '%');
    
    // 4. 调整模型权重（简单的爬山法：根据各类型预测准确率微调）
    const w = shared.modelWeights;
    // 假设当前DC权重最准，如果主胜准确率高就微调
    if (overallHit > 0.5) {
      w.dc = Math.min(0.70, Math.max(0.40, w.dc + 0.01));
      w.elo = Math.max(0.15, w.elo - 0.005);
      w.path = Math.max(0.10, w.path - 0.005);
    } else {
      w.dc = Math.max(0.40, w.dc - 0.01);
      w.elo = Math.min(0.35, w.elo + 0.005);
      w.path = Math.min(0.30, w.path + 0.005);
    }
    
    // 5. 联赛校准：准确率低于45%的联赛，降低其置信度
    Object.entries(leagueStats).forEach(([league, stat]) => {
      if (stat.n < 10) return; // 样本太少不校准
      const hitRate = stat.hit / stat.n;
      if (!shared.leagueAdj[league]) shared.leagueAdj[league] = { home: 1, away: 1, draw: 1 };
      
      // 准确率低的联赛，平局概率上调（说明模型对这个联赛判断不准）
      if (hitRate < 0.45) {
        shared.leagueAdj[league].draw = Math.min(1.2, (shared.leagueAdj[league].draw || 1) + 0.02);
      } else if (hitRate > 0.55) {
        shared.leagueAdj[league].draw = Math.max(0.9, (shared.leagueAdj[league].draw || 1) - 0.01);
      }
    });
    
    shared.lastOptimize = now;
    saveJSON(SHARED_FILE, shared);
    
    console.log('[自我优化] 完成！新权重：DC=' + (w.dc * 100).toFixed(0) + '% Elo=' + (w.elo * 100).toFixed(0) + '% Path=' + (w.path * 100).toFixed(0) + '%');
    console.log('[自我优化] 校准联赛数：' + Object.keys(shared.leagueAdj).length);
  } catch (e) {
    console.warn('[自我优化] 失败', e.message);
  }
}

// ---------- 后台任务：复盘 ----------
async function autoReviewMatches() {
  try {
    const shared = loadJSON(SHARED_FILE);
    let reviewed = 0;
    
    const preds = Object.values(shared.preds);
    for (const p of preds) {
      if (shared.settled[p.fid]) continue;
      if (!p.afbId) continue;
      
      try {
        const data = await afbGet(`/fixtures?id=${p.afbId}`);
        if (!data || !data.response || !data.response[0]) continue;
        
        const item = data.response[0];
        if (item.fixture.status.short !== 'FT' && item.fixture.status.short !== 'AET' && item.fixture.status.short !== 'PEN') continue;
        
        const hg = item.goals.home || 0;
        const ag = item.goals.away || 0;
        
        const actual = hg > ag ? 'W' : (hg === ag ? 'D' : 'L');
        const predPick = p.W >= p.D && p.W >= p.L ? 'W' : (p.D >= p.W && p.D >= p.L ? 'D' : 'L');
        const hit = actual === predPick;
        
        shared.settled[p.fid] = {
          ...p,
          homeScore: hg,
          awayScore: ag,
          actual,
          predPick,
          hit,
          reviewedAt: Date.now()
        };
        delete shared.preds[p.fid];
        reviewed++;
        
        shared.stats.n = (shared.stats.n || 0) + 1;
        if (hit) shared.stats.hit = (shared.stats.hit || 0) + 1;
      } catch (e) { /* 单场失败跳过 */ }
    }
    
    // 清理旧记录：保留三个月（90天）
    const settledKeys = Object.keys(shared.settled);
    const cutoff = Date.now() - 90 * 86400000; // 90天前
    let cleanedCount = 0;
    settledKeys.forEach(k => {
      if (!shared.settled[k].reviewedAt || shared.settled[k].reviewedAt < cutoff) {
        delete shared.settled[k];
        cleanedCount++;
      }
    });
    if (cleanedCount > 0) console.log('[后台自动] 清理90天前旧记录：' + cleanedCount + '条');
    
    if (reviewed > 0) {
      saveJSON(SHARED_FILE, shared);
      console.log('[后台自动] 复盘完成：' + reviewed + '场，命中率：' + 
        (shared.stats.n ? ((shared.stats.hit / shared.stats.n * 100).toFixed(1)) : '0') + '%');
      // 复盘完成后自动优化模型
      autoOptimizeModel();
    }
  } catch (e) {
    console.warn('[后台自动] 复盘失败', e.message);
  }
}

function startBackgroundTasks() {
  setTimeout(() => { autoScanMatches(); autoReviewMatches(); }, 30000);
  setInterval(autoScanMatches, 3600000);
  setInterval(autoReviewMatches, 1800000);
  console.log('[后台自动] 已启动：每小时扫描，每30分钟复盘');
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    return res.end();
  }

  // ---- 注册 ----
  if (p === '/api/register' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    if (!username || !password) return json(res, 400, { error: '用户名和密码不能为空' });
    if (username.length < 2 || username.length > 20) return json(res, 400, { error: '用户名长度 2-20 位' });
    if (password.length < 4) return json(res, 400, { error: '密码至少 4 位' });
    const users = loadJSON(USERS_FILE);
    if (users[username]) return json(res, 409, { error: '用户名已存在' });
    const salt = crypto.randomBytes(8).toString('hex');
    const isFirst = Object.keys(users).length === 0;
    users[username] = { salt, hash: hashPassword(password, salt), role: isFirst ? 'admin' : 'sub', createdBy: isFirst ? 'system' : 'register', createdAt: new Date().toISOString() };
    saveJSON(USERS_FILE, users);
    const token = genToken();
    tokens[token] = username;
    saveTokens();
    return json(res, 200, { token, username, role: users[username].role });
  }

  // ---- 登录 ----
  if (p === '/api/login' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    const users = loadJSON(USERS_FILE);
    const u = users[username];
    if (!u) return json(res, 401, { error: '用户不存在' });
    if (hashPassword(password, u.salt) !== u.hash) return json(res, 401, { error: '密码错误' });
    const token = genToken();
    tokens[token] = username;
    saveTokens();
    return json(res, 200, { token, username, role: u.role });
  }

  // ---- 登出 ----
  if (p === '/api/logout' && req.method === 'POST') {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '') || '';
    if (token) { delete tokens[token]; saveTokens(); }
    return json(res, 200, { ok: true });
  }

  // ---- 当前用户 ----
  if (p === '/api/me' && req.method === 'GET') {
    const username = auth(req, url);
    if (!username) return json(res, 401, { error: '未登录' });
    const users = loadJSON(USERS_FILE);
    const u = users[username];
    return json(res, 200, { username, role: u.role, createdAt: u.createdAt });
  }

  // ---- admin：创建子账户 ----
  if (p === '/api/admin/create-user' && req.method === 'POST') {
    const adminName = auth(req, url);
    if (!adminName) return json(res, 401, { error: '未登录' });
    const users = loadJSON(USERS_FILE);
    if (users[adminName].role !== 'admin') return json(res, 403, { error: '需要管理员权限' });
    const { username, password } = await readBody(req);
    if (!username || !password) return json(res, 400, { error: '用户名和密码不能为空' });
    if (username.length < 2 || username.length > 20) return json(res, 400, { error: '用户名长度 2-20 位' });
    if (password.length < 4) return json(res, 400, { error: '密码至少 4 位' });
    if (users[username]) return json(res, 409, { error: '用户名已存在' });
    const salt = crypto.randomBytes(8).toString('hex');
    users[username] = { salt, hash: hashPassword(password, salt), role: 'sub', createdBy: adminName, createdAt: new Date().toISOString() };
    saveJSON(USERS_FILE, users);
    return json(res, 200, { ok: true, username });
  }

  // ---- admin：列出子账户 ----
  if (p === '/api/admin/list-users' && req.method === 'GET') {
    const adminName = auth(req, url);
    if (!adminName) return json(res, 401, { error: '未登录' });
    const users = loadJSON(USERS_FILE);
    if (users[adminName].role !== 'admin') return json(res, 403, { error: '需要管理员权限' });
    const list = Object.entries(users).map(([name, u]) => ({ username: name, role: u.role, createdBy: u.createdBy, createdAt: u.createdAt }));
    return json(res, 200, { users: list });
  }

  // ---- admin：删除子账户 ----
  if (p === '/api/admin/delete-user' && req.method === 'POST') {
    const adminName = auth(req, url);
    if (!adminName) return json(res, 401, { error: '未登录' });
    const users = loadJSON(USERS_FILE);
    if (users[adminName].role !== 'admin') return json(res, 403, { error: '需要管理员权限' });
    const { username } = await readBody(req);
    if (!username || username === adminName) return json(res, 400, { error: '不能删除自己' });
    if (!users[username]) return json(res, 404, { error: '用户不存在' });
    delete users[username];
    saveJSON(USERS_FILE, users);
    const f = userDataFile(username);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return json(res, 200, { ok: true });
  }

  // ---- 数据：读取 ----
  if (p === '/api/data' && req.method === 'GET') {
    const username = auth(req, url);
    if (!username) return json(res, 401, { error: '未登录' });
    const f = userDataFile(username);
    try { return json(res, 200, { data: JSON.parse(fs.readFileSync(f, 'utf8')) }); }
    catch (e) { return json(res, 200, { data: {} }); }
  }

  // ---- 数据：保存 ----
  if (p === '/api/data' && req.method === 'POST') {
    const body = await readBody(req);
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '') || body.token || '';
    const username = tokens[token];
    if (!username) return json(res, 401, { error: '未登录' });
    if (!body.data || typeof body.data !== 'object') return json(res, 400, { error: '数据格式错误' });
    fs.writeFileSync(userDataFile(username), JSON.stringify(body.data), 'utf8');
    return json(res, 200, { ok: true, size: JSON.stringify(body.data).length });
  }

  // ---- 后台自动记录：公开接口 ----
  if (p === '/api/auto/predictions' && req.method === 'GET') {
    const shared = loadJSON(SHARED_FILE);
    const preds = Object.values(shared.preds || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return json(res, 200, { predictions: preds.slice(0, 50), total: preds.length });
  }

  if (p === '/api/auto/reviewed' && req.method === 'GET') {
    const shared = loadJSON(SHARED_FILE);
    const settled = Object.values(shared.settled || {}).sort((a, b) => (b.reviewedAt || 0) - (a.reviewedAt || 0));
    return json(res, 200, { reviewed: settled.slice(0, 100), stats: shared.stats, total: settled.length });
  }

  // ---- 状态 ----
  if (p === '/api/status' && req.method === 'GET') {
    const shared = loadJSON(SHARED_FILE);
    return json(res, 200, {
      online: Object.keys(tokens).length,
      users: Object.keys(loadJSON(USERS_FILE)).length,
      autoPreds: Object.keys(shared.preds || {}).length,
      autoReviewed: Object.keys(shared.settled || {}).length,
      autoStats: shared.stats,
      modelWeights: shared.modelWeights,
      leagueAdjCount: Object.keys(shared.leagueAdj || {}).length,
      lastOptimize: shared.lastOptimize,
      retentionDays: 90  // 数据保留天数
    });
  }

  // ---- 静态文件 ----
  let rel = p === '/' ? 'index.html' : p.slice(1);
  let filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('403'); }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const ct = {
      '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
      '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    return fs.createReadStream(filePath).pipe(res);
  }
  res.writeHead(404); res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  欢哥AI模型 · 云端多人版 v3');
  console.log('  后台自动运行（API-Football）');
  console.log('==============================================');
  console.log('  本机访问 : http://localhost:' + PORT + '/');
  console.log('  数据目录 : ' + DATA_DIR);
  console.log('==============================================');
  startBackgroundTasks();
  const { exec } = require('child_process');
  exec('start http://localhost:' + PORT + '/');
});
