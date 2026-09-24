// ============================================================
// 数据库2融合脚本：从数据库1提取 + 其他API融合完善
// 保存到 db2_master/，网页端只读这个数据库
// 核心原则：
// 1. 自动从数据库1提取云端API原始数据
// 2. 调用其他API（API-Football/Big Balls/ESPN等）补充缺失字段
// 3. 所有数据按规则融合完善，已有字段不覆盖，只补充缺失
// 4. 比赛分级、AI学习、复盘、权重调整都在这里进行
// ============================================================

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  // 其他API配置
  apis: {
    apiFootball: {
      base: 'https://v3.football.api-sports.io',
      key: process.env.API_FOOTBALL_KEY || 'ce2d77c10f8e8838ea47b98d24ae8ae7',
      dailyQuota: 100,
      budget: 60,
      used: 0
    },
    bigBalls: {
      base: 'https://api.bigballsdata.com',
      key: process.env.BIG_BALLS_KEY || 'bbs_live_00000O5LnABdj2TUAxSxRYpwqaLibzQJTBYG9E8wn0i1ZYKB',
      dailyQuota: 1000,
      budget: 100,
      used: 0
    },
    espn: {
      base: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
      key: null,
      dailyQuota: Infinity,
      budget: Infinity,
      used: 0
    }
  },
  
  // 目录
  db1Dir: path.join(__dirname, '..', '..', 'data', 'db1_cloud_api'),
  db2Dir: path.join(__dirname, '..', '..', 'data', 'db2_master'),
  quotaPath: path.join(__dirname, '..', '..', 'data', 'quota_usage.json'),
  
  // 控制
  maxApiFootballPerRun: 8,
  maxBigBallsPerRun: 5,
  preMatchHours: 2,
  postMatchHours: 2,
  requestDelayMs: 600,
  
  // 保留期
  reviewRetentionDays: 90,
  teamPlayerRetentionYears: 2
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

function shouldSupplement(match) {
  const matchTime = parseMatchTime(match.date, match.time);
  if (!matchTime) return false;
  const hoursDiff = (matchTime - new Date()) / (1000 * 60 * 60);
  return (hoursDiff >= -CONFIG.postMatchHours && hoursDiff <= CONFIG.preMatchHours);
}

// ============================================================
// 比赛分级（S/A/B/C级）
// ============================================================
function getMatchTier(match) {
  const league = (match.league_zh || match.league_name || '').toLowerCase();
  
  const sLeagues = ['英超', '西甲', '德甲', '意甲', '法甲', '欧冠', '欧联', '欧协联',
                    '世界杯', '欧洲杯', '美洲杯', '亚冠', '世俱杯', '英格兰足总杯',
                    '西班牙国王杯', '德国杯', '意大利杯', '法国杯', '联赛杯'];
  for (const l of sLeagues) if (league.includes(l)) return 'S';
  
  const aLeagues = ['英冠', '西乙', '德乙', '意乙', '法乙', '荷甲', '葡超', '比甲',
                    '苏超', '土超', '俄超', '美职联', '墨超', '巴甲', '阿甲', '解放者杯',
                    '金杯赛', '亚洲杯', '非洲杯', '中北美冠', '天皇杯', '国家队', '欧国联', '世预赛'];
  for (const l of aLeagues) if (league.includes(l)) return 'A';
  
  const bLeagues = ['英甲', '英乙', '日职', '日职乙', '韩k联', '韩k2', '中超', '中甲',
                    '沙特联', '卡塔尔联', '澳超', '南非超', '埃及超'];
  for (const l of bLeagues) if (league.includes(l)) return 'B';
  
  return 'C';
}

// ============================================================
// 配额管理
// ============================================================
const QuotaManager = {
  load() {
    const saved = loadJson(CONFIG.quotaPath, null);
    const today = new Date().toISOString().slice(0, 10);
    if (saved && saved.date === today) {
      for (const api in CONFIG.apis) {
        if (saved[api] !== undefined) CONFIG.apis[api].used = saved[api];
      }
    }
  },
  save() {
    const saved = loadJson(CONFIG.quotaPath, { date: '', selfApi: 0, apiFootball: 0, bigBalls: 0 });
    saved.date = new Date().toISOString().slice(0, 10);
    for (const api in CONFIG.apis) {
      saved[api] = CONFIG.apis[api].used;
    }
    saveJson(CONFIG.quotaPath, saved);
  },
  canUse(apiName) {
    const api = CONFIG.apis[apiName];
    if (!api) return false;
    if (api.dailyQuota === Infinity) return true;
    return api.used < api.budget;
  },
  consume(apiName, count = 1) {
    if (CONFIG.apis[apiName]) {
      CONFIG.apis[apiName].used += count;
      this.save();
    }
  }
};

// ============================================================
// 数据融合函数：区分实时字段和静态字段（根据足球API行业标准）
// 
// 【实时变化字段】比赛进行中不断变化，用最新值覆盖
//   例如：比分0:0→1:0就保留1:0，一直是0:0就保留0:0
// 
// 【数组合并字段】不断增加的事件列表，合并去重
//   例如：进球、红黄牌、换人轮换等事件只会越来越多
// 
// 【静态字段】开赛前确定，开赛后不变，已有不覆盖只补充缺失
//   例如：首发阵容、伤停、历史数据、队名、联赛名等
// ============================================================

// ========== 实时变化字段（用最新值覆盖）==========
// 参考：API-Football、Sportmonks、Sportradar等行业标准
const LIVE_FIELDS = new Set([
  // 比分相关
  'home_score', 'away_score', 'score', 'home_goals', 'away_goals',
  'ht_home', 'ht_away', 'half_time_score', 'ht_score',
  'ft_home', 'ft_away', 'full_time_score',
  'et_home', 'et_away', 'extra_time_score',
  'penalty_home', 'penalty_away', 'penalty_score',
  
  // 比赛时间/时钟
  'minute', 'elapsed', 'time_elapsed', 'clock', 'match_clock',
  'injury_time', 'stoppage_time', 'added_time',
  'current_period', 'period', 'half',
  
  // 比赛状态
  'status', 'status_zh', 'match_status', 'game_state', 'status_short',
  'status_long', 'is_live', 'live', 'is_finished', 'finished',
  
  // 实时赔率/盘口（赛前赛中都在变化）
  'odds', 'odds_available', 'live_odds', 'inplay_odds', 'pre_match_odds',
  'odds_by_bookmaker', 'asian_handicap', 'over_under', 'handicap',
  'clv', 'odds_curve', 'odds_movement', 'odds_trend', 'odds_change',
  'opening_odds', 'closing_odds', 'current_odds',
  
  // 实时统计（比赛中不断变化）
  'statistics', 'match_stats', 'live_stats', 'inplay_stats', 'team_stats',
  'possession', 'shots', 'shots_on_target', 'corners', 'fouls',
  'yellow_cards', 'red_cards', 'offsides', 'passes', 'pass_accuracy',
  
  // 实时轮换/换人（场上当前阵容变化）
  'current_lineup', 'live_lineup', 'on_pitch', 'players_on_pitch',
  'formation', 'current_formation',
  
  // 实时数据容器
  'live_data', 'live', 'inplay_data', 'real_time_data',
  
  // 更新时间
  'last_updated', 'updateTime', 'fetchTime', 'updated_at', 'last_modified'
]);

// ========== 数组合并字段（合并去重，不断增加）==========
// 这些是事件列表，只会越来越多，不能覆盖只能合并
const ARRAY_MERGE_FIELDS = new Set([
  // 比赛事件（进球、红黄牌、换人轮换、VAR等）
  'events', 'match_events', 'timeline', 'match_timeline',
  'goals', 'goal_events',
  'cards', 'card_events', 'yellow_card_events', 'red_card_events',
  'substitutions', 'substitution_events', 'subs',
  'var_decisions', 'var_events',
  'penalties', 'penalty_events',
  'shootouts', 'penalty_shootout',
  
  // 评论/解说
  'commentary', 'comments', 'live_commentary',
  
  // 伤病更新（比赛中新出现的伤病）
  'match_injuries', 'live_injuries'
]);

function mergeData(base, supplement, source) {
  if (!supplement) return base;
  if (!base) return { ...supplement, _source: source };
  
  const merged = { ...base };
  
  for (const key in supplement) {
    if (key.startsWith('_')) continue;
    
    const supValue = supplement[key];
    const baseValue = merged[key];
    
    // 1. 实时变化字段：用最新值覆盖
    if (LIVE_FIELDS.has(key)) {
      if (supValue !== null && supValue !== undefined && supValue !== '') {
        merged[key] = supValue;
      }
      continue;
    }
    
    // 2. 数组合并字段：合并去重（事件只会越来越多）
    if (ARRAY_MERGE_FIELDS.has(key) && Array.isArray(supValue)) {
      if (!Array.isArray(baseValue)) {
        merged[key] = supValue;
      } else {
        const existing = new Set(baseValue.map(e => JSON.stringify(e).substring(0, 100)));
        const newItems = supValue.filter(e => !existing.has(JSON.stringify(e).substring(0, 100)));
        merged[key] = [...baseValue, ...newItems];
      }
      continue;
    }
    
    // 3. 静态字段：已有不覆盖，只补充缺失
    if (baseValue === null || baseValue === undefined || baseValue === '') {
      merged[key] = supValue;
    } else if (typeof baseValue === 'object' && !Array.isArray(baseValue) &&
               typeof supValue === 'object' && !Array.isArray(supValue)) {
      merged[key] = mergeData(baseValue, supValue, source);
    }
  }
  
  merged._sources = [...new Set([...(base._sources || []), source])];
  return merged;
}

// ============================================================
// 第一步：从数据库1提取云端API原始数据
// ============================================================
async function extractFromDb1() {
  console.log('\n=== [数据库2] 第一步：从数据库1提取云端API原始数据 ===');
  
  // 读取今天和明天的比赛列表
  const todayData = loadJson(path.join(CONFIG.db1Dir, 'current', 'today.json'), null);
  const tomorrowData = loadJson(path.join(CONFIG.db1Dir, 'current', 'tomorrow.json'), null);
  const detailCache = loadJson(path.join(CONFIG.db1Dir, 'current', 'match_details.json'), {});
  
  const todayMatches = todayData?.matches || [];
  const tomorrowMatches = tomorrowData?.matches || [];
  
  console.log(`  从数据库1提取: 今天${todayMatches.length}场, 明天${tomorrowMatches.length}场, 详情${Object.keys(detailCache).length}场`);
  
  // 保存到数据库2（初始数据，来源标记为db1_cloud_api）
  if (todayData) {
    const db2Today = {
      ...todayData,
      updateTime: new Date().toISOString(),
      sources: ['db1_cloud_api'],
      matches: todayMatches.map(m => ({ ...m, _source: 'db1_cloud_api', _tier: getMatchTier(m) }))
    };
    saveJson(path.join(CONFIG.db2Dir, 'current', 'today.json'), db2Today);
  }
  
  if (tomorrowData) {
    const db2Tomorrow = {
      ...tomorrowData,
      updateTime: new Date().toISOString(),
      sources: ['db1_cloud_api'],
      matches: tomorrowMatches.map(m => ({ ...m, _source: 'db1_cloud_api', _tier: getMatchTier(m) }))
    };
    saveJson(path.join(CONFIG.db2Dir, 'current', 'tomorrow.json'), db2Tomorrow);
  }
  
  // 详情也复制到数据库2
  const db2DetailCache = {};
  for (const eventId in detailCache) {
    db2DetailCache[eventId] = { ...detailCache[eventId], _sources: ['db1_cloud_api'] };
  }
  saveJson(path.join(CONFIG.db2Dir, 'current', 'match_details.json'), db2DetailCache);
  
  return { todayMatches, tomorrowMatches, detailCache: db2DetailCache };
}

// ============================================================
// 第二步：API-Football补充详细数据（S/A级比赛）
// ============================================================
async function supplementWithApiFootball(allMatches, detailCache) {
  console.log('\n=== [数据库2] 第二步：API-Football补充详细数据（S/A级）===');
  
  if (!QuotaManager.canUse('apiFootball')) {
    console.log('  API-Football预算已用完，跳过');
    return detailCache;
  }
  
  const needSupplement = allMatches.filter(m => {
    const tier = getMatchTier(m);
    return (tier === 'S' || tier === 'A') && shouldSupplement(m);
  });
  
  console.log(`  需要补充的S/A级比赛: ${needSupplement.length} 场`);
  
  const toFetch = needSupplement.slice(0, CONFIG.maxApiFootballPerRun);
  console.log(`  本次计划补充: ${toFetch.length} 场`);
  
  let supplementedCount = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const match = toFetch[i];
    const eventId = match.event_id;
    const tier = getMatchTier(match);
    
    if (!QuotaManager.canUse('apiFootball')) {
      console.log('  API-Football预算已用完，停止');
      break;
    }
    
    if (detailCache[eventId] && detailCache[eventId]._apiFootballFetched) {
      console.log(`  [${i+1}/${toFetch.length}] [${tier}级] ${match.home_team_zh} vs ${match.away_team_zh} - 已有API-Football数据，跳过`);
      continue;
    }
    
    console.log(`  [${i+1}/${toFetch.length}] [${tier}级] ${match.home_team_zh} vs ${match.away_team_zh} - 补充API-Football数据...`);
    
    // 注意：这里需要队名匹配逻辑来获取fixture_id
    // 队名匹配完成后，调用API-Football获取详细数据
    // 然后用mergeData融合到detailCache
    
    console.log(`    ⚠ 队名匹配逻辑待完善，暂跳过（接口已预留）`);
    
    if (detailCache[eventId]) {
      detailCache[eventId]._apiFootballAttempted = true;
    }
    
    if (i < toFetch.length - 1) await sleep(CONFIG.requestDelayMs);
  }
  
  console.log(`  本次补充 ${supplementedCount} 场`);
  return detailCache;
}

// ============================================================
// 第三步：Big Balls补充xG数据（S级比赛）
// ============================================================
async function supplementWithBigBalls(allMatches, detailCache) {
  console.log('\n=== [数据库2] 第三步：Big Balls补充xG数据（S级）===');
  
  if (!QuotaManager.canUse('bigBalls')) {
    console.log('  Big Balls预算已用完，跳过');
    return detailCache;
  }
  
  const needSupplement = allMatches.filter(m => getMatchTier(m) === 'S' && shouldSupplement(m));
  console.log(`  需要补充xG的S级比赛: ${needSupplement.length} 场`);
  
  const toFetch = needSupplement.slice(0, CONFIG.maxBigBallsPerRun);
  console.log(`  本次计划补充: ${toFetch.length} 场`);
  
  let supplementedCount = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const match = toFetch[i];
    const eventId = match.event_id;
    
    if (!QuotaManager.canUse('bigBalls')) {
      console.log('  Big Balls预算已用完，停止');
      break;
    }
    
    if (detailCache[eventId] && detailCache[eventId]._bigBallsFetched) {
      console.log(`  [${i+1}/${toFetch.length}] ${match.home_team_zh} vs ${match.away_team_zh} - 已有Big Balls数据，跳过`);
      continue;
    }
    
    console.log(`  [${i+1}/${toFetch.length}] ${match.home_team_zh} vs ${match.away_team_zh} - 补充xG数据...`);
    
    // 注意：这里需要队名匹配逻辑
    console.log(`    ⚠ 队名匹配逻辑待完善，暂跳过（接口已预留）`);
    
    if (detailCache[eventId]) {
      detailCache[eventId]._bigBallsAttempted = true;
    }
    
    if (i < toFetch.length - 1) await sleep(CONFIG.requestDelayMs);
  }
  
  console.log(`  本次补充 ${supplementedCount} 场`);
  return detailCache;
}

// ============================================================
// 第四步：ESPN免费数据补充（零消耗配额）
// ============================================================
async function supplementWithEspn(allMatches, detailCache) {
  console.log('\n=== [数据库2] 第四步：ESPN免费数据补充（零消耗配额）===');
  
  // ESPN完全免费，可以补充实时比分、天气、积分榜等
  // 队名匹配完成后就能实际调用
  
  console.log('  ESPN免费数据补充接口已预留（零消耗配额，队名匹配完成后启用）');
  return detailCache;
}

// ============================================================
// 第五步：保存融合后的详情到数据库2
// ============================================================
async function saveMergedDetails(detailCache) {
  console.log('\n=== [数据库2] 第五步：保存融合后的详情 ===');
  
  saveJson(path.join(CONFIG.db2Dir, 'current', 'match_details.json'), detailCache);
  console.log(`  已保存 ${Object.keys(detailCache).length} 场融合详情到数据库2`);
}

// ============================================================
// 第六步：比赛复盘与AI学习
// ============================================================
async function processReviews(todayMatches, detailCache) {
  console.log('\n=== [数据库2] 第六步：比赛复盘与AI学习 ===');
  
  const { today } = getDates();
  const reviewPath = path.join(CONFIG.db2Dir, 'review', `${today}.json`);
  const reviewData = loadJson(reviewPath, { date: today, sources: [], matches: [] });
  const reviewedIds = new Set(reviewData.matches.map(m => m.event_id));
  
  let newReviewed = 0;
  for (const match of todayMatches) {
    if (!isMatchFinished(match)) continue;
    if (reviewedIds.has(match.event_id)) continue;
    
    const eventId = match.event_id;
    const detail = detailCache[eventId] || {};
    const tier = getMatchTier(match);
    
    console.log(`  复盘[${tier}级]: ${match.home_team_zh} ${match.home_score} - ${match.away_score} ${match.away_team_zh}`);
    
    reviewData.matches.push({
      event_id: eventId,
      league: match.league_zh || match.league_name,
      tier: tier,
      home_team: match.home_team_zh,
      away_team: match.away_team_zh,
      home_score: match.home_score,
      away_score: match.away_score,
      match_time: match.date + ' ' + match.time,
      review_time: new Date().toISOString(),
      sources: detail._sources || ['db1_cloud_api'],
      odds: match.odds || null,
      odds_by_bookmaker: detail.odds_by_bookmaker || null,
      lineups: detail.lineups || null,
      injuries: detail.injuries || null,
      statistics: detail.statistics || null,
      events: detail.events || null,
      historical_xg: detail.historical_xg || null,
      historical_odds: detail.historical_odds || null,
      ai_recommendation: null,
      ai_analysis: null,
      ai_learning: null,
      ai_weight_adjustment: null
    });
    newReviewed++;
  }
  
  if (newReviewed > 0) {
    reviewData.sources = [...new Set([...(reviewData.sources || []), 'db1_cloud_api', 'merge_process'])];
    saveJson(reviewPath, reviewData);
  }
  console.log(`  本次新增复盘 ${newReviewed} 场，今日共 ${reviewData.matches.length} 场`);
}

// ============================================================
// 第七步：AI自学习与权重调整
// ============================================================
async function aiLearning() {
  console.log('\n=== [数据库2] 第七步：AI自学习与权重调整 ===');
  
  const learningPath = path.join(CONFIG.db2Dir, 'learning', 'weights.json');
  const learningData = loadJson(learningPath, {
    updateTime: '',
    total_learned: 0,
    weights: {},
    patterns: []
  });
  
  // AI学习逻辑：分析复盘记录，调整权重，总结规律
  // 框架已搭好，后续完善具体算法
  
  learningData.updateTime = new Date().toISOString();
  saveJson(learningPath, learningData);
  
  console.log('  AI自学习接口已预留（权重调整、规律总结，永久保存）');
}

// ============================================================
// 第八步：自动清理数据库2过期数据
// ============================================================
async function cleanupDb2() {
  console.log('\n=== [数据库2] 第八步：自动清理过期数据 ===');
  
  const now = new Date();
  
  // 清理超过3个月的复盘记录
  const reviewDir = path.join(CONFIG.db2Dir, 'review');
  if (fs.existsSync(reviewDir)) {
    const files = fs.readdirSync(reviewDir);
    let deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const dateStr = file.replace('.json', '');
      const fileDate = new Date(dateStr);
      const daysDiff = (now - fileDate) / (1000 * 60 * 60 * 24);
      if (daysDiff > CONFIG.reviewRetentionDays) {
        fs.unlinkSync(path.join(reviewDir, file));
        deleted++;
      }
    }
    console.log(`  清理过期复盘记录: 删除 ${deleted} 个文件（保留${CONFIG.reviewRetentionDays}天）`);
  }
  
  // 清理超过2年的球队/球员数据
  for (const dirName of ['teams', 'players']) {
    const dir = path.join(CONFIG.db2Dir, dirName);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      let deleted = 0;
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const [year, month] = file.replace('.json', '').split('-').map(Number);
        if (!year || !month) continue;
        const fileDate = new Date(year, month - 1);
        const yearsDiff = (now - fileDate) / (1000 * 60 * 60 * 24 * 365);
        if (yearsDiff > CONFIG.teamPlayerRetentionYears) {
          fs.unlinkSync(path.join(dir, file));
          deleted++;
        }
      }
      console.log(`  清理过期${dirName}数据: 删除 ${deleted} 个文件（保留${CONFIG.teamPlayerRetentionYears}年）`);
    }
  }
  
  // 清理超过2天的比赛详情缓存
  const detailCachePath = path.join(CONFIG.db2Dir, 'current', 'match_details.json');
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
}

// ============================================================
// 第九步：更新全局统计
// ============================================================
async function updateStats() {
  console.log('\n=== [数据库2] 第九步：更新全局统计 ===');
  
  const statsPath = path.join(CONFIG.db2Dir, '..', 'stats.json');
  const stats = loadJson(statsPath, {
    total_runs: 0,
    last_update: '',
    db1_status: {},
    db2_status: {},
    api_usage: {}
  });
  
  stats.total_runs = (stats.total_runs || 0) + 1;
  stats.last_update = new Date().toISOString();
  
  // 统计数据库2的数据
  const todayData = loadJson(path.join(CONFIG.db2Dir, 'current', 'today.json'), null);
  const detailCache = loadJson(path.join(CONFIG.db2Dir, 'current', 'match_details.json'), {});
  stats.db2_status = {
    today_matches: todayData?.total || 0,
    today_with_odds: todayData?.withOdds || 0,
    detail_count: Object.keys(detailCache).length,
    sources: todayData?.sources || []
  };
  
  saveJson(statsPath, stats);
  console.log('  全局统计已更新');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  console.log('================================================================');
  console.log('  数据库2融合：从数据库1提取 + 其他API融合完善');
  console.log('  开始时间:', new Date().toLocaleString('zh-CN'));
  console.log('================================================================');
  
  try {
    QuotaManager.load();
    
    // 第一步：从数据库1提取云端API原始数据
    const { todayMatches, tomorrowMatches, detailCache } = await extractFromDb1();
    const allMatches = [...todayMatches, ...tomorrowMatches];
    
    // 第二步：API-Football补充详细数据（S/A级）
    let mergedDetails = await supplementWithApiFootball(allMatches, detailCache);
    
    // 第三步：Big Balls补充xG数据（S级）
    mergedDetails = await supplementWithBigBalls(allMatches, mergedDetails);
    
    // 第四步：ESPN免费数据补充（零消耗配额）
    mergedDetails = await supplementWithEspn(allMatches, mergedDetails);
    
    // 第五步：保存融合后的详情到数据库2
    await saveMergedDetails(mergedDetails);
    
    // 第六步：比赛复盘与AI学习
    await processReviews(todayMatches, mergedDetails);
    
    // 第七步：AI自学习与权重调整
    await aiLearning();
    
    // 第八步：自动清理过期数据
    await cleanupDb2();
    
    // 第九步：更新全局统计
    await updateStats();
    
    QuotaManager.save();
    
    console.log('\n================================================================');
    console.log('  数据库2融合完成！');
    console.log('  结束时间:', new Date().toLocaleString('zh-CN'));
    console.log('  网页端只读数据库2: data/db2_master/');
    console.log('================================================================');
    
  } catch (e) {
    console.error('\n❌ 融合出错:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
