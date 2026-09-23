// 自动复盘已结束比赛（GitHub Actions运行）
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

function loadData() {
  try { return JSON.parse(fs.readFileSync(PRED_FILE, 'utf8')); }
  catch (e) { return { preds: {}, settled: {}, stats: { n: 0, hit: 0 } }; }
}

function saveData(d) {
  fs.writeFileSync(PRED_FILE, JSON.stringify(d, null, 2), 'utf8');
}

async function main() {
  if (!AFB_KEY) { console.log('No AFB_KEY'); return; }
  
  const shared = loadData();
  let reviewed = 0;
  
  const preds = Object.values(shared.preds);
  for (const p of preds.slice(0, 50)) { // 每次最多检查50场
    if (shared.settled[p.fid]) continue;
    if (!p.afbId) continue;
    
    try {
      const data = await afbGet(`/fixtures?id=${p.afbId}`);
      if (!data.response || !data.response[0]) continue;
      
      const item = data.response[0];
      if (!['FT', 'AET', 'PEN'].includes(item.fixture.status.short)) continue;
      
      const hg = item.goals.home || 0;
      const ag = item.goals.away || 0;
      const actual = hg > ag ? 'W' : (hg === ag ? 'D' : 'L');
      const predPick = p.W >= p.D && p.W >= p.L ? 'W' : (p.D >= p.W && p.D >= p.L ? 'D' : 'L');
      const hit = actual === predPick;
      
      shared.settled[p.fid] = {
        ...p, homeScore: hg, awayScore: ag,
        actual, predPick, hit, reviewedAt: Date.now()
      };
      delete shared.preds[p.fid];
      reviewed++;
      
      shared.stats.n++;
      if (hit) shared.stats.hit++;
    } catch (e) { /* skip */ }
  }
  
  saveData(shared);
  const rate = shared.stats.n ? (shared.stats.hit / shared.stats.n * 100).toFixed(1) : '0';
  console.log(`复盘完成: ${reviewed}场, 命中率: ${rate}%, 总场次: ${shared.stats.n}`);
}

main().catch(e => console.error(e));
