// ============================================================
// 数据库1抓取脚本：只抓取云端自建API的原始数据
// 保存到 db1_cloud_api/，不被其他API数据污染
// 核心原则：消耗一次配额就把云端API翻个底朝天，所有数据完整保存
// ============================================================

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  selfApi: {
    base: 'http://47.99.155.27:8321',
    key: process.env.SELF_API_KEY || 'fmjwx8H7vbA6j8RiPD6sn9UOsrQSvPJ3d478dn4xwN8',
    dailyQuota: 200,
    budget: 150,
    used: 0
  },
  // 数据库1：云端API原始数据
  db1Dir: path.join(__dirname, '..', '..', 'data', 'db1_cloud_api'),
  maxMatchFullPerRun: 15,
  preMatchDetailHours: 2,
  postMatchDetailHours: 2,
  requestDelayMs: 600
};

// 工具函数
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.log(`    HTTP ${res.status}: ${url.substring(0, 80)}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`    请求失败: ${e.message}`);
    return null;
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadJson(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {}
  return defaultValue;
}

function getDates() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { today, tomorrow };
}

function parseMatchTime(dateStr, timeStr) {
  try {
    const [day, month, year] = (dateStr || '').split('/').map(Number);
    const [hour, minute] = (timeStr || '00:00').split(':').map(Number);
    if (!day || !month || !year) return null;
    return new Date(year, month - 1, day, hour, minute);
  } catch (e) {
    return null;
  }
}

function isMatchFinished(match) {
  const status = (match.status || match.status_zh || '').toLowerCase();
  return status.includes('完') || status.includes('结束') || status.includes('ft') || status.includes('full');
}

function shouldFetchDetail(match) {
  const matchTime = parseMatchTime(match.date, match.time);
  if (!matchTime) return false;
  const hoursDiff = (matchTime - new Date()) / (1000 * 60 * 60);
  return (hoursDiff >= -CONFIG.postMatchDetailHours && hoursDiff <= CONFIG.preMatchDetailHours);
}

// 配额管理
const QuotaManager = {
  load() {
    const quotaPath = path.join(CONFIG.db1Dir, '..', 'quota_usage.json');
    const saved = loadJson(quotaPath, null);
    const today = new Date().toISOString().slice(0, 10);
    if (saved && saved.date === today && saved.selfApi !== undefined) {
      CONFIG.selfApi.used = saved.selfApi;
    }
  },
  save() {
    const quotaPath = path.join(CONFIG.db1Dir, '..', 'quota_usage.json');
    const saved = loadJson(quotaPath, { date: '', selfApi: 0, apiFootball: 0, bigBalls: 0 });
    saved.date = new Date().toISOString().slice(0, 10);
    saved.selfApi = CONFIG.selfApi.used;
    saveJson(quotaPath, saved);
  },
  canUse() {
    return CONFIG.selfApi.used < CONFIG.selfApi.budget;
  },
  consume(count = 1) {
    CONFIG.selfApi.used += count;
    this.save();
  }
};

// ============================================================
// 第一步：抓取比赛列表（1次配额）
// ============================================================
async function fetchMatchList() {
  console.log('\n=== [数据库1] 第一步：抓取云端API比赛列表 ===');
  
  if (!QuotaManager.canUse()) {
    console.log('  云端API预算已用完，跳过');
    return { today: [], tomorrow: [] };
  }
  
  const data = await fetchJson(
    `${CONFIG.selfApi.base}/api/today`,
    { 'X-API-Token': CONFIG.selfApi.key }
  );
  
  if (!data || !data.matches) {
    console.log('  抓取失败，使用已有数据');
    return { today: [], tomorrow: [] };
  }
  
  QuotaManager.consume(1);
  console.log(`  ✓ 成功抓取 ${data.matches.length} 场比赛（消耗1次配额）`);
  
  const { today, tomorrow } = getDates();
  const todayMatches = [];
  const tomorrowMatches = [];
  
  for (const match of data.matches) {
    const matchDate = match.date ? match.date.split('/').reverse().join('-') : '';
    if (matchDate === today) todayMatches.push(match);
    else if (matchDate === tomorrow) tomorrowMatches.push(match);
  }
  
  console.log(`  今天: ${todayMatches.length} 场, 明天: ${tomorrowMatches.length} 场`);
  
  // 保存到数据库1（原始数据，完整保存所有字段）
  const todayData = {
    updateTime: new Date().toISOString(),
    source: 'self_api_raw',
    total: todayMatches.length,
    withOdds: todayMatches.filter(m => m.odds_available).length,
    odds_coverage: data.odds_coverage || null,
    matches: todayMatches
  };
  
  const tomorrowData = {
    updateTime: new Date().toISOString(),
    source: 'self_api_raw',
    total: tomorrowMatches.length,
    withOdds: tomorrowMatches.filter(m => m.odds_available).length,
    matches: tomorrowMatches
  };
  
  saveJson(path.join(CONFIG.db1Dir, 'current', 'today.json'), todayData);
  saveJson(path.join(CONFIG.db1Dir, 'current', 'tomorrow.json'), tomorrowData);
  
  return { today: todayMatches, tomorrow: tomorrowMatches };
}

// ============================================================
// 第二步：抓取比赛详情（每场1次配额，翻个底朝天）
// ============================================================
async function fetchMatchDetails(allMatches) {
  console.log('\n=== [数据库1] 第二步：抓取云端API比赛详情（翻个底朝天）===');
  
  const needDetail = allMatches.filter(m => shouldFetchDetail(m));
  console.log(`  需要抓取详情的比赛: ${needDetail.length} 场（赛前${CONFIG.preMatchDetailHours}h/赛后${CONFIG.postMatchDetailHours}h）`);
  
  const toFetch = needDetail.slice(0, CONFIG.maxMatchFullPerRun);
  console.log(`  本次计划抓取: ${toFetch.length} 场（限制每次最多${CONFIG.maxMatchFullPerRun}场）`);
  
  const detailCachePath = path.join(CONFIG.db1Dir, 'current', 'match_details.json');
  const detailCache = loadJson(detailCachePath, {});
  
  let fetchedCount = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const match = toFetch[i];
    const eventId = match.event_id;
    
    if (!QuotaManager.canUse()) {
      console.log('  云端API预算已用完，停止');
      break;
    }
    
    // 已有缓存且1小时内，跳过
    if (detailCache[eventId] && detailCache[eventId]._fetchTime &&
        (Date.now() - new Date(detailCache[eventId]._fetchTime).getTime() < 60 * 60 * 1000)) {
      console.log(`  [${i+1}/${toFetch.length}] ${match.home_team_zh} vs ${match.away_team_zh} - 已有缓存，跳过`);
      continue;
    }
    
    console.log(`  [${i+1}/${toFetch.length}] ${match.home_team_zh} vs ${match.away_team_zh} - 抓取详情...`);
    
    const detail = await fetchJson(
      `${CONFIG.selfApi.base}/match_full/${eventId}`,
      { 'X-API-Token': CONFIG.selfApi.key }
    );
    
    if (detail) {
      // 全方位保存所有字段，绝不丢弃！
      detailCache[eventId] = {
        ...detail,
        _fetchTime: new Date().toISOString(),
        _eventId: eventId,
        _source: 'self_api_raw'
      };
      QuotaManager.consume(1);
      fetchedCount++;
      
      const fields = Object.keys(detail).length;
      const bookmakers = detail.odds_by_bookmaker ? Object.keys(detail.odds_by_bookmaker).length : 0;
      console.log(`    ✓ 成功！${fields}个字段, ${bookmakers}家博彩, 阵容=${detail.lineups?'有':'无'}, 伤停=${detail.injuries?'有':'无'}, 统计=${detail.statistics?'有':'无'}, 历史xG=${detail.historical_xg?'有':'无'}`);
    } else {
      console.log(`    ✗ 失败`);
    }
    
    if (i < toFetch.length - 1) await sleep(CONFIG.requestDelayMs);
  }
  
  saveJson(detailCachePath, detailCache);
  console.log(`  本次新抓取 ${fetchedCount} 场详情，缓存共 ${Object.keys(detailCache).length} 场`);
  
  return detailCache;
}

// ============================================================
// 第三步：保存已结束比赛的复盘原始数据
// ============================================================
async function saveFinishedMatches(todayMatches, detailCache) {
  console.log('\n=== [数据库1] 第三步：保存已结束比赛原始数据 ===');
  
  const { today } = getDates();
  const reviewPath = path.join(CONFIG.db1Dir, 'review', `${today}.json`);
  const reviewData = loadJson(reviewPath, { date: today, source: 'self_api_raw', matches: [] });
  const savedIds = new Set(reviewData.matches.map(m => m.event_id));
  
  let newSaved = 0;
  for (const match of todayMatches) {
    if (!isMatchFinished(match)) continue;
    if (savedIds.has(match.event_id)) continue;
    
    const eventId = match.event_id;
    const detail = detailCache[eventId] || {};
    
    console.log(`  保存: ${match.home_team_zh} ${match.home_score} - ${match.away_score} ${match.away_team_zh}`);
    
    reviewData.matches.push({
      event_id: eventId,
      league: match.league_zh || match.league_name,
      home_team: match.home_team_zh,
      away_team: match.away_team_zh,
      home_score: match.home_score,
      away_score: match.away_score,
      match_time: match.date + ' ' + match.time,
      save_time: new Date().toISOString(),
      odds: match.odds || null,
      odds_by_bookmaker: detail.odds_by_bookmaker || null,
      lineups: detail.lineups || null,
      injuries: detail.injuries || null,
      statistics: detail.statistics || null,
      events: detail.events || null,
      historical_xg: detail.historical_xg || null,
      historical_odds: detail.historical_odds || null
    });
    newSaved++;
  }
  
  if (newSaved > 0) {
    saveJson(reviewPath, reviewData);
  }
  console.log(`  本次新增保存 ${newSaved} 场，今日共 ${reviewData.matches.length} 场`);
}

// ============================================================
// 第四步：自动清理数据库1过期数据
// ============================================================
async function cleanupDb1() {
  console.log('\n=== [数据库1] 第四步：自动清理过期数据 ===');
  
  const now = new Date();
  
  // 清理超过2天的比赛详情缓存
  const detailCachePath = path.join(CONFIG.db1Dir, 'current', 'match_details.json');
  if (fs.existsSync(detailCachePath)) {
    const detailCache = loadJson(detailCachePath, {});
    let deleted = 0;
    for (const eventId in detailCache) {
      const detail = detailCache[eventId];
      if (detail._fetchTime) {
        const fetchTime = new Date(detail._fetchTime);
        const daysDiff = (now - fetchTime) / (1000 * 60 * 60 * 24);
        if (daysDiff > 2) {
          delete detailCache[eventId];
          deleted++;
        }
      }
    }
    if (deleted > 0) saveJson(detailCachePath, detailCache);
    console.log(`  清理过期比赛详情: 删除 ${deleted} 场（保留最近2天）`);
  }
  
  // 清理超过7天的复盘原始数据
  const reviewDir = path.join(CONFIG.db1Dir, 'review');
  if (fs.existsSync(reviewDir)) {
    const files = fs.readdirSync(reviewDir);
    let deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const dateStr = file.replace('.json', '');
      const fileDate = new Date(dateStr);
      const daysDiff = (now - fileDate) / (1000 * 60 * 60 * 24);
      if (daysDiff > 7) {
        fs.unlinkSync(path.join(reviewDir, file));
        deleted++;
      }
    }
    console.log(`  清理过期复盘原始数据: 删除 ${deleted} 个文件（保留7天）`);
  }
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  console.log('================================================================');
  console.log('  数据库1抓取：云端自建API原始数据');
  console.log('  开始时间:', new Date().toLocaleString('zh-CN'));
  console.log('================================================================');
  
  try {
    QuotaManager.load();
    console.log(`\n当前云端API已用: ${CONFIG.selfApi.used}/${CONFIG.selfApi.budget}（预算）`);
    
    // 第一步：抓取比赛列表
    const { today, tomorrow } = await fetchMatchList();
    const allMatches = [...today, ...tomorrow];
    
    // 第二步：抓取比赛详情（翻个底朝天）
    const detailCache = await fetchMatchDetails(allMatches);
    
    // 第三步：保存已结束比赛原始数据
    await saveFinishedMatches(today, detailCache);
    
    // 第四步：自动清理
    await cleanupDb1();
    
    QuotaManager.save();
    
    console.log('\n================================================================');
    console.log('  数据库1抓取完成！');
    console.log('  结束时间:', new Date().toLocaleString('zh-CN'));
    console.log('  最终云端API已用:', CONFIG.selfApi.used, '/', CONFIG.selfApi.budget);
    console.log('================================================================');
    
  } catch (e) {
    console.error('\n❌ 抓取出错:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
