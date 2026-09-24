// 抓取自建API的盘口数据，保存到GitHub仓库
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://47.99.155.27:8321';
const API_TOKEN = 'fmjwx8H7vbA6j8RiPD6sn9UOsrQSvPJ3d478dn4xwN8';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: { 'X-API-Token': API_TOKEN }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('开始抓取自建API数据...');
  
  // 获取今天的比赛
  const todayData = await fetchUrl(API_BASE + '/api/today');
  console.log('获取到比赛数:', todayData.matches ? todayData.matches.length : 0);
  console.log('有盘口的比赛数:', todayData.odds_coverage ? todayData.odds_coverage.with_odds : 0);
  
  // 整理成我们需要的格式
  const result = {
    updateTime: new Date().toISOString(),
    total: todayData.odds_coverage ? todayData.odds_coverage.total : 0,
    withOdds: todayData.odds_coverage ? todayData.odds_coverage.with_odds : 0,
    matches: {}
  };
  
  if (todayData.matches) {
    todayData.matches.forEach(match => {
      // 用队名作为key，方便网页匹配
      const homeName = (match.home_team_zh || '').trim();
      const awayName = (match.away_team_zh || '').trim();
      const matchKey = homeName + '_vs_' + awayName;
      
      result.matches[matchKey] = {
        eventId: match.event_id,
        league: match.league_zh || '',
        homeTeam: homeName,
        awayTeam: awayName,
        date: match.date,
        time: match.time,
        status: match.status,
        statusZh: match.status_zh,
        homeScore: match.home_score,
        awayScore: match.away_score,
        oddsAvailable: match.odds_available,
        odds: match.odds || null
      };
    });
  }
  
  // 保存到文件（相对于仓库根目录）
  const outputPath = path.join(__dirname, '..', '..', 'data', 'self_api_odds.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  
  console.log('数据已保存到:', outputPath);
  console.log('完成！');
}

main().catch(err => {
  console.error('出错了:', err);
  process.exit(1);
});
