// 自动复盘已结束比赛（GitHub Actions运行）
// 数据文件：data/learn_data.json（与网页端共用）
const https = require('https');
const fs = require('fs');
const path = require('path');

const AFB_KEY = process.env.AFB_KEY || '';
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LEARN_FILE = path.join(DATA_DIR, 'learn_data.json');
const PRED_FILE = path.join(DATA_DIR, 'predictions.json'); // 旧格式，兼容用

function afbGet(p) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'v3.football.api-sports.io',
      path: p,
      headers: { 'x-apisports-key': AFB_KEY }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function getDefaultData() {
  return {
    preds: {},
    settled: {},
    teamAdj: {},
    stats: { n: 0, brier: 0, hit: 0 }
  };
}

function loadData() {
  // 优先读取learn_data.json（网页端格式）
  try {
    if (fs.existsSync(LEARN_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8'));
      // 确保必要字段存在
      if (!data.preds) data.preds = {};
      if (!data.settled) data.settled = {};
      if (!data.teamAdj) data.teamAdj = {};
      if (!data.stats) data.stats = { n: 0, brier: 0, hit: 0 };
      console.log('从 learn_data.json 加载数据');
      return data;
    }
  } catch (e) {
    console.log('读取 learn_data.json 失败:', e.message);
  }
  
  // 兼容旧格式 predictions.json
  try {
    if (fs.existsSync(PRED_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRED_FILE, 'utf8'));
      console.log('从 predictions.json 加载数据（旧格式兼容）');
      return Object.assign(getDefaultData(), data);
    }
  } catch (e) {
    console.log('读取 predictions.json 失败:', e.message);
  }
  
  console.log('未找到数据文件，使用空数据');
  return getDefaultData();
}

function saveData(d) {
  // 确保data目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  // 保存到learn_data.json（主文件，网页端读取）
  fs.writeFileSync(LEARN_FILE, JSON.stringify(d, null, 2), 'utf8');
  console.log('已保存到 learn_data.json');
  
  // 同时保存到predictions.json（兼容旧版本）
  try {
    fs.writeFileSync(PRED_FILE, JSON.stringify(d, null, 2), 'utf8');
  } catch (e) {}
}

async function main() {
  if (!AFB_KEY) { 
    console.log('警告: 未配置 AFB_KEY，跳过API查询');
    // 即使没有API key，也保存一下数据（确保文件存在）
    const data = loadData();
    saveData(data);
    return; 
  }
  
  const shared = loadData();
  let reviewed = 0;
  let skipped = 0;
  
  const preds = Object.values(shared.preds);
  console.log(`待复盘预测: ${preds.length} 场`);
  
  for (const p of preds.slice(0, 50)) { // 每次最多检查50场
    if (shared.settled[p.fid]) { skipped++; continue; }
    if (!p.afbId) { skipped++; continue; }
    
    try {
      const data = await afbGet(`/fixtures?id=${p.afbId}`);
      if (!data.response || !data.response[0]) { skipped++; continue; }
      
      const item = data.response[0];
      const statusShort = item.fixture.status.short;
      
      // 检查比赛是否结束（FT=正常结束，AET=加时结束，PEN=点球结束）
      if (!['FT', 'AET', 'PEN'].includes(statusShort)) { 
        console.log(`  比赛 ${p.fid} 状态: ${statusShort}，未结束，跳过`);
        continue; 
      }
      
      const hg = item.goals.home || 0;
      const ag = item.goals.away || 0;
      const actual = hg > ag ? 'W' : (hg === ag ? 'D' : 'L');
      const predPick = p.W >= p.D && p.W >= p.L ? 'W' : (p.D >= p.W && p.D >= p.L ? 'D' : 'L');
      const hit = actual === predPick;
      
      console.log(`  复盘: ${p.fid} ${hg}-${ag} 预测:${predPick} 实际:${actual} ${hit ? '✓命中' : '✗偏差'}`);
      
      shared.settled[p.fid] = {
        ...p, 
        homeScore: hg, 
        awayScore: ag,
        actual, 
        predPick, 
        hit, 
        reviewedAt: Date.now(),
        setTs: Date.now()
      };
      delete shared.preds[p.fid];
      reviewed++;
      
      shared.stats.n++;
      if (hit) shared.stats.hit++;
    } catch (e) { 
      console.log(`  复盘 ${p.fid} 出错:`, e.message);
      skipped++; 
    }
  }
  
  saveData(shared);
  const rate = shared.stats.n ? (shared.stats.hit / shared.stats.n * 100).toFixed(1) : '0';
  console.log(`复盘完成: 本次${reviewed}场, 跳过${skipped}场, 命中率: ${rate}%, 总场次: ${shared.stats.n}`);
}

main().catch(e => console.error(e));
