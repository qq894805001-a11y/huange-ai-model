// 自动扫描比赛并预测（GitHub Actions运行）
const https = require('https');
const fs = require('fs');
const path = require('path');

const AFB_KEY = process.env.AFB_KEY || '';
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PRED_FILE = path.join(DATA_DIR, 'predictions.json');

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

function simplePredict() {
  // 简化预测：主胜37% / 平26% / 客胜37%
  return { W: 0.37, D: 0.26, L: 0.37 };
}

function loadData() {
  try { return JSON.parse(fs.readFileSync(PRED_FILE, 'utf8')); }
  catch (e) { return { preds: {}, settled: {}, stats: { n: 0, hit: 0 } }; }
}

function saveData(d) {
  fs.writeFileSync(PRED_FILE, JSON.stringify(d, null, 2), 'utf8');
}

async function main() {
  if (!AFB_KEY) { console.log('No AFB_KEY'); return; }
  
  const today = new Date().toISOString().slice(0, 10);
  console.log('扫描日期:', today);
  
  const data = await afbGet(`/fixtures?date=${today}`);
  if (!data.response) { console.log('No data'); return; }
  
  const shared = loadData();
  let newPreds = 0;
  
  for (const item of data.response) {
    const fid = 'afb_' + item.fixture.id;
    if (shared.preds[fid]) continue;
    if (item.fixture.status.short !== 'NS') continue;
    
    const pred = simplePredict();
    shared.preds[fid] = {
      fid, afbId: item.fixture.id,
      home: item.teams.home.name,
      away: item.teams.away.name,
      league: item.league ? item.league.name : '',
      date: today, ts: Date.now(),
      W: pred.W, D: pred.D, L: pred.L,
      auto: true
    };
    newPreds++;
  }
  
  // 保留3个月数据
  const cutoff = Date.now() - 90 * 86400000;
  Object.keys(shared.settled).forEach(k => {
    if (shared.settled[k].reviewedAt < cutoff) delete shared.settled[k];
  });
  
  saveData(shared);
  console.log(`新增预测: ${newPreds}场, 总预测: ${Object.keys(shared.preds).length}场, 已复盘: ${Object.keys(shared.settled).length}场`);
}

main().catch(e => console.error(e));
