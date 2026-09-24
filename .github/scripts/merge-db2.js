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

// ============================================================
// 名字库：队名/联赛名中英文映射与自动学习
// ============================================================
const TEAM_NAME_LIB = {
  // 英超
  'manchesterunited': '曼联', 'manutd': '曼联', 'manchesterunitedfc': '曼联',
  'manchestercity': '曼城', 'mancity': '曼城', 'manchestercityfc': '曼城',
  'liverpool': '利物浦', 'liverpoolfc': '利物浦',
  'chelsea': '切尔西', 'chelseafc': '切尔西',
  'arsenal': '阿森纳', 'arsenalfc': '阿森纳',
  'tottenham': '热刺', 'tottenhamhotspur': '热刺', 'spurs': '热刺',
  'newcastle': '纽卡斯尔', 'newcastleunited': '纽卡斯尔', 'newcastleunitedfc': '纽卡斯尔',
  'astonvilla': '阿斯顿维拉', 'astonvillafc': '阿斯顿维拉',
  'manunited': '曼联',
  // 西甲
  'realmadrid': '皇家马德里', 'realmadridcf': '皇家马德里', 'madrid': '皇家马德里',
  'fcbarcelona': '巴塞罗那', 'barcelona': '巴塞罗那', 'barca': '巴塞罗那',
  'atleticomadrid': '马德里竞技', 'atletico': '马德里竞技', 'atleticomadrid': '马德里竞技',
  'sevilla': '塞维利亚', 'sevillafc': '塞维利亚',
  'valencia': '瓦伦西亚', 'valenciacf': '瓦伦西亚',
  'realsociedad': '皇家社会', 'realsociedad': '皇家社会',
  'athleticbilbao': '毕尔巴鄂竞技', 'athleticclub': '毕尔巴鄂竞技', 'bilbao': '毕尔巴鄂竞技',
  // 意甲
  'juventus': '尤文图斯', 'juventusfc': '尤文图斯', 'juve': '尤文图斯',
  'acmilan': 'AC米兰', 'milan': 'AC米兰',
  'intermilan': '国际米兰', 'inter': '国际米兰', 'internazionale': '国际米兰',
  'napoli': '那不勒斯', 'sscnapoli': '那不勒斯',
  'roma': '罗马', 'asaroma': '罗马',
  'lazio': '拉齐奥', 'sslazio': '拉齐奥',
  'atalanta': '亚特兰大', 'atalantabc': '亚特兰大',
  'fiorentina': '佛罗伦萨', 'acffiorentina': '佛罗伦萨',
  // 德甲
  'bayernmunich': '拜仁慕尼黑', 'bayern': '拜仁慕尼黑', 'fcbayernmunchen': '拜仁慕尼黑',
  'borussiadortmund': '多特蒙德', 'dortmund': '多特蒙德', 'bvb': '多特蒙德',
  'rb leipzig': '莱比锡红牛', 'rbleipzig': '莱比锡红牛', 'leipzig': '莱比锡红牛',
  'bayerleverkusen': '勒沃库森', 'leverkusen': '勒沃库森',
  'schalke04': '沙尔克04', 'schalke': '沙尔克04',
  'wolfsburg': '沃尔夫斯堡', 'vflwolfsburg': '沃尔夫斯堡',
  // 法甲
  'parissaintgermain': '巴黎圣日耳曼', 'psg': '巴黎圣日耳曼', 'paris': '巴黎圣日耳曼',
  'marseille': '马赛', 'om': '马赛', 'olympiquedemarseille': '马赛',
  'lyon': '里昂', 'ol': '里昂', 'olympique lyonnais': '里昂',
  'monaco': '摩纳哥', 'asmonaco': '摩纳哥',
  'lille': '里尔', 'lilleosc': '里尔',
  // 国家队
  'netherlands': '荷兰', 'holland': '荷兰', 'ned': '荷兰',
  'germany': '德国', 'deutschland': '德国', 'ger': '德国',
  'france': '法国', 'fra': '法国',
  'spain': '西班牙', 'esp': '西班牙',
  'england': '英格兰', 'eng': '英格兰',
  'italy': '意大利', 'ita': '意大利',
  'portugal': '葡萄牙', 'por': '葡萄牙',
  'brazil': '巴西', 'bra': '巴西',
  'argentina': '阿根廷', 'arg': '阿根廷',
  'belgium': '比利时', 'bel': '比利时',
  'croatia': '克罗地亚', 'cro': '克罗地亚',
  'denmark': '丹麦', 'den': '丹麦',
  'sweden': '瑞典', 'swe': '瑞典',
  'norway': '挪威', 'nor': '挪威',
  'switzerland': '瑞士', 'sui': '瑞士',
  'austria': '奥地利', 'aut': '奥地利',
  'wales': '威尔士', 'wal': '威尔士',
  'scotland': '苏格兰', 'sco': '苏格兰',
  'ireland': '爱尔兰', 'irl': '爱尔兰', 'republicofireland': '爱尔兰',
  'serbia': '塞尔维亚', 'srb': '塞尔维亚',
  'greece': '希腊', 'gre': '希腊',
  'poland': '波兰', 'pol': '波兰',
  'turkey': '土耳其', 'tur': '土耳其',
  'ukraine': '乌克兰', 'ukr': '乌克兰',
  'russia': '俄罗斯', 'rus': '俄罗斯',
  'japan': '日本', 'jpn': '日本',
  'southkorea': '韩国', 'korea': '韩国', 'kor': '韩国',
  'china': '中国', 'chn': '中国', 'chinapr': '中国',
  'australia': '澳大利亚', 'aus': '澳大利亚',
  'saudiarabia': '沙特阿拉伯', 'saudi': '沙特阿拉伯', 'ksa': '沙特阿拉伯',
  'iran': '伊朗', 'irn': '伊朗',
  'qatar': '卡塔尔', 'qat': '卡塔尔',
  'unitedstates': '美国', 'usa': '美国', 'us': '美国',
  'mexico': '墨西哥', 'mex': '墨西哥',
  'canada': '加拿大', 'can': '加拿大',
  'egypt': '埃及', 'egy': '埃及',
  'morocco': '摩洛哥', 'mar': '摩洛哥',
  'nigeria': '尼日利亚', 'nga': '尼日利亚',
  'senegal': '塞内加尔', 'sen': '塞内加尔',
  'ghana': '加纳', 'gha': '加纳',
  'cameroon': '喀麦隆', 'cmr': '喀麦隆',
  'ivorycoast': '科特迪瓦', 'cotedivoire': '科特迪瓦', 'civ': '科特迪瓦',
  'algeria': '阿尔及利亚', 'alg': '阿尔及利亚',
  'tunisia': '突尼斯', 'tun': '突尼斯',
  'israel': '以色列', 'isr': '以色列',
  'czechrepublic': '捷克', 'czech': '捷克', 'cze': '捷克',
  'hungary': '匈牙利', 'hun': '匈牙利',
  'romania': '罗马尼亚', 'rou': '罗马尼亚',
  'slovakia': '斯洛伐克', 'svk': '斯洛伐克',
  'slovenia': '斯洛文尼亚', 'svn': '斯洛文尼亚',
  'bulgaria': '保加利亚', 'bul': '保加利亚',
  'albania': '阿尔巴尼亚', 'alb': '阿尔巴尼亚',
  'iceland': '冰岛', 'isl': '冰岛',
  'finland': '芬兰', 'fin': '芬兰',
  'estonia': '爱沙尼亚', 'est': '爱沙尼亚',
  'latvia': '拉脱维亚', 'lat': '拉脱维亚',
  'lithuania': '立陶宛', 'ltu': '立陶宛',
  'malta': '马耳他', 'mlt': '马耳他',
  'cyprus': '塞浦路斯', 'cyp': '塞浦路斯',
  'luxembourg': '卢森堡', 'lux': '卢森堡',
  'andorra': '安道尔', 'and': '安道尔',
  'sanmarino': '圣马力诺', 'smr': '圣马力诺',
  'gibraltar': '直布罗陀', 'gib': '直布罗陀',
  'liechtenstein': '列支敦士登', 'lie': '列支敦士登',
  'luxembourg': '卢森堡', 'lux': '卢森堡',
  'malta': '马耳他', 'mlt': '马耳他',
  'iceland': '冰岛', 'isl': '冰岛',
  'finland': '芬兰', 'fin': '芬兰',
  'estonia': '爱沙尼亚', 'est': '爱沙尼亚',
  'latvia': '拉脱维亚', 'lat': '拉脱维亚',
  'lithuania': '立陶宛', 'ltu': '立陶宛',
  'cyprus': '塞浦路斯', 'cyp': '塞浦路斯',
  'kosovo': '科索沃', 'kos': '科索沃',
  'bosniaandherzegovina': '波黑', 'bosnia': '波黑', 'bih': '波黑',
  'northmacedonia': '北马其顿', 'macedonia': '北马其顿', 'mkd': '北马其顿',
  'montenegro': '黑山', 'mne': '黑山',
  'armenia': '亚美尼亚', 'arm': '亚美尼亚',
  'georgia': '格鲁吉亚', 'geo': '格鲁吉亚',
  'azerbaijan': '阿塞拜疆', 'aze': '阿塞拜疆',
  'kazakhstan': '哈萨克斯坦', 'kaz': '哈萨克斯坦',
  'uzbekistan': '乌兹别克斯坦', 'uzb': '乌兹别克斯坦',
  'thailand': '泰国', 'tha': '泰国',
  'vietnam': '越南', 'vie': '越南',
  'indonesia': '印度尼西亚', 'idn': '印度尼西亚',
  'malaysia': '马来西亚', 'mas': '马来西亚',
  'singapore': '新加坡', 'sgp': '新加坡',
  'philippines': '菲律宾', 'phi': '菲律宾',
  'india': '印度', 'ind': '印度',
  'hongkong': '中国香港', 'hk': '中国香港',
  'chinesetaipei': '中国台北', 'taiwan': '中国台北',
  'newzealand': '新西兰', 'nzl': '新西兰',
  'southafrica': '南非', 'rsa': '南非',
  'kenya': '肯尼亚', 'ken': '肯尼亚',
  'angola': '安哥拉', 'ang': '安哥拉',
  'mozambique': '莫桑比克', 'moz': '莫桑比克',
  'zambia': '赞比亚', 'zam': '赞比亚',
  'zimbabwe': '津巴布韦', 'zim': '津巴布韦',
  'uganda': '乌干达', 'uga': '乌干达',
  'tanzania': '坦桑尼亚', 'tan': '坦桑尼亚',
  'rwanda': '卢旺达', 'rwa': '卢旺达',
  'burkinafaso': '布基纳法索', 'bfa': '布基纳法索',
  'mali': '马里', 'mli': '马里',
  'niger': '尼日尔', 'nig': '尼日尔',
  'chad': '乍得', 'cha': '乍得',
  'sudan': '苏丹', 'sdn': '苏丹',
  'ethiopia': '埃塞俄比亚', 'eth': '埃塞俄比亚',
  'libya': '利比亚', 'lby': '利比亚',
  'jordan': '约旦', 'jor': '约旦',
  'iraq': '伊拉克', 'irq': '伊拉克',
  'syria': '叙利亚', 'syr': '叙利亚',
  'lebanon': '黎巴嫩', 'lbn': '黎巴嫩',
  'palestine': '巴勒斯坦', 'ple': '巴勒斯坦',
  'oman': '阿曼', 'oma': '阿曼',
  'yemen': '也门', 'yem': '也门',
  'kuwait': '科威特', 'kuw': '科威特',
  'bahrain': '巴林', 'bhr': '巴林',
  'unitedarabemirates': '阿联酋', 'uae': '阿联酋',
  'syria': '叙利亚',
  'venezuela': '委内瑞拉', 'ven': '委内瑞拉',
  'colombia': '哥伦比亚', 'col': '哥伦比亚',
  'peru': '秘鲁', 'per': '秘鲁',
  'chile': '智利', 'chi': '智利',
  'ecuador': '厄瓜多尔', 'ecu': '厄瓜多尔',
  'bolivia': '玻利维亚', 'bol': '玻利维亚',
  'paraguay': '巴拉圭', 'par': '巴拉圭',
  'uruguay': '乌拉圭', 'uru': '乌拉圭',
  'costarica': '哥斯达黎加', 'crc': '哥斯达黎加',
  'panama': '巴拿马', 'pan': '巴拿马',
  'honduras': '洪都拉斯', 'hon': '洪都拉斯',
  'guatemala': '危地马拉', 'gua': '危地马拉',
  'elsalvador': '萨尔瓦多', 'slv': '萨尔瓦多',
  'nicaragua': '尼加拉瓜', 'nic': '尼加拉瓜',
  'haiti': '海地', 'hai': '海地',
  'dominicanrepublic': '多米尼加', 'dom': '多米尼加',
  'cuba': '古巴', 'cub': '古巴',
  'jamaica': '牙买加', 'jam': '牙买加',
  'trinidadandtobago': '特立尼达和多巴哥', 'tri': '特立尼达和多巴哥',
  // 中北美及加勒比海其他国家队
  'puertorico': '波多黎各', 'pur': '波多黎各',
  'guyana': '圭亚那', 'guy': '圭亚那',
  'caymanislands': '开曼群岛', 'cay': '开曼群岛',
  'dominica': '多米尼克', 'dma': '多米尼克',
  'curacao': '库拉索', 'cuw': '库拉索',
  'barbados': '巴巴多斯', 'brb': '巴巴多斯',
  'bermuda': '百慕大', 'ber': '百慕大',
  'bahamas': '巴哈马', 'bah': '巴哈马',
  'belize': '伯利兹', 'blz': '伯利兹',
  'grenada': '格林纳达', 'grn': '格林纳达',
  'saintlucia': '圣卢西亚', 'lca': '圣卢西亚',
  'saintvincentandthegrenadines': '圣文森特和格林纳丁斯', 'vin': '圣文森特和格林纳丁斯',
  'antiguaandbarbuda': '安提瓜和巴布达', 'atg': '安提瓜和巴布达',
  'saintkittsandnevis': '圣基茨和尼维斯', 'skn': '圣基茨和尼维斯',
  'aruba': '阿鲁巴', 'aru': '阿鲁巴',
  'suriname': '苏里南', 'sur': '苏里南',
  'frenchguiana': '法属圭亚那',
  'guadeloupe': '瓜德罗普',
  'martinique': '马提尼克',
  'saintmartin': '圣马丁',
  'britishvirginislands': '英属维尔京群岛',
  'usvirginislands': '美属维尔京群岛',
  'turksandcaicosislands': '特克斯和凯科斯群岛',
  'anguilla': '安圭拉',
  'montserrat': '蒙特塞拉特',
  // 德国低级别联赛球队
  'sportfreundesiegen': '锡根体育之友',
  'rwoberhausen': '奥伯豪森红白',
  'rotweissoberhausen': '奥伯豪森红白',
  'msvduisburg': '杜伊斯堡',
  'darmstadt98': '达姆施塔特98',
  'saintpauli': '圣保利',
  'fckaiserslautern': '凯泽斯劳滕',
  'hannover96': '汉诺威96',
  'nurnberg': '纽伦堡',
  'hamburger': '汉堡',
  'schalke04': '沙尔克04',
  'herthabsc': '柏林赫塔',
  'eintrachtbraunschweig': '不伦瑞克',
  'karlsruhersc': '卡尔斯鲁厄',
  'hansarostock': '罗斯托克',
  'holsteinkiel': '基尔',
  'scpaderborn': '帕德博恩',
  'svsandhausen': '桑德豪森',
  'fcingolstadt04': '因戈尔施塔特',
  'vflbochum': '波鸿',
  'fortunadusseldorf': '杜塞尔多夫',
  'heidenheim': '海登海姆',
  'mainz05': '美因茨',
  'freiburg': '弗赖堡',
  'hoffenheim': '霍芬海姆',
  'augsburg': '奥格斯堡',
  'wolfsburg': '沃尔夫斯堡',
  'mgladbach': '门兴格拉德巴赫',
  'borussiamonchengladbach': '门兴格拉德巴赫',
  'eintrachtfrankfurt': '法兰克福',
  'bayerleverkusen': '勒沃库森',
  'rbleipzig': '莱比锡红牛',
  'dortmund': '多特蒙德',
  'bayernmunich': '拜仁慕尼黑',
  'stuttgart': '斯图加特',
  'unionberlin': '柏林联合',
  'cologne': '科隆',
  'fckoln': '科隆',
  'werderbremen': '云达不莱梅',
  'bochum': '波鸿',
  // 英格兰低级别联赛/全国联赛球队
  'aldershot': '奥尔德肖特镇', 'aldershottown': '奥尔德肖特镇',
  'altrincham': '阿尔特林查姆',
  'barrow': '巴罗', 'barrowafc': '巴罗',
  'borehamwood': '博勒姆伍德', 'borehamwoodfc': '博勒姆伍德',
  'bostonunited': '波士顿联', 'bostonunitedfc': '波士顿联',
  'carlisleunited': '卡莱尔联', 'carlisle': '卡莱尔联',
  'eastleigh': '伊斯特利', 'eastleighfc': '伊斯特利',
  'fchalifaxtown': '哈利法克斯', 'halifaxtown': '哈利法克斯', 'halifax': '哈利法克斯',
  'forestgreenrovers': '森林绿流浪者', 'forestgreen': '森林绿流浪者', 'fgr': '森林绿流浪者',
  'gateshead': '盖茨黑德', 'gatesheadfc': '盖茨黑德',
  'harrogatetown': '哈罗盖特镇', 'harrogate': '哈罗盖特镇',
  'hartlepoolunited': '哈特尔浦联', 'hartlepool': '哈特尔浦联',
  'kidderminsterharriers': '基德明斯特猎鹰', 'kidderminster': '基德明斯特猎鹰',
  'scunthorpeunited': '斯肯索普联', 'scunthorpe': '斯肯索普联',
  'solihullmoors': '索利赫尔摩尔', 'solihull': '索利赫尔摩尔',
  'southendunited': '绍森德联', 'southend': '绍森德联',
  'suttonunited': '萨顿联', 'sutton': '萨顿联',
  'tamworth': '塔姆沃思', 'tamworthfc': '塔姆沃思',
  'wealdstone': '维尔德斯通', 'wealdstonefc': '维尔德斯通',
  'woking': '沃金', 'wokingfc': '沃金',
  'worthing': '沃辛', 'worthingfc': '沃辛',
  'yeoviltown': '约维尔镇', 'yeovil': '约维尔镇',
  'afcfylde': 'AFC菲尔德', 'fylde': 'AFC菲尔德',
  'afchornchurch': 'AFC霍恩彻奇', 'hornchurch': 'AFC霍恩彻奇',
  'rochdale': '罗奇代尔', 'rochdaleafc': '罗奇代尔',
  'oldhamathletic': '奥尔德姆竞技', 'oldham': '奥尔德姆竞技',
  'chesterfield': '切斯特菲尔德', 'chesterfieldfc': '切斯特菲尔德',
  'barnet': '巴尼特', 'barnetfc': '巴尼特',
  'doverathletic': '多佛竞技', 'dover': '多佛竞技',
  'maidstoneunited': '梅德斯通联', 'maidstone': '梅德斯通联',
  'dorkingwanders': '多金流浪者', 'dorking': '多金流浪者',
  'maidenheadunited': '梅登黑德联', 'maidenhead': '梅登黑德联',
  'bromley': '布罗姆利', 'bromleyfc': '布罗姆利',
  'ebbsfleetunited': '埃伯斯弗利特联', 'ebbsfleet': '埃伯斯弗利特联',
  'oxfordcity': '牛津城', 'oxfordcityfc': '牛津城',
  'avonley': '埃文利',
  'hemeltown': '赫默尔镇',
  'wellingunited': '韦林联',
  'sloughtown': '斯劳镇',
  'bathcity': '巴斯城',
  'havantwaterlooville': '哈文特滑铁卢',
  'weston-super-mare': '滨海韦斯顿',
  'taunttown': '汤顿镇',
  'truocity': '特鲁罗城',
  'plymouthparkway': '普利茅斯公园大道',
  'exetercity': '埃克塞特城',
  'torquayunited': '托奎联', 'torquay': '托奎联',
  'hereford': '赫里福德', 'herefordfc': '赫里福德',
  'gloucestercity': '格洛斯特城',
  'chorley': '乔利',
  'curzonashton': '柯曾阿什顿',
  'darlington': '达灵顿',
  'farsleyceltic': '法斯利凯尔特人',
  'southport': '绍斯波特',
  'spennymoorstown': '斯彭尼穆尔镇',
  'brackleytown': '布拉克利镇',
  'banburyunited': '班伯里联',
  'peterboroughsports': '彼得伯勒体育',
  'rushdenanddiamonds': '拉什登钻石',
  'tamworthfc': '塔姆沃思',
  'leamington': '利明顿',
  'kingslynn': '金斯林',
  'alfretontown': '阿尔弗雷顿镇',
  'bostonunited': '波士顿联',
  'buxton': '巴克斯顿',
  'chester': '切斯特',
  'farsleyceltic': '法斯利凯尔特人',
  'guiseley': '吉斯利',
  'mickleover': '米克尔奥弗',
  'scunthorpeunited': '斯肯索普联',
  'southshields': '南希尔兹',
  'spennymoorstown': '斯彭尼穆尔镇',
  'warringtonrylands': '沃灵顿瑞兰',
  'workington': '沃金顿',
  'matlocktown': '马特洛克镇',
  'whitbytown': '惠特比镇',
  'marskeunited': '马斯克联',
  'shildon': '希尔登',
  'penrith': '彭里斯',
  'hebburntown': '赫本镇',
  'stocktontown': '斯托克顿镇',
  'dunstonuts': '邓斯顿乌茨',
  'westaucklandtown': '西奥克兰镇',
  'newcastlebenfield': '纽卡斯尔本菲尔德',
  'northshields': '北希尔兹',
  'whickham': '惠克姆',
  'sunderlandryhope': '桑德兰赖霍普',
  'consett': '康塞特',
  'brighoustown': '布里格豪斯镇',
  'campion': '坎皮恩',
  'golcarunited': '戈尔卡联',
  'emley': '埃姆利',
  'wintertonrangers': '温特顿流浪者',
  'frickleyathletic': '弗里克利竞技',
  'sheffieldfc': '谢菲尔德俱乐部',
  'stocksbridgeparkssteels': '斯托克斯布里奇公园钢铁',
  'yorkshireamateurs': '约克郡业余',
  'hallroadunited': '霍尔路联',
  'northferriby': '北费里比',
  'barton-town': '巴顿镇',
  'grimsbyborough': '格里姆斯比自治市',
  'brigg': '布里格',
  'cleethorpes': '克利索普斯',
  'lincolnunited': '林肯联',
  'sleafordtown': '斯利福德镇',
  'holbeachunited': '霍尔比奇联',
  'deepingrangers': '迪平流浪者',
  'wisbechtown': '威斯比奇镇',
  'yaxley': '亚克斯利',
  'corbytown': '科比镇',
  'daventrytown': '达文特里镇',
  'dunstabletown': '邓斯特布尔镇',
  'leightontown': '莱顿镇',
  'biggleswadetown': '比格尔斯韦德镇',
  'bedfordtown': '贝德福德镇',
  'stotfold': '斯托特福德',
  'arleseytown': '阿尔西镇',
  'baldocktown': '鲍多克镇',
  'colneyheath': '科尔尼希思',
  'leverstockgreen': '莱弗斯托克格林',
  'hadley': '哈德利',
  'cockfosters': '科克福斯特斯',
  'raynerslane': '雷纳斯巷',
  'ascotunited': '阿斯科特联',
  'binfield': '宾菲尔德',
  'thatchamtown': '撒彻姆镇',
  'readingcity': '雷丁城',
  'marlow': '马洛',
  'highwycombe': '海威科姆',
  'flackwellheath': '弗拉克威尔希思',
  'risboroughrangers': '里斯伯勒流浪者',
  'tringathletic': '特林竞技',
  'leightonbuzzard': '莱顿巴扎德',
  'ampthilltown': '安普西尔镇',
  'dunstable': '邓斯特布尔',
  'totternhoe': '托特诺霍',
  'stonyStratford': '斯托尼斯特拉特福德',
  'newportpagnelltown': '纽波特帕格内尔镇',
  'wellingboroughtown': '韦林伯勒镇',
  'cogenhoeunited': '科根霍联',
  'northamptononley': '北安普顿昂利',
  'raunds': '朗兹',
  'desboroughtown': '德斯伯勒镇',
  'peterboroughnorthernstar': '彼得伯勒北极星',
  'blackstones': '布莱克斯通斯',
  'bournetown': '伯恩镇',
  'pinchbeckunited': '平奇贝克联',
  'holbeach': '霍尔比奇',
  'marchtown': '马奇镇',
  'wisbechstmarys': '威斯比奇圣玛丽',
  'downhammarket': '唐汉姆市场',
  'kingslynnreserves': '金斯林预备队',
  'fakenhamtown': '费克纳姆镇',
  'swaffhamtown': '斯沃弗姆镇',
  'derehamtown': '德里厄姆镇',
  'wroxham': '罗克瑟姆',
  'greatyarmouth': '大雅茅斯',
  'lowestofttown': '洛斯托夫特镇',
  'leiston': '莱斯顿',
  'needhammarket': '尼德姆市场',
  'stowmarket': '斯托马基特',
  'felixstowe': '费利克斯托',
  'hadleighunited': '哈德利联',
  'longmelford': '朗梅尔福德',
  'whittonunited': '惠顿联',
  'woodbridge': '伍德布里奇',
  'framlinghamtown': '弗拉明翰镇',
  'halesworth': '黑尔斯沃思',
  'diss': '迪斯',
  'gorleston': '戈尔斯顿',
  'greatyarmouthtown': '大雅茅斯镇',
  'caistorrovers': '凯斯特流浪者',
  'briggstown': '布里格斯镇',
  'bottesfordtown': '博特斯福德镇',
  'grimsby': '格里姆斯比',
  'cleethorpes': '克利索普斯',
  'immingham': '伊明厄姆',
  'barton': '巴顿',
  'winterton': '温特顿',
  'applebyfrodingham': '阿普比弗罗丁厄姆',
  'bottesford': '博特斯福德',
  'brigg': '布里格',
  'caistor': '凯斯特',
  'hullunited': '赫尔联',
  'hedonrangers': '赫登流浪者',
  'northferriby': '北费里比',
  'skegnesstown': '斯凯格内斯镇',
  'spaldingunited': '斯波尔丁联',
  'bostona': '波士顿',
  'sleaford': '斯利福德',
  'grantham': '格兰瑟姆',
  'newark': '纽瓦克',
  'lincoln': '林肯',
  'gainsborough': '盖恩斯伯勒',
  'worksop': '沃克索普',
  'retford': '雷特福德',
  'dronfield': '德龙菲尔德',
  'sheffield': '谢菲尔德',
  'rotherham': '罗瑟勒姆',
  'doncaster': '唐卡斯特',
  'barnsley': '巴恩斯利',
  'wakefield': '韦克菲尔德',
  'leeds': '利兹',
  'bradford': '布拉德福德',
  'huddersfield': '哈德斯菲尔德',
  'halifax': '哈利法克斯',
  'burnley': '伯恩利',
  'blackburn': '布莱克本',
  'preston': '普雷斯顿',
  'blackpool': '布莱克浦',
  'fleetwood': '弗利特伍德',
  'morecambe': '莫克姆',
  'barrow': '巴罗',
  'carlisle': '卡莱尔',
  'whitehaven': '怀特黑文',
  'workington': '沃金顿',
  'penrith': '彭里斯',
  'carlisleunited': '卡莱尔联',
  'gretna': '格雷特纳',
  'annanathletic': '安南竞技',
  'queenofthesouth': '南方女王',
  'stranraer': '斯特兰拉尔',
  'ayrunited': '艾尔联',
  'kilmarnock': '基尔马诺克',
  'motherwell': '马瑟韦尔',
  'hamiltonacademical': '汉密尔顿学院',
  'standrews': '圣安德鲁斯',
  'stmirren': '圣米伦',
  'partickthistle': '帕尔蒂克蓟花',
  'rangers': '流浪者',
  'celtic': '凯尔特人',
  'aberdeen': '阿伯丁',
  'dundeeunited': '邓迪联',
  'dundee': '邓迪',
  'stjohnstone': '圣约翰斯通',
  'hibernian': '希伯尼安',
  'heartofmidlothian': '哈茨',
  'hearts': '哈茨',
  'rosscounty': '罗斯郡',
  'invernesscaledonianthistle': '因弗内斯喀里多尼亚蓟花',
  'livingston': '利文斯顿',
};

const LEAGUE_NAME_LIB = {
  // 欧洲五大联赛
  'premierleague': '英超', 'epl': '英超', 'englishpremierleague': '英超',
  'laliga': '西甲', 'laligasantander': '西甲', 'spanishlaliga': '西甲',
  'seriea': '意甲', 'serieatim': '意甲', 'italianseriea': '意甲',
  'bundesliga': '德甲', 'germanbundesliga': '德甲',
  'ligue1': '法甲', 'ligue1uber': '法甲', 'frenchligue1': '法甲',
  // 其他欧洲联赛
  'eredivisie': '荷甲', 'dutcheredivisie': '荷甲',
  'primeiraliga': '葡超', 'portugueseprimeiraliga': '葡超',
  'superlig': '土超', 'turkishsuperlig': '土超',
  'jupilerproleague': '比甲', 'belgianproleague': '比甲',
  'superleague': '希超', 'greeksuperleague': '希超',
  'ekstraklasa': '波超', 'polishekstraklasa': '波超',
  'nationalliga': '瑞士超', 'swisssuperleague': '瑞士超',
  'allsvenskan': '瑞典超', 'swedishallsvenskan': '瑞典超',
  'eliteserien': '挪威超', 'norwegianeliteserien': '挪威超',
  'danishsuperliga': '丹超', 'superligaden': '丹超',
  'russianpremierleague': '俄超', 'rpl': '俄超',
  'ukrainianpremierleague': '乌超', 'ukrpremier': '乌超',
  'austrianbundesliga': '奥甲', 'bundesligaustria': '奥甲',
  'czechfirstleague': '捷甲', 'czechfortunaliga': '捷甲',
  'hungariannbii': '匈甲', 'nbii': '匈甲',
  'romanianliga1': '罗甲', 'liga1': '罗甲',
  'serbiansuperliga': '塞尔超', 'serbiansuperleague': '塞尔超',
  'croatianfirstleague': '克甲', 'hnl': '克甲',
  'slovaksuperliga': '斯伐超', 'slovakfortunaliga': '斯伐超',
  'slovenianprvaliga': '斯亚超', 'slovenianprvaliga': '斯亚超',
  'bulgarianfirstleague': '保甲', 'bulgarianparva liga': '保甲',
  'israeli premier league': '以超', 'israelipremierleague': '以超',
  'cyprusfirstdivision': '塞浦甲', 'cypriotfirstdivision': '塞浦甲',
  // 杯赛
  'uefachampionsleague': '欧冠', 'championsleague': '欧冠', 'ucl': '欧冠',
  'uefaeuropaleague': '欧联', 'europaleague': '欧联', 'uel': '欧联',
  'uefaconferenceleague': '欧协联', 'conferenceleague': '欧协联',
  'uefanationsleague': '欧国联', 'nationsleague': '欧国联',
  'fifaworldcup': '世界杯', 'worldcup': '世界杯',
  'uefaeuropeanchampionship': '欧洲杯', 'euro': '欧洲杯',
  'copaamerica': '美洲杯', 'copa america': '美洲杯',
  'afcon': '非洲杯', 'africancupofnations': '非洲杯',
  'asiancup': '亚洲杯', 'afcasiancup': '亚洲杯',
  'facup': '足总杯', 'thefacup': '足总杯',
  'eplcup': '联赛杯', 'carabaocup': '联赛杯', 'eflcup': '联赛杯',
  'copadelrey': '国王杯', 'spanishcopadelrey': '国王杯',
  'coppaitalia': '意大利杯', 'italiancup': '意大利杯',
  'dfbpokal': '德国杯', 'germandfbpokal': '德国杯',
  'coupedefrance': '法国杯', 'frenchcoupedefrance': '法国杯',
  // 亚洲联赛
  'j1league': '日职联', 'jleague': '日职联', 'japanj1league': '日职联',
  'j2league': '日职乙', 'japanj2league': '日职乙',
  'jleaguecup': '日联杯', 'jleaguecup': '日联杯',
  'emperorscup': '天皇杯', 'japanemperorscup': '天皇杯',
  'kleague1': '韩K联', 'kleague': '韩K联', 'koreakleague1': '韩K联',
  'kleague2': '韩K2联', 'koreakleague2': '韩K2联',
  'kfa cup': '韩国杯', 'koreanfa cup': '韩国杯',
  'chinesesuperleague': '中超', 'csl': '中超',
  'chineseleagueone': '中甲', 'china leagueone': '中甲',
  'chinesefacup': '足协杯', 'chinafacup': '足协杯',
  'saudi pro league': '沙特联', 'spl': '沙特联', 'saudiarabianproleague': '沙特联',
  'uae pro league': '阿联酋超', 'uaeproleague': '阿联酋超',
  'qatar stars league': '卡塔尔联', 'qatarstarsleague': '卡塔尔联',
  'iran pro league': '伊朗超', 'iranproleague': '伊朗超',
  'iraq premier league': '伊拉克超', 'iraqpremierleague': '伊拉克超',
  'thai premier league': '泰超', 'thaileague1': '泰超',
  'vietnam v.league1': '越南联', 'vleague1': '越南联',
  'malaysiasuperleague': '马来超', 'malaysiasuperleague': '马来超',
  'indonesialiga1': '印尼超', 'liga1indonesia': '印尼超',
  'indiansuperleague': '印度超', 'isl': '印度超',
  'a-league': '澳超', 'aleague': '澳超', 'australiana-league': '澳超',
  'newzealandfootballchampionship': '新西兰超',
  // 美洲联赛
  'mls': '美职联', 'majorleaguesoccer': '美职联',
  'uslchampionship': '美冠', 'usl': '美冠',
  'ligamx': '墨超', 'mexicanligamx': '墨超',
  'brazilianSerieA': '巴甲', 'brasileirao': '巴甲', 'seriea brazil': '巴甲',
  'brazilianSerieB': '巴乙', 'brasileiraoserieb': '巴乙',
  'argentineprimera': '阿甲', 'argentineprimeradivision': '阿甲',
  'colombianprimeraa': '哥甲', 'colombianligabetplay': '哥甲',
  'chileanprimeradivision': '智甲', 'chileanprimera': '智甲',
  'peruvianprimeradivision': '秘鲁甲', 'peruvianliga1': '秘鲁甲',
  'ecuadorianseriea': '厄瓜多尔甲', 'ecuadorianligapro': '厄瓜多尔甲',
  'bolivianprimeradivision': '玻甲', 'bolivianligapro': '玻甲',
  'paraguayanprimeradivision': '巴拉圭甲', 'paraguayandivisionprofesional': '巴拉圭甲',
  'uruguayanprimeradivision': '乌拉甲', 'uruguayanligaprofesional': '乌拉甲',
  'venezuelanprimeradivision': '委甲', 'venezuelanligafutve': '委甲',
  'concacafchampionsleague': '中北美冠', 'concacafchampionscup': '中北美冠',
  'copalibertadores': '解放者杯', 'libertadores': '解放者杯',
  'copasudamericana': '南美杯', 'sudamericana': '南美杯',
  // 非洲联赛
  'egyptianpremierleague': '埃及超', 'egyptianpremierleague': '埃及超',
  'southafricanpremierleague': '南非超', 'dstvpremiership': '南非超',
  'nigerianprofessionalfootballleague': '尼日超', 'npfl': '尼日超',
  'moroccanbotola': '摩洛哥超', 'botola': '摩洛哥超',
  'tunisianligue1': '突尼斯甲', 'tunisianligueprofessionnelle1': '突尼斯甲',
  'algerianligue1': '阿尔及利亚甲', 'algerianligueprofessionnelle1': '阿尔及利亚甲',
  'kenyanpremierleague': '肯尼亚超', 'kenyanpremierleague': '肯尼亚超',
  'ghananpremierleague': '加纳超', 'ghanapremierleague': '加纳超',
  'senegaleseligue1': '塞内加尔甲', 'senegalligue1': '塞内加尔甲',
  'camerooneliteone': '喀麦隆甲', 'camerooneliteone': '喀麦隆甲',
  'ivorycoastligue1': '科特迪瓦甲', 'cotedivoireligue1': '科特迪瓦甲',
  'ca fchampionsleague': '非冠', 'cafchampionsleague': '非冠',
  'cafconfederationcup': '非联杯', 'cafconfederationcup': '非联杯',
};

function normalizeNameKey(name){
  let s = (name || '').toString().toLowerCase();
  // 特殊字符转换
  const charMap = {'ç':'c','ñ':'n','ä':'a','ö':'o','ü':'u','ß':'ss','à':'a','á':'a','â':'a','ã':'a','å':'a','æ':'ae','è':'e','é':'e','ê':'e','ë':'e','ì':'i','í':'i','î':'i','ï':'i','ð':'d','ò':'o','ó':'o','ô':'o','õ':'o','ø':'o','ù':'u','ú':'u','û':'u','ý':'y','þ':'th','ÿ':'y','ą':'a','ć':'c','č':'c','ď':'d','ę':'e','ě':'e','ĺ':'l','ł':'l','ń':'n','ő':'o','ř':'r','ś':'s','š':'s','ť':'t','ų':'u','ű':'u','ź':'z','ż':'z','ž':'z'};
  for(const k in charMap){
    s = s.replace(new RegExp(k, 'g'), charMap[k]);
  }
  return s.replace(/[^a-z0-9一-龥]/g, '');
}

function normalizeTeamName(name){
  if(!name) return name;
  const key = normalizeNameKey(name);
  // 如果已经是中文，直接返回
  if(/[一-龥]/.test(name) && !TEAM_NAME_LIB[key]){
    // 自动学习：中文名字直接加入
    TEAM_NAME_LIB[key] = name;
    saveNameLib();
    return name;
  }
  // 从名字库查找
  if(TEAM_NAME_LIB[key]){
    return TEAM_NAME_LIB[key];
  }
  // 没找到，返回原名，并自动学习
  TEAM_NAME_LIB[key] = name;
  saveNameLib();
  return name;
}

function normalizeLeagueName(name){
  if(!name) return name;
  const key = normalizeNameKey(name);
  // 如果已经是中文，直接返回
  if(/[一-龥]/.test(name) && !LEAGUE_NAME_LIB[key]){
    LEAGUE_NAME_LIB[key] = name;
    saveNameLib();
    return name;
  }
  // 从名字库查找
  if(LEAGUE_NAME_LIB[key]){
    return LEAGUE_NAME_LIB[key];
  }
  // 没找到，返回原名，并自动学习
  LEAGUE_NAME_LIB[key] = name;
  saveNameLib();
  return name;
}

function learnTeamName(alias, standardName){
  const key = normalizeNameKey(alias);
  TEAM_NAME_LIB[key] = standardName;
  saveNameLib();
}

function learnLeagueName(alias, standardName){
  const key = normalizeNameKey(alias);
  LEAGUE_NAME_LIB[key] = standardName;
  saveNameLib();
}

// 保存名字库到文件
function saveNameLib(){
  try{
    const savePath = path.join(__dirname, '..', '..', 'data', 'name_lib.json');
    ensureDir(path.dirname(savePath));
    fs.writeFileSync(savePath, JSON.stringify({teams: TEAM_NAME_LIB, leagues: LEAGUE_NAME_LIB}, null, 2), 'utf-8');
  }catch(e){}
}

// 从文件加载名字库
try{
  const loadPath = path.join(__dirname, '..', '..', 'data', 'name_lib.json');
  if(fs.existsSync(loadPath)){
    const data = JSON.parse(fs.readFileSync(loadPath, 'utf-8'));
    if(data.teams) Object.assign(TEAM_NAME_LIB, data.teams);
    if(data.leagues) Object.assign(LEAGUE_NAME_LIB, data.leagues);
    console.log('  名字库已加载: 球队' + Object.keys(TEAM_NAME_LIB).length + '条, 联赛' + Object.keys(LEAGUE_NAME_LIB).length + '条');
  }
}catch(e){}
// ==================== 名字库结束 ====================

// ============================================================
// 球员能力学习与状态跟踪机制
// 核心功能：
// 1. 球员名字翻译（中文↔英文↔拼音）
// 2. 球员能力学习（根据比赛表现调整能力值）
// 3. 球员状态跟踪（伤病、疲劳、近期表现）
// 4. 跨球队关联（俱乐部球员→国家队）
// ============================================================

const PLAYER_DB_PATH = path.join(__dirname, '..', '..', 'data', 'db2_master', 'players', 'player_db.json');
const PLAYER_NAME_LIB_PATH = path.join(__dirname, '..', '..', 'data', 'db2_master', 'players', 'player_name_lib.json');

// 球员名字库（中文↔英文↔拼音映射，自动学习）
let PLAYER_NAME_LIB = {};

// 球员数据库
let PLAYER_DB = {};

// 加载球员名字库
try {
  if (fs.existsSync(PLAYER_NAME_LIB_PATH)) {
    PLAYER_NAME_LIB = JSON.parse(fs.readFileSync(PLAYER_NAME_LIB_PATH, 'utf-8'));
    console.log('  球员名字库已加载: ' + Object.keys(PLAYER_NAME_LIB).length + '条');
  }
} catch (e) {}

// 加载球员数据库
try {
  if (fs.existsSync(PLAYER_DB_PATH)) {
    PLAYER_DB = JSON.parse(fs.readFileSync(PLAYER_DB_PATH, 'utf-8'));
    console.log('  球员数据库已加载: ' + Object.keys(PLAYER_DB).length + '名球员');
  }
} catch (e) {}

// 保存球员名字库
function savePlayerNameLib() {
  try {
    ensureDir(path.dirname(PLAYER_NAME_LIB_PATH));
    fs.writeFileSync(PLAYER_NAME_LIB_PATH, JSON.stringify(PLAYER_NAME_LIB, null, 2), 'utf-8');
  } catch (e) {}
}

// 保存球员数据库
function savePlayerDB() {
  try {
    ensureDir(path.dirname(PLAYER_DB_PATH));
    fs.writeFileSync(PLAYER_DB_PATH, JSON.stringify(PLAYER_DB, null, 2), 'utf-8');
  } catch (e) {}
}

// 球员名字规范化（转成小写、去特殊字符、去空格）
function normalizePlayerName(name) {
  if (!name) return '';
  return String(name).toLowerCase()
    .replace(/[\.\,\'\-]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

// 球员名字翻译：返回标准中文名
function translatePlayerName(name, teamContext = '') {
  if (!name) return name;
  
  const key = normalizePlayerName(name);
  
  // 如果已经是中文，直接返回
  if (/[\u4e00-\u9fa5]/.test(name)) {
    if (!PLAYER_NAME_LIB[key]) {
      PLAYER_NAME_LIB[key] = { zh: name, en: '', aliases: [], team: teamContext };
      savePlayerNameLib();
    }
    return name;
  }
  
  // 从名字库查找
  if (PLAYER_NAME_LIB[key] && PLAYER_NAME_LIB[key].zh) {
    return PLAYER_NAME_LIB[key].zh;
  }
  
  // 没找到，返回原名，并自动学习
  if (!PLAYER_NAME_LIB[key]) {
    PLAYER_NAME_LIB[key] = { zh: name, en: name, aliases: [], team: teamContext };
    savePlayerNameLib();
  }
  
  return name;
}

// 学习球员名字映射
function learnPlayerName(alias, standardZhName, teamContext = '') {
  const key = normalizePlayerName(alias);
  if (!PLAYER_NAME_LIB[key]) {
    PLAYER_NAME_LIB[key] = { zh: standardZhName, en: alias, aliases: [], team: teamContext };
  } else {
    PLAYER_NAME_LIB[key].zh = standardZhName;
    if (teamContext) PLAYER_NAME_LIB[key].team = teamContext;
  }
  if (alias !== standardZhName && !PLAYER_NAME_LIB[key].aliases.includes(alias)) {
    PLAYER_NAME_LIB[key].aliases.push(alias);
  }
  savePlayerNameLib();
}


// ============================================================
// 百度翻译API：自动翻译球员名字为中文
// 配置：GitHub Secrets 中设置 BAIDU_TRANSLATE_APP_ID 和 BAIDU_TRANSLATE_SECRET_KEY
// 免费额度：标准版每月200万字符
// ============================================================
const BAIDU_APP_ID = process.env.BAIDU_TRANSLATE_APP_ID || '';
const BAIDU_SECRET_KEY = process.env.BAIDU_TRANSLATE_SECRET_KEY || '';
const BAIDU_TRANSLATE_ENABLED = !!(BAIDU_APP_ID && BAIDU_SECRET_KEY);

// MD5签名（百度翻译API要求）
function md5(str) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(str, 'utf-8').digest('hex');
}

// 调用百度翻译API（支持批量翻译，用换行分隔）
async function baiduTranslate(text, from = 'en', to = 'zh') {
  if (!BAIDU_TRANSLATE_ENABLED || !text) return null;
  
  try {
    const salt = Date.now().toString();
    const sign = md5(BAIDU_APP_ID + text + salt + BAIDU_SECRET_KEY);
    const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
    const params = new URLSearchParams({
      q: text,
      from: from,
      to: to,
      appid: BAIDU_APP_ID,
      salt: salt,
      sign: sign
    });
    
    const response = await fetch(url + '?' + params.toString(), {
      method: 'GET',
      timeout: 10000
    });
    
    const data = await response.json();
    
    if (data.error_code) {
      console.log('  百度翻译错误: ' + data.error_code + ' ' + data.error_msg);
      return null;
    }
    
    if (data.trans_result && data.trans_result.length > 0) {
      return data.trans_result.map(item => item.dst);
    }
    
    return null;
  } catch (e) {
    console.log('  百度翻译调用失败: ' + e.message);
    return null;
  }
}

// 批量翻译球员名字（每次最多50个，避免超限）
async function translatePlayerNamesBatch(playerNames, teamContext = '') {
  if (!BAIDU_TRANSLATE_ENABLED || playerNames.length === 0) return 0;
  
  // 过滤掉已经有中文翻译的名字
  const needTranslate = [];
  for (const name of playerNames) {
    const key = normalizePlayerName(name);
    if (!PLAYER_NAME_LIB[key] || !PLAYER_NAME_LIB[key].zh || PLAYER_NAME_LIB[key].zh === name) {
      // 排除已经是中文的名字
      if (!/[\u4e00-\u9fa5]/.test(name)) {
        needTranslate.push(name);
      }
    }
  }
  
  if (needTranslate.length === 0) {
    console.log('  所有球员名字已有中文翻译，无需翻译');
    return 0;
  }
  
  console.log('  需要翻译 ' + needTranslate.length + ' 个球员名字');
  
  // 分批翻译，每批最多50个
  const batchSize = 50;
  let translatedCount = 0;
  
  for (let i = 0; i < needTranslate.length; i += batchSize) {
    const batch = needTranslate.slice(i, i + batchSize);
    const text = batch.join('\n');
    
    console.log('  翻译第 ' + (i / batchSize + 1) + ' 批，' + batch.length + ' 个名字...');
    
    const results = await baiduTranslate(text);
    
    if (results && results.length === batch.length) {
      for (let j = 0; j < batch.length; j++) {
        const originalName = batch[j];
        const translatedName = results[j].trim();
        
        if (translatedName && translatedName !== originalName) {
          learnPlayerName(originalName, translatedName, teamContext);
          translatedCount++;
        }
      }
      console.log('  本批翻译成功 ' + translatedCount + ' 个');
    } else {
      console.log('  本批翻译失败或结果不匹配');
    }
    
    // 避免调用太频繁，每批之间等待1秒
    if (i + batchSize < needTranslate.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('  百度翻译完成，共翻译 ' + translatedCount + ' 个球员名字');
  return translatedCount;
}

// 从比赛阵容中提取所有球员名字并翻译
async function translatePlayersFromLineups(lineupsData) {
  if (!BAIDU_TRANSLATE_ENABLED || !lineupsData) return 0;
  
  const allPlayerNames = new Set();
  
  try {
    // 从API-Football格式的阵容中提取球员名字
    if (lineupsData.response && Array.isArray(lineupsData.response)) {
      for (const team of lineupsData.response) {
        const teamName = team.team ? team.team.name : '';
        
        // 首发阵容
        if (team.startXI && Array.isArray(team.startXI)) {
          for (const item of team.startXI) {
            if (item.player && item.player.name) {
              allPlayerNames.add(item.player.name);
            }
          }
        }
        
        // 替补阵容
        if (team.substitutes && Array.isArray(team.substitutes)) {
          for (const item of team.substitutes) {
            if (item.player && item.player.name) {
              allPlayerNames.add(item.player.name);
            }
          }
        }
        
        // 教练
        if (team.coach && team.coach.name) {
          allPlayerNames.add(team.coach.name);
        }
      }
    }
    
    // 从ESPN格式的阵容中提取
    if (lineupsData.home && lineupsData.away) {
      for (const side of ['home', 'away']) {
        const team = lineupsData[side];
        const teamName = team.team || '';
        
        if (team.starters && Array.isArray(team.starters)) {
          for (const player of team.starters) {
            if (player.name) allPlayerNames.add(player.name);
          }
        }
        
        if (team.substitutes && Array.isArray(team.substitutes)) {
          for (const player of team.substitutes) {
            if (player.name) allPlayerNames.add(player.name);
          }
        }
      }
    }
  } catch (e) {
    console.log('  提取球员名字失败: ' + e.message);
  }
  
  if (allPlayerNames.size === 0) return 0;
  
  console.log('  从阵容中提取到 ' + allPlayerNames.size + ' 个球员名字');
  return await translatePlayerNamesBatch(Array.from(allPlayerNames));
}

console.log('百度翻译API: ' + (BAIDU_TRANSLATE_ENABLED ? '已启用' : '未配置（设置 BAIDU_TRANSLATE_APP_ID 和 BAIDU_TRANSLATE_SECRET_KEY 后启用）'));
// ==================== 百度翻译API结束 ====================


// 根据球队级别估算球员初始能力值
function estimateInitialAbility(playerName, position, teamName, teamTier) {
  // 基础能力值根据球队级别
  const baseAbility = {
    'S': 82, 'A': 75, 'B': 68, 'C': 60
  };
  
  const base = baseAbility[teamTier] || 65;
  
  // 根据位置微调
  let ability = {
    overall: base,
    attacking: base,
    defending: base,
    passing: base,
    shooting: base,
    speed: base + 2,
    physical: base
  };
  
  if (position) {
    const pos = position.toLowerCase();
    if (pos.includes('forward') || pos.includes('striker') || pos.includes('前锋') || pos.includes('中锋')) {
      ability.attacking = base + 5;
      ability.shooting = base + 8;
      ability.defending = base - 10;
    } else if (pos.includes('midfielder') || pos.includes('中场') || pos.includes('前卫')) {
      ability.passing = base + 6;
      ability.attacking = base + 2;
      ability.defending = base + 2;
    } else if (pos.includes('defender') || pos.includes('后卫') || pos.includes('back')) {
      ability.defending = base + 8;
      ability.attacking = base - 8;
      ability.physical = base + 3;
    } else if (pos.includes('goalkeeper') || pos.includes('门将') || pos.includes('守门员')) {
      ability.defending = base + 10;
      ability.physical = base + 5;
      ability.attacking = base - 15;
      ability.shooting = base - 15;
    }
  }
  
  return ability;
}

// 获取或创建球员记录
function getOrCreatePlayer(playerName, teamName = '', position = '', teamTier = 'B') {
  const zhName = translatePlayerName(playerName, teamName);
  const key = normalizePlayerName(zhName);
  
  if (!PLAYER_DB[key]) {
    PLAYER_DB[key] = {
      id: key,
      name: zhName,
      name_en: /[\u4e00-\u9fa5]/.test(playerName) ? '' : playerName,
      aliases: [],
      team: teamName,
      nationality: '',
      position: position,
      ability: estimateInitialAbility(playerName, position, teamName, teamTier),
      form: {
        recent_matches: 0,
        avg_rating: 6.5,
        goals: 0,
        assists: 0,
        yellow_cards: 0,
        red_cards: 0,
        trend: 'stable'
      },
      status: {
        injured: false,
        injury_type: '',
        suspended: false,
        suspension_reason: '',
        fatigue: 30,
        last_match: '',
        consecutive_matches: 0
      },
      clubs: teamName ? [teamName] : [],
      national_team: '',
      learn_count: 0,
      last_updated: new Date().toISOString()
    };
  }
  
  // 更新所属球队
  if (teamName && !PLAYER_DB[key].clubs.includes(teamName)) {
    PLAYER_DB[key].clubs.push(teamName);
    PLAYER_DB[key].team = teamName;
  }
  if (position && !PLAYER_DB[key].position) {
    PLAYER_DB[key].position = position;
  }
  
  return PLAYER_DB[key];
}

// 球员能力学习：根据比赛表现调整能力值
function learnPlayerAbility(playerKey, performance) {
  const player = PLAYER_DB[playerKey];
  if (!player) return;
  
  player.learn_count++;
  
  // 学习率：随着学习次数增加，调整幅度减小（收敛）
  const learningRate = Math.max(0.02, 0.1 / (1 + player.learn_count * 0.05));
  
  // 评分影响整体能力
  if (performance.rating !== undefined && performance.rating > 0) {
    const ratingDiff = (performance.rating - 6.5) * 2; // 6.5分为基准
    player.ability.overall += ratingDiff * learningRate;
    player.ability.overall = Math.max(40, Math.min(99, player.ability.overall));
  }
  
  // 进球影响进攻和射门
  if (performance.goals > 0) {
    player.ability.attacking += performance.goals * 0.5 * learningRate * 10;
    player.ability.shooting += performance.goals * 0.8 * learningRate * 10;
    player.form.goals += performance.goals;
  }
  
  // 助攻影响传球
  if (performance.assists > 0) {
    player.ability.passing += performance.assists * 0.6 * learningRate * 10;
    player.form.assists += performance.assists;
  }
  
  // 防守表现影响防守能力
  if (performance.defensive_actions !== undefined) {
    player.ability.defending += (performance.defensive_actions - 3) * 0.3 * learningRate * 10;
  }
  
  // 红黄牌记录
  if (performance.yellow_card) player.form.yellow_cards++;
  if (performance.red_card) {
    player.form.red_cards++;
    player.status.suspended = true;
    player.status.suspension_reason = '红牌停赛';
  }
  
  // 更新近期状态
  player.form.recent_matches++;
  if (performance.rating) {
    player.form.avg_rating = (player.form.avg_rating * (player.form.recent_matches - 1) + performance.rating) / player.form.recent_matches;
  }
  
  // 状态趋势
  if (performance.rating > 7.5) player.form.trend = 'up';
  else if (performance.rating < 5.5) player.form.trend = 'down';
  else player.form.trend = 'stable';
  
  // 更新疲劳度
  if (performance.minutes_played > 60) {
    player.status.fatigue = Math.min(100, player.status.fatigue + 15);
  } else if (performance.minutes_played > 0) {
    player.status.fatigue = Math.min(100, player.status.fatigue + 5);
  }
  player.status.last_match = performance.match_date || new Date().toISOString().slice(0, 10);
  player.status.consecutive_matches++;
  
  // 疲劳度自然恢复（每天减10）
  // 这个在每次加载时根据last_match计算
  
  player.last_updated = new Date().toISOString();
}

// 更新球员伤病状态
function updatePlayerInjury(playerKey, injuryInfo) {
  const player = PLAYER_DB[playerKey];
  if (!player) return;
  
  player.status.injured = injuryInfo.injured || false;
  player.status.injury_type = injuryInfo.type || '';
  if (injuryInfo.expected_return) {
    player.status.expected_return = injuryInfo.expected_return;
  }
  player.last_updated = new Date().toISOString();
}

// 计算球队整体能力（考虑球员能力和状态）
function calculateTeamAbility(teamName, players = []) {
  if (players.length === 0) {
    // 从球员数据库中查找该球队的球员
    for (const key in PLAYER_DB) {
      if (PLAYER_DB[key].team === teamName || PLAYER_DB[key].clubs.includes(teamName)) {
        players.push(PLAYER_DB[key]);
      }
    }
  }
  
  if (players.length === 0) {
    return { overall: 65, attacking: 65, defending: 65, depth: 0 };
  }
  
  // 计算首发11人的平均能力（如果有首发数据）
  // 否则取能力最高的11人
  const sortedPlayers = players.sort((a, b) => b.ability.overall - a.ability.overall);
  const topPlayers = sortedPlayers.slice(0, 11);
  
  let overall = 0, attacking = 0, defending = 0, passing = 0;
  let statusFactor = 0;
  
  for (const p of topPlayers) {
    overall += p.ability.overall;
    attacking += p.ability.attacking;
    defending += p.ability.defending;
    passing += p.ability.passing;
    
    // 状态修正：伤病减20%，疲劳超过70减10%，状态好加5%
    let factor = 1;
    if (p.status.injured) factor -= 0.2;
    if (p.status.fatigue > 70) factor -= 0.1;
    if (p.form.trend === 'up') factor += 0.05;
    if (p.form.trend === 'down') factor -= 0.05;
    statusFactor += factor;
  }
  
  const count = topPlayers.length;
  statusFactor = statusFactor / count;
  
  return {
    overall: Math.round((overall / count) * statusFactor),
    attacking: Math.round((attacking / count) * statusFactor),
    defending: Math.round((defending / count) * statusFactor),
    passing: Math.round((passing / count) * statusFactor),
    depth: players.length,
    status_factor: Math.round(statusFactor * 100) / 100,
    top_players: topPlayers.slice(0, 5).map(p => ({
      name: p.name,
      position: p.position,
      ability: Math.round(p.ability.overall),
      form: p.form.trend,
      injured: p.status.injured,
      fatigue: p.status.fatigue
    }))
  };
}

// 跨球队关联：获取国家队球员的俱乐部表现
function getNationalTeamPlayersWithClubForm(nationalTeamName) {
  const result = [];
  
  for (const key in PLAYER_DB) {
    const player = PLAYER_DB[key];
    if (player.national_team === nationalTeamName) {
      // 找到该球员的俱乐部
      const club = player.clubs.find(c => c !== nationalTeamName) || player.team;
      result.push({
        ...player,
        club: club,
        club_form: player.form,
        club_ability: player.ability
      });
    }
  }
  
  return result;
}

// 从比赛阵容中学习球员
function learnPlayersFromLineups(matchId, homeTeam, awayTeam, lineups, teamTier) {
  if (!lineups) return;
  
  const teams = [
    { name: homeTeam, data: lineups.home || lineups[0] },
    { name: awayTeam, data: lineups.away || lineups[1] }
  ];
  
  for (const team of teams) {
    if (!team.data) continue;
    
    const players = team.data.startXI || team.data.players || [];
    for (const p of players) {
      const playerName = p.player?.name || p.name || '';
      const position = p.player?.position || p.position || '';
      const number = p.player?.number || p.number;
      
      if (playerName) {
        const player = getOrCreatePlayer(playerName, team.name, position, teamTier);
        // 记录球衣号码
        if (number && !player.jersey_number) {
          player.jersey_number = number;
        }
      }
    }
    
    // 替补球员
    const substitutes = team.data.substitutes || [];
    for (const p of substitutes) {
      const playerName = p.player?.name || p.name || '';
      const position = p.player?.position || p.position || '';
      if (playerName) {
        getOrCreatePlayer(playerName, team.name, position, teamTier);
      }
    }
  }
}

// 从伤停名单中学习球员状态
function learnPlayersFromInjuries(injuries, teamName) {
  if (!injuries || !Array.isArray(injuries)) return;
  
  for (const inj of injuries) {
    const playerName = inj.player?.name || inj.name || '';
    if (playerName) {
      const player = getOrCreatePlayer(playerName, teamName, inj.player?.position || '');
      updatePlayerInjury(player.id, {
        injured: true,
        type: inj.type || inj.reason || '受伤',
        expected_return: inj.expected_return || ''
      });
    }
  }
}

// 定期保存球员数据
function savePlayerData() {
  savePlayerNameLib();
  savePlayerDB();
}

// ==================== 球员学习模块结束 ====================





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
  
  const apiKey = CONFIG.apis.apiFootball.key;
  if (!apiKey || apiKey === 'your_api_football_key') {
    console.log('  API-Football密钥未配置，跳过');
    return detailCache;
  }
  
  const needSupplement = allMatches.filter(m => {
    const tier = getMatchTier(m);
    return (tier === 'S' || tier === 'A') && shouldSupplement(m);
  });
  
  console.log(`  需要补充的S/A级比赛: ${needSupplement.length} 场`);
  
  const toFetch = needSupplement.slice(0, CONFIG.maxApiFootballPerRun);
  console.log(`  本次计划补充: ${toFetch.length} 场`);
  
  // 先获取今天的所有比赛（1次调用，获取fixture_id映射）
  const { today } = getDates();
  let fixtureMap = {};
  try {
    console.log('  正在获取API-Football今日比赛列表...');
    const fixturesData = await fetchJson(
      `${CONFIG.apis.apiFootball.base}/fixtures?date=${today}`,
      { 'x-apisports-key': apiKey }
    );
    QuotaManager.consume('apiFootball');
    
    if (fixturesData && fixturesData.response) {
      for (const fx of fixturesData.response) {
        const homeName = normalizeNameKey(fx.teams?.home?.name || '');
        const awayName = normalizeNameKey(fx.teams?.away?.name || '');
        const key = homeName + '_vs_' + awayName;
        fixtureMap[key] = {
          fixtureId: fx.fixture?.id,
          homeName: fx.teams?.home?.name,
          awayName: fx.teams?.away?.name,
          homeScore: fx.goals?.home,
          awayScore: fx.goals?.away,
          status: fx.fixture?.status?.short,
          elapsed: fx.fixture?.status?.elapsed,
          league: fx.league?.name,
          country: fx.league?.country
        };
        // 自动学习队名映射
        if (fx.teams?.home?.name) {
          const zhName = normalizeTeamName(fx.teams.home.name);
          if (zhName !== fx.teams.home.name) {
            learnTeamName(fx.teams.home.name, zhName);
          }
        }
        if (fx.teams?.away?.name) {
          const zhName = normalizeTeamName(fx.teams.away.name);
          if (zhName !== fx.teams.away.name) {
            learnTeamName(fx.teams.away.name, zhName);
          }
        }
      }
      saveNameLib();
      console.log('  获取到' + Object.keys(fixtureMap).length + '场比赛的fixture_id映射');
    }
  } catch (e) {
    console.log(`  获取比赛列表失败: ${e.message}`);
  }
  
  let supplementedCount = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const match = toFetch[i];
    const eventId = match.event_id;
    const tier = getMatchTier(m);
    
    if (!QuotaManager.canUse('apiFootball')) {
      console.log('  API-Football预算已用完，停止');
      break;
    }
    
    if (detailCache[eventId] && detailCache[eventId]._apiFootballFetched) {
      console.log(`  [${i+1}/${toFetch.length}] [${tier}级] ${match.home_team_zh} vs ${match.away_team_zh} - 已有数据，跳过`);
      continue;
    }
    
    // 队名匹配：用云端API的队名查找fixture_id
    const homeKey = normalizeNameKey(match.home_team_zh || match.home_team || '');
    const awayKey = normalizeNameKey(match.away_team_zh || match.away_team || '');
    const matchKey = homeKey + '_vs_' + awayKey;
    const reverseKey = awayKey + '_vs_' + homeKey;
    
    let fixtureInfo = fixtureMap[matchKey] || fixtureMap[reverseKey];
    
    // 如果没找到，尝试用名字库反向查找英文队名
    if (!fixtureInfo) {
      for (const key in fixtureMap) {
        const info = fixtureMap[key];
        const infoHomeKey = normalizeNameKey(info.homeName || '');
        const infoAwayKey = normalizeNameKey(info.awayName || '');
        // 检查是否有队名能匹配上
        if ((TEAM_NAME_LIB[homeKey] === info.homeName || TEAM_NAME_LIB[infoHomeKey] === match.home_team_zh) &&
            (TEAM_NAME_LIB[awayKey] === info.awayName || TEAM_NAME_LIB[infoAwayKey] === match.away_team_zh)) {
          fixtureInfo = info;
          break;
        }
      }
    }
    
    if (!fixtureInfo || !fixtureInfo.fixtureId) {
      console.log(`  [${i+1}/${toFetch.length}] [${tier}级] ${match.home_team_zh} vs ${match.away_team_zh} - 队名匹配失败，跳过`);
      if (detailCache[eventId]) {
        detailCache[eventId]._apiFootballAttempted = true;
        detailCache[eventId]._apiFootballMatchFailed = true;
      }
      continue;
    }
    
    console.log(`  [${i+1}/${toFetch.length}] [${tier}级] ${match.home_team_zh} vs ${match.away_team_zh} - 匹配成功，获取详细数据...`);
    
    try {
      // 获取阵容（1次调用）
      if (QuotaManager.canUse('apiFootball')) {
        const lineupsData = await fetchJson(
          `${CONFIG.apis.apiFootball.base}/fixtures/lineups?fixture=${fixtureInfo.fixtureId}`,
          { 'x-apisports-key': apiKey }
        );
        QuotaManager.consume('apiFootball');
        
        if (lineupsData && lineupsData.response && lineupsData.response.length > 0) {
          if (!detailCache[eventId]) detailCache[eventId] = {};
          detailCache[eventId].lineups_apiFootball = lineupsData.response;
          detailCache[eventId]._apiFootballLineups = true;
          console.log('    ✓ 阵容数据已获取');
          
          // 从阵容中学习球员
          try {
            learnPlayersFromLineups(
              eventId,
              match.home_team_zh || match.home_team,
              match.away_team_zh || match.away_team,
              lineupsData.response,
              tier
            );
            console.log('    ✓ 已从阵容学习球员');
          } catch (e) {
            console.log('    ⚠ 球员学习失败: ' + e.message);
          }
          
          // 用百度翻译API翻译球员名字（显示用中文，内部记录还是用英文名）
          try {
            if (typeof translatePlayersFromLineups === 'function') {
              const translated = await translatePlayersFromLineups(lineupsData);
              if (translated > 0) {
                console.log('    ✓ 百度翻译已翻译 ' + translated + ' 个球员名字');
              }
            }
          } catch (e) {
            console.log('    ⚠ 球员名字翻译失败: ' + e.message);
          }
        }
      }
      
      // 获取伤停（1次调用）
      if (QuotaManager.canUse('apiFootball')) {
        const injuriesData = await fetchJson(
          `${CONFIG.apis.apiFootball.base}/injuries?fixture=${fixtureInfo.fixtureId}`,
          { 'x-apisports-key': apiKey }
        );
        QuotaManager.consume('apiFootball');
        
        if (injuriesData && injuriesData.response) {
          if (!detailCache[eventId]) detailCache[eventId] = {};
          detailCache[eventId].injuries_apiFootball = injuriesData.response;
          detailCache[eventId]._apiFootballInjuries = true;
          console.log('    ✓ 伤停数据已获取（' + injuriesData.response.length + '人）');
          
          // 从伤停名单中学习球员状态
          try {
            learnPlayersFromInjuries(injuriesData.response, match.home_team_zh || match.home_team);
            learnPlayersFromInjuries(injuriesData.response, match.away_team_zh || match.away_team);
            console.log('    ✓ 已从伤停名单更新球员状态');
          } catch (e) {
            console.log('    ⚠ 伤停球员状态更新失败: ' + e.message);
          }
        }
      }
      
      // 补充实时比分和状态
      if (fixtureInfo.homeScore !== null || fixtureInfo.awayScore !== null) {
        if (!detailCache[eventId]) detailCache[eventId] = {};
        detailCache[eventId].home_score_apiFootball = fixtureInfo.homeScore;
        detailCache[eventId].away_score_apiFootball = fixtureInfo.awayScore;
        detailCache[eventId].status_apiFootball = fixtureInfo.status;
        detailCache[eventId].elapsed_apiFootball = fixtureInfo.elapsed;
      }
      
      if (detailCache[eventId]) {
        detailCache[eventId]._apiFootballFetched = true;
        detailCache[eventId]._apiFootballFixtureId = fixtureInfo.fixtureId;
        detailCache[eventId]._sources = [...new Set([...(detailCache[eventId]._sources || []), 'api_football'])];
      }
      
      supplementedCount++;
      
    } catch (e) {
      console.log(`    ✗ 获取失败: ${e.message}`);
      if (detailCache[eventId]) {
        detailCache[eventId]._apiFootballAttempted = true;
        detailCache[eventId]._apiFootballError = e.message;
      }
    }
    
    if (i < toFetch.length - 1) await sleep(CONFIG.requestDelayMs);
  }
  
  console.log('  本次补充 ' + supplementedCount + ' 场');
  
  // 保存球员数据
  try {
    savePlayerData();
    console.log('  球员数据已保存');
  } catch (e) {}
  
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
  
  const apiKey = CONFIG.apis.bigBalls.key;
  if (!apiKey || apiKey === 'your_big_balls_key') {
    console.log('  Big Balls密钥未配置，跳过');
    return detailCache;
  }
  
  const needSupplement = allMatches.filter(m => getMatchTier(m) === 'S' && shouldSupplement(m));
  console.log('  需要补充xG的S级比赛: ' + needSupplement.length + ' 场');
  
  const toFetch = needSupplement.slice(0, CONFIG.maxBigBallsPerRun);
  console.log('  本次计划补充: ' + toFetch.length + ' 场');
  
  let supplementedCount = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const match = toFetch[i];
    const eventId = match.event_id;
    
    if (!QuotaManager.canUse('bigBalls')) {
      console.log('  Big Balls预算已用完，停止');
      break;
    }
    
    if (detailCache[eventId] && detailCache[eventId]._bigBallsFetched) {
      console.log('  [' + (i+1) + '/' + toFetch.length + '] ' + (match.home_team_zh || match.home_team) + ' vs ' + (match.away_team_zh || match.away_team) + ' - 已有xG数据，跳过');
      continue;
    }
    
    console.log('  [' + (i+1) + '/' + toFetch.length + '] ' + (match.home_team_zh || match.home_team) + ' vs ' + (match.away_team_zh || match.away_team) + ' - 补充xG数据...');
    
    try {
      // Big Balls API：用队名搜索比赛xG数据
      // 注意：具体端点可能需要根据实际API文档调整
      const homeName = encodeURIComponent(match.home_team_zh || match.home_team || '');
      const awayName = encodeURIComponent(match.away_team_zh || match.away_team || '');
      
      // 尝试多种可能的端点格式
      let xgData = null;
      const endpoints = [
        CONFIG.apis.bigBalls.base + '/api/matches/xg?home=' + homeName + '&away=' + awayName,
        CONFIG.apis.bigBalls.base + '/v1/matches/xg?home_team=' + homeName + '&away_team=' + awayName,
        CONFIG.apis.bigBalls.base + '/api/xg?team1=' + homeName + '&team2=' + awayName
      ];
      
      for (const url of endpoints) {
        if (!QuotaManager.canUse('bigBalls')) break;
        xgData = await fetchJson(url, { 'Authorization': 'Bearer ' + apiKey, 'X-API-Key': apiKey });
        QuotaManager.consume('bigBalls');
        if (xgData && (xgData.data || xgData.response || xgData.xg)) break;
        await sleep(300);
      }
      
      if (xgData && (xgData.data || xgData.response || xgData.xg)) {
        if (!detailCache[eventId]) detailCache[eventId] = {};
        detailCache[eventId].xg_bigBalls = xgData.data || xgData.response || xgData;
        detailCache[eventId]._bigBallsFetched = true;
        detailCache[eventId]._sources = [...new Set([...(detailCache[eventId]._sources || []), 'big_balls'])];
        supplementedCount++;
        console.log('    ✓ xG数据已获取');
      } else {
        console.log('    ⚠ 未获取到xG数据（端点可能不匹配，已尝试多种格式）');
        if (detailCache[eventId]) {
          detailCache[eventId]._bigBallsAttempted = true;
        }
      }
    } catch (e) {
      console.log('    ✗ 获取失败: ' + e.message);
      if (detailCache[eventId]) {
        detailCache[eventId]._bigBallsAttempted = true;
        detailCache[eventId]._bigBallsError = e.message;
      }
    }
    
    if (i < toFetch.length - 1) await sleep(CONFIG.requestDelayMs);
  }
  
  console.log('  本次补充 ' + supplementedCount + ' 场');
  return detailCache;
}

// ============================================================
// 第四步：ESPN免费数据补充（零消耗配额）
// ============================================================
async function supplementWithEspn(allMatches, detailCache) {
  console.log('\n=== [数据库2] 第四步：ESPN免费数据补充（零消耗配额）===');
  
  const { today } = getDates();
  const espnDate = today.replace(/-/g, '');
  
  // 获取ESPN今日比赛列表（免费，无配额限制）
  // ESPN需要指定联赛代码，循环获取主要联赛
  const espnLeagues = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'ned.1', 'por.1', 'tur.1'];
  let espnMatches = {};
  try {
    console.log('  正在获取ESPN今日比赛列表（' + espnLeagues.length + '个主要联赛）...');
    for (const leagueCode of espnLeagues) {
      try {
        const espnData = await fetchJson(
          CONFIG.apis.espn.base + '/' + leagueCode + '/scoreboard?dates=' + espnDate
        );
        
        if (espnData && espnData.events && espnData.events.length > 0) {
          console.log('    ' + leagueCode + ': ' + espnData.events.length + '场');
          for (const event of espnData.events) {
            const competitions = event.competitions || [];
            if (competitions.length === 0) continue;
            
            const comp = competitions[0];
            const homeTeam = comp.competitors?.find(c => c.homeAway === 'home');
            const awayTeam = comp.competitors?.find(c => c.homeAway === 'away');
            
            if (!homeTeam || !awayTeam) continue;
            
            const homeKey = normalizeNameKey(homeTeam.team?.displayName || homeTeam.team?.name || '');
            const awayKey = normalizeNameKey(awayTeam.team?.displayName || awayTeam.team?.name || '');
            const matchKey = homeKey + '_vs_' + awayKey;
            
            espnMatches[matchKey] = {
              eventId: event.id,
              homeName: homeTeam.team?.displayName,
              awayName: awayTeam.team?.displayName,
              homeScore: homeTeam.score,
              awayScore: awayTeam.score,
              status: event.status?.type?.description,
              statusShort: event.status?.type?.shortDetail,
              elapsed: event.status?.type?.elapsed,
              league: event.league?.name,
              venue: comp.venue?.fullName,
              weather: comp.weather?.displayValue,
              homeTeamId: homeTeam.team?.id,
              awayTeamId: awayTeam.team?.id
            };
            
            // 自动学习队名映射
            if (homeTeam.team?.displayName) {
              const zhName = normalizeTeamName(homeTeam.team.displayName);
              if (zhName !== homeTeam.team.displayName) {
                learnTeamName(homeTeam.team.displayName, zhName);
              }
            }
            if (awayTeam.team?.displayName) {
              const zhName = normalizeTeamName(awayTeam.team.displayName);
              if (zhName !== awayTeam.team.displayName) {
                learnTeamName(awayTeam.team.displayName, zhName);
              }
            }
          }
        }
      } catch (e) {
        // 单个联赛获取失败不影响其他联赛
      }
      await sleep(200);
    }
    saveNameLib();
    console.log('  共获取到' + Object.keys(espnMatches).length + '场ESPN比赛');
  } catch (e) {
    console.log('  获取ESPN比赛列表失败: ' + e.message);
  }
  
  let supplementedCount = 0;
  for (const match of allMatches) {
    const eventId = match.event_id;
    
    // 队名匹配
    const homeKey = normalizeNameKey(match.home_team_zh || match.home_team || '');
    const awayKey = normalizeNameKey(match.away_team_zh || match.away_team || '');
    const matchKey = homeKey + '_vs_' + awayKey;
    const reverseKey = awayKey + '_vs_' + homeKey;
    
    let espnInfo = espnMatches[matchKey] || espnMatches[reverseKey];
    
    // 如果没找到，尝试用名字库反向查找
    if (!espnInfo) {
      for (const key in espnMatches) {
        const info = espnMatches[key];
        const infoHomeKey = normalizeNameKey(info.homeName || '');
        const infoAwayKey = normalizeNameKey(info.awayName || '');
        if ((TEAM_NAME_LIB[homeKey] === info.homeName || TEAM_NAME_LIB[infoHomeKey] === match.home_team_zh) &&
            (TEAM_NAME_LIB[awayKey] === info.awayName || TEAM_NAME_LIB[infoAwayKey] === match.away_team_zh)) {
          espnInfo = info;
          break;
        }
      }
    }
    
    if (!espnInfo) continue;
    
    if (!detailCache[eventId]) detailCache[eventId] = {};
    
    // 补充实时比分和状态（ESPN数据比较及时）
    if (espnInfo.homeScore !== null && espnInfo.homeScore !== undefined) {
      detailCache[eventId].home_score_espn = parseInt(espnInfo.homeScore) || 0;
      detailCache[eventId].away_score_espn = parseInt(espnInfo.awayScore) || 0;
    }
    detailCache[eventId].status_espn = espnInfo.status;
    detailCache[eventId].status_short_espn = espnInfo.statusShort;
    if (espnInfo.elapsed) detailCache[eventId].elapsed_espn = espnInfo.elapsed;
    
    // 补充天气和场馆
    if (espnInfo.weather) detailCache[eventId].weather_espn = espnInfo.weather;
    if (espnInfo.venue) detailCache[eventId].venue_espn = espnInfo.venue;
    
    detailCache[eventId]._espnFetched = true;
    detailCache[eventId]._espnEventId = espnInfo.eventId;
    detailCache[eventId]._sources = [...new Set([...(detailCache[eventId]._sources || []), 'espn'])];
    
    supplementedCount++;
  }
  
  console.log('  本次补充 ' + supplementedCount + ' 场ESPN数据');
  return detailCache;
}

// ============================================================
// 第五步：保存融合后的详情到数据库2
// ============================================================
async function saveMergedDetails(detailCache) {
  console.log('\n=== [数据库2] 第五步：保存融合后的详情 ===');
  
  // 为每场比赛计算球队整体能力（基于球员能力和状态）
  let teamAbilityCalculated = 0;
  for (const eventId in detailCache) {
    const detail = detailCache[eventId];
    const homeTeam = detail.home_team_zh || detail.home_team || '';
    const awayTeam = detail.away_team_zh || detail.away_team || '';
    
    if (homeTeam && awayTeam) {
      try {
        const homeAbility = calculateTeamAbility(homeTeam);
        const awayAbility = calculateTeamAbility(awayTeam);
        
        detail.team_ability = {
          home: homeAbility,
          away: awayAbility,
          diff: homeAbility.overall - awayAbility.overall
        };
        
        // 跨球队关联：如果是国家队比赛，关联俱乐部球员表现
        if (homeTeam.length <= 4 || homeTeam.indexOf('国家队') >= 0) {
          const homeNationalPlayers = getNationalTeamPlayersWithClubForm(homeTeam);
          if (homeNationalPlayers.length > 0) {
            detail.national_team_players = detail.national_team_players || {};
            detail.national_team_players.home = homeNationalPlayers.slice(0, 11);
          }
        }
        if (awayTeam.length <= 4 || awayTeam.indexOf('国家队') >= 0) {
          const awayNationalPlayers = getNationalTeamPlayersWithClubForm(awayTeam);
          if (awayNationalPlayers.length > 0) {
            detail.national_team_players = detail.national_team_players || {};
            detail.national_team_players.away = awayNationalPlayers.slice(0, 11);
          }
        }
        
        teamAbilityCalculated++;
      } catch (e) {
        // 单场计算失败不影响其他
      }
    }
  }
  
  saveJson(path.join(CONFIG.db2Dir, 'current', 'match_details.json'), detailCache);
  console.log('  已保存 ' + Object.keys(detailCache).length + ' 场融合详情到数据库2');
  if (teamAbilityCalculated > 0) {
    console.log('  已计算 ' + teamAbilityCalculated + ' 场比赛的球队整体能力');
  }
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
  // 全局错误处理：捕获所有未处理的Promise rejection，不让脚本崩溃
  process.on('unhandledRejection', (reason, promise) => {
    console.error('\n⚠️  捕获到未处理的Promise rejection（已忽略，不影响继续运行）:');
    console.error('  ', reason?.message || reason);
  });
  
  process.on('uncaughtException', (err) => {
    console.error('\n⚠️  捕获到未捕获的异常（已忽略，不影响继续运行）:');
    console.error('  ', err.message);
  });
  
  console.log('================================================================');
  console.log('  数据库2融合：从数据库1提取 + 其他API融合完善');
  console.log('  开始时间:', new Date().toLocaleString('zh-CN'));
  console.log('================================================================');
  
  let allMatches = [];
  let mergedDetails = {};
  let todayMatches = [];
  
  // 通用安全执行函数：某一步出错不影响其他步骤
  async function safeRun(name, fn) {
    try {
      return await fn();
    } catch (e) {
      console.error(' ');
      console.error('⚠️  [' + name + '] 执行出错（已跳过，继续下一步）:', e.message);
      return null;
    }
  }
  
  try {
    QuotaManager.load();
  } catch (e) {
    console.error('⚠️  配额加载出错，使用默认值:', e.message);
  }
  
  // 第一步：从数据库1提取云端API原始数据
  const result1 = await safeRun('第一步：从数据库1提取', async () => {
    return await extractFromDb1();
  });
  if (result1) {
    todayMatches = result1.todayMatches || [];
    allMatches = [...(result1.todayMatches || []), ...(result1.tomorrowMatches || [])];
    mergedDetails = result1.detailCache || {};
  }
  
  // 第二步：API-Football补充详细数据（S/A级）
  const result2 = await safeRun('第二步：API-Football补充', async () => {
    return await supplementWithApiFootball(allMatches, mergedDetails);
  });
  if (result2) mergedDetails = result2;
  
  // 第三步：Big Balls补充xG数据（S级）
  const result3 = await safeRun('第三步：Big Balls补充xG', async () => {
    return await supplementWithBigBalls(allMatches, mergedDetails);
  });
  if (result3) mergedDetails = result3;
  
  // 第四步：ESPN免费数据补充（零消耗配额）
  const result4 = await safeRun('第四步：ESPN免费补充', async () => {
    return await supplementWithEspn(allMatches, mergedDetails);
  });
  if (result4) mergedDetails = result4;
  
  // 第五步：保存融合后的详情到数据库2
  await safeRun('第五步：保存融合详情', async () => {
    await saveMergedDetails(mergedDetails);
  });
  
  // 第六步：比赛复盘与AI学习
  await safeRun('第六步：比赛复盘', async () => {
    await processReviews(todayMatches, mergedDetails);
  });
  
  // 第七步：AI自学习与权重调整
  await safeRun('第七步：AI自学习', async () => {
    await aiLearning();
  });
  
  // 第八步：自动清理过期数据
  await safeRun('第八步：自动清理', async () => {
    await cleanupDb2();
  });
  
  // 第九步：更新全局统计
  await safeRun('第九步：更新统计', async () => {
    await updateStats();
  });
  
  try {
    QuotaManager.save();
  } catch (e) {
    console.error('⚠️  配额保存出错:', e.message);
  }
  
  console.log('\n================================================================');
  console.log('  数据库2融合完成！');
  console.log('  结束时间:', new Date().toLocaleString('zh-CN'));
  console.log('  网页端只读数据库2: data/db2_master/');
  console.log('================================================================');
}

main();
