// AI足球模型 - 自动运行机器人
// 功能：自动登录 → 自动预测所有比赛 → 自动复盘 → 数据同步到云端
// 由GitHub Actions定时调用，无需人工干预

const puppeteer = require('puppeteer');

// 兼容新版Puppeteer的等待函数
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 配置
const CONFIG = {
  url: 'https://qq894805001-a11y.github.io/huange-ai-model/?autopred=1',
  username: 'hjh',
  password: '123456',
  // 等待时间（毫秒）
  waitLogin: 5000,        // 等待登录页面加载
  waitHomeLoad: 15000,    // 等待首页比赛数据加载
  waitPredict: 180000,    // 等待自动预测完成（比赛多时需要更久，3分钟）
  waitSync: 15000,        // 等待数据同步到云端
  headless: true,
  // GitHub配置（用于Node.js直接写入，绕过浏览器CORS）
  github: {
    token: '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',
    owner: 'qq894805001-a11y',
    repo: 'huange-ai-model',
  }
};

// Node.js直接写入GitHub（绕过浏览器CORS限制）
async function syncToGithub(page) {
  console.log('[AI-Bot] 开始用Node.js同步数据到GitHub...');
  try {
    // 1. 从浏览器获取所有gc_开头的学习数据
    const learnData = await page.evaluate(() => {
      const data = {};
      const syncKeys = ['gc_learn_v1','gc_self_learn','gc_odds_learner','gc_live_snap_v1',
                        'gc_dyn','gc_zhcache_v1','gc_espn_codes','gc_backtest',
                        'gc_afb_map','gc_afb_quota','gc_quota_v2','gc_users_v1',
                        'gc_odds_history_v1'];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (syncKeys.includes(k) || k.startsWith('gc_afb_extra_'))) {
          data[k] = localStorage.getItem(k);
        }
      }
      return data;
    });
    console.log('[AI-Bot] 从浏览器获取到', Object.keys(learnData).length, '项学习数据');

    // 2. 用Node.js调用GitHub API写入
    const gh = CONFIG.github;
    const path = 'data/learn_data.json';
    const apiUrl = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${path}`;

    // 先获取现有文件的sha
    let sha = null;
    const getResp = await fetch(apiUrl, {
      headers: {'Authorization': 'token ' + gh.token, 'User-Agent': 'ai-bot'}
    });
    if (getResp.ok) {
      const getRespJson = await getResp.json();
      sha = getRespJson.sha;
      console.log('[AI-Bot] 文件已存在，sha:', sha.substring(0,8) + '...');
    } else {
      console.log('[AI-Bot] 文件不存在，将创建新文件');
    }

    // 写入文件（用Buffer处理中文）
    const content = Buffer.from(JSON.stringify(learnData, null, 2), 'utf-8').toString('base64');
    const putResp = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + gh.token,
        'Content-Type': 'application/json',
        'User-Agent': 'ai-bot'
      },
      body: JSON.stringify({
        message: 'Auto-sync learn data by ai-bot',
        content: content,
        sha: sha
      })
    });

    if (putResp.ok) {
      console.log('[AI-Bot] ✅ 学习数据已成功同步到GitHub！共', Object.keys(learnData).length, '项');
      return true;
    } else {
      const errText = await putResp.text();
      console.error('[AI-Bot] ❌ GitHub写入失败:', putResp.status, errText);
      return false;
    }
  } catch (e) {
    console.error('[AI-Bot] ❌ 同步异常:', e.message);
    return false;
  }
}

async function run() {
  console.log('[AI-Bot] 启动...');
  console.log('[AI-Bot] 目标URL:', CONFIG.url);

  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // 捕获控制台日志（只输出关键信息，避免被CORS错误淹没）
    page.on('console', msg => {
      const text = msg.text();
      // 只输出关键日志
      if (text.includes('[AutoPred]') ||
          text.includes('[Cloud]') ||
          text.includes('AI-Bot') ||
          text.includes('登录') ||
          text.includes('同步') ||
          text.includes('预测') ||
          text.includes('复盘') ||
          text.includes('学习')) {
        console.log('[页面]', text);
      }
    });

    // 步骤1：打开网页
    console.log('[AI-Bot] 步骤1：打开网页...');
    await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(CONFIG.waitLogin);

    // 截图：登录页
    await page.screenshot({ path: 'screenshot-01-login.png', fullPage: false });
    console.log('[AI-Bot] 登录页截图已保存');

    // 步骤2：自动登录（用page.evaluate直接设置值，避免type输入失败）
    console.log('[AI-Bot] 步骤2：自动登录...');
    try {
      await page.waitForSelector('#cloud-username', { timeout: 15000 });
      await page.evaluate(() => {
        document.getElementById('cloud-username').value = 'hjh';
        document.getElementById('cloud-password').value = '123456';
        document.getElementById('cloud-login-btn').click();
      });
      console.log('[AI-Bot] 已输入账号密码并点击登录');
    } catch (e) {
      console.log('[AI-Bot] 登录操作失败:', e.message);
    }

    // 等待登录完成和页面跳转
    console.log('[AI-Bot] 等待登录完成...');
    try {
      // 等待登录框消失（登录成功后页面会reload，登录框隐藏）
      await page.waitForFunction(() => {
        const loginBox = document.getElementById('login-box') || document.querySelector('.login-box') || document.querySelector('[id*="login"]');
        if (!loginBox) return true;
        return loginBox.style.display === 'none' || loginBox.offsetParent === null;
      }, { timeout: 15000 });
      console.log('[AI-Bot] 登录框已消失，登录成功');
    } catch (e) {
      console.log('[AI-Bot] 等待登录框消失超时，继续执行...');
    }
    await sleep(5000);

    // 检查登录是否成功
    const loginCheck = await page.evaluate(() => {
      return {
        token: localStorage.getItem('gc_token'),
        username: localStorage.getItem('gc_username'),
        role: localStorage.getItem('gc_role')
      };
    });
    console.log('[AI-Bot] 登录状态检查:', JSON.stringify(loginCheck));
    if (!loginCheck.token) {
      console.log('[AI-Bot] 警告：登录可能失败，token为空！');
    }

    // 截图：首页
    await page.screenshot({ path: 'screenshot-02-home.png', fullPage: false });
    console.log('[AI-Bot] 首页截图已保存');

    // 步骤3：等待首页比赛数据加载
    console.log('[AI-Bot] 步骤3：等待比赛数据加载...');
    await sleep(CONFIG.waitHomeLoad);

    // 步骤4：等待自动预测完成
    console.log('[AI-Bot] 步骤4：等待自动预测完成（最多' + (CONFIG.waitPredict/1000) + '秒）...');
    await sleep(CONFIG.waitPredict);

    // 截图：预测完成
    await page.screenshot({ path: 'screenshot-03-predicted.png', fullPage: false });
    console.log('[AI-Bot] 预测完成截图已保存');

    // 步骤5：用Node.js直接同步数据到GitHub（绕过浏览器CORS限制）
    console.log('[AI-Bot] 步骤5：同步数据到GitHub...');
    await syncToGithub(page);
    await sleep(3000);

    // 最终截图
    await page.screenshot({ path: 'screenshot-04-final.png', fullPage: false });
    console.log('[AI-Bot] 最终截图已保存');

    console.log('[AI-Bot] 完成！所有操作已执行。');

  } catch (e) {
    console.error('[AI-Bot] 运行出错:', e.message);
    // 错误截图
    try {
      await page.screenshot({ path: 'screenshot-error.png', fullPage: false });
      console.log('[AI-Bot] 错误截图已保存');
    } catch (e2) {}
    throw e;
  } finally {
    await browser.close();
    console.log('[AI-Bot] 浏览器已关闭');
  }
}

run().catch(e => {
  console.error('[AI-Bot] 致命错误:', e);
  process.exit(1);
});
