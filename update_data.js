#!/usr/bin/env node
/**
 * 58moto 数据更新脚本（独立可移植版）
 * 
 * 功能：
 *   1. 抓取品牌目录（brandList）
 *   2. 逐品牌抓取在售车型（goodList）
 *   3. 构建 SQLite 数据库（58moto.db）
 * 
 * 用法：
 *   node update_data.js [--edge "C:\Path\To\msedge.exe"]
 * 
 * 依赖：
 *   - Node.js >= 16
 *   - puppeteer-core（npm install）
 *   - Microsoft Edge / Chrome（必须「有头」运行，无头会被 WAF 拦截）
 *   - Linux CI 需 xvfb：apt-get install -y xvfb，然后用 xvfb-run 启动本脚本
 *   - Python 3（用于构建数据库，需要 sqlite3 模块，标准库自带）
 *
 * WAF 说明（2026-10 改版后）：
 *   - 站点接入京东云 WAF：无头浏览器一律返回 __jdd403 拦截页，**必须用有头模式**
 *   - 页面内 fetch() 会被 WAF 返回 405，所有数据只能靠真实 page.goto() 导航后读
 *     <script id="__NEXT_DATA__"> 获取
 *   - 老入口 /chexingku/ 已下线（405），品牌目录改从任意「有效品牌页」的
 *     model.brandList 读取；部分历史 brandId（如 1、3）也已失效（405），需跳过
 * 
 * 环境变量：
 *   EDGE_PATH  可选，指定 Edge 可执行文件路径
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WS = __dirname;

// ---- 查找 Edge 浏览器 ----
function findEdge() {
  if (process.env.EDGE_PATH && fs.existsSync(process.env.EDGE_PATH)) return process.env.EDGE_PATH;
  
  // 命令行参数
  const argIdx = process.argv.indexOf('--edge');
  if (argIdx > -1 && process.argv[argIdx + 1]) {
    const p = process.argv[argIdx + 1];
    if (fs.existsSync(p)) return p;
  }
  
  // 常见路径
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  
  // macOS via mdfind
  try {
    const macPath = execSync('mdfind "kMDItemCFBundleIdentifier == \'com.microsoft.edgemac\'" 2>/dev/null | head -1', { encoding: 'utf-8' }).trim();
    if (macPath) {
      const exe = path.join(macPath, 'Contents', 'MacOS', 'Microsoft Edge');
      if (fs.existsSync(exe)) return exe;
    }
  } catch (e) {}
  
  // Linux which
  try {
    const linuxPath = execSync('which microsoft-edge 2>/dev/null || which microsoft-edge-stable 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (linuxPath) return linuxPath;
  } catch (e) {}
  
  return null;
}

// ---- gradeGoodType → 车辆类型 映射 ----
const GRADE_TYPE_MAP = {
  2: '弯梁', 3: '踏板', 4: '巡航太子', 5: '越野',
  8: '街车', 9: '跑车', 10: '旅行', 11: '拉力', 12: '三轮', 15: 'MINI',
};

const SERIES_TYPE_RULES = [
  // 四轮车（ATV/UTV/SSV/全地形车）必须排在「三轮」之前，否则会被吞进三轮
  (['ATV','UTV','SSV','全地形车','Side by Side','SxS','四轮','沙滩车','巴吉','剃刀','RZR','CFORCE','ZFORCE','UFORCE'], '四轮车'),
  (['Sea-doo','Ski-doo','雪橇','摩托艇','边三轮','倒三轮','三轮','Spyder'], '三轮'),
  (['踏板','ESP系列','CoCo','Cola','MIKU','RT踏板','ADV踏板','MO踏板','飞雅','PRIMAVERA','LX系列','GTS','DJango','冠能','潮玩踏板','运动踏板','街道踏板','水冷踏板','风冷踏板','小型踏板','中型踏板','跨界踏板','时尚实用','通勤','龟系列','龟系','鹰系列','鹰系','牛系列','巧客','志界菱蒙踏板','踏板风韵','飞致','飞火流星','钻系列'], '踏板'),
  (['跑车','SPORTBIKE','Superbike','RC跑车','趴赛跑车','公路赛车','SuperSport','Panigale'], '跑车'),
  (['街车','NK系列','MT系列','Monster','Modern现代街车','RZ街车','Z系列','N系列'], '街车'),
  (['复古','MODERN CLASSICS','Classic','RE复古','Vintage','幼狮','Vitpilen','Svartpilen','Scrambler自游','自由派','Timeless','先锋复古','布雷斯通','火眼机甲','逸系列','潮派'], '复古'),
  (['巡航','Cruiser','CRUISER','Custom','太子','继承者','运动巡航','Diavel','RA巡航','哈雷','Street街道'], '巡航太子'),
  (['拉力','探险','Adventure','ADVENTURE','Multistrada','ADV系列','GS系列','拉力越野'], '拉力'),
  (['旅行','Touring','Bagger','Grand American','RK旅行','休旅','公务车'], '旅行'),
  (['越野','Motocross','MX系列','Enduro','ENDURO','场地车','KX系列','KLX系列','Scrambler攀爬','Supermoto','FTR','EXC系列','FREERIDE','Off-Road','运动家','青少年'], '越野'),
  (['弯梁'], '弯梁'),
  (['迷你','MINI','U侠'], 'MINI'),
  (['跨骑','通路','KPRO','KPM','CL系列','骑士风范','游侠','Rush','赛系列','鸿系列','JY系列','W系列','S系列','A系列','X系列','狼系列','N系列','热销','热门','运动系列','ROADSTERS运动','Street系列'], '街车'),
  (['新能源','eW15','AE系列','新能源 HYPE','新能源 S','M系列'], '踏板'),
];

function gradeToType(g, seriesName) {
  if (g !== null && g !== '' && g !== undefined) {
    const t = GRADE_TYPE_MAP[parseInt(g)];
    if (t) return t;
  }
  const sn = seriesName || '';
  for (const [keywords, vtype] of SERIES_TYPE_RULES) {
    for (const kw of keywords) {
      if (sn.includes(kw)) return vtype;
    }
  }
  return '其他';
}

function energyLabel(e) {
  const n = parseInt(e);
  return { 1: '燃油', 2: '电动', 3: '电动反充' }.get?.(n) || ({ 1: '燃油', 2: '电动', 3: '电动反充' }[n] || '其他');
}

// ---- WAF 适配工具 ----
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
// 已知仍然有效的品牌 ID（用作抓取品牌目录的「种子页」），会依次尝试直到拿到 brandList
const SEED_BRAND_IDS = [18, 44, 9, 267, 201, 208, 470, 24, 212, 383, 449, 3, 1];

// 读取当前页的 __NEXT_DATA__，区分多种状态；
// WAF 挑战页会自动重载，导致 evaluate 抛「Execution context was destroyed」，需重试
async function readNextModel(page, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      return await page.evaluate(() => {
        const el = document.querySelector('script#__NEXT_DATA__');
        if (!el) return { state: 'missing' };
        let d = null;
        try { d = JSON.parse(el.textContent); } catch (e) { return { state: 'badjson' }; }
        const pp = d.props && d.props.pageProps;
        if (!pp) return { state: 'noprops' };
        if (pp.__jdd403) return { state: 'waf' };
        return { state: 'ok', model: pp.model || {} };
      });
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (/Execution context was destroyed|Cannot find context|Target closed|detached/i.test(msg)) {
        await new Promise(r => setTimeout(r, 700));
        continue;
      }
      return { state: 'err', msg: msg.slice(0, 60) };
    }
  }
  return { state: 'ctxlost' };
}

// 带退避重试的导航：405 / WAF 拦截时逐步加长等待再试
// （京东云 WAF 对同一 IP 有短期频率限制：连续快速访问约 20 个品牌页后会开始返 405）
const BACKOFF_MS = [2500, 6000, 15000, 30000, 45000];
async function gotoBrandWithRetry(page, url, maxRetry = 5) {
  let res = null;
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    res = await gotoAndWait(page, url, 15000);
    if (res.state === 'ok') return res;
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    await new Promise(r => setTimeout(r, wait));
  }
  return res;
}

// 真实导航 + 等待 WAF 放行（挑战页会自动重新加载，需轮询）
//
// 关键：京东云 WAF 的会话令牌「一次导航即失效」，第二次访问任意 /brand/ 页面都会 405。
// 解决办法是每次导航前清空 cookie，强制 WAF 重新下发挑战并颁发新令牌（实测有效）。
let _cdpReady = false;
async function resetWafSession(page) {
  try {
    if (!_cdpReady) {
      page._cdp = await page.target().createCDPSession();
      _cdpReady = true;
    }
    await page._cdp.send('Network.clearBrowserCookies');
  } catch (e) {
    // 退化方案：只删当前页可见的 cookie
    try { const cj = await page.cookies(); if (cj.length) await page.deleteCookie(...cj); } catch (e2) {}
  }
}

async function gotoAndWait(page, url, timeout = 20000, resetSession = true) {
  if (resetSession) await resetWafSession(page);
  let status = 0;
  let navErr = '';
  try {
    // networkidle2 等 WAF 挑战触发的自动重载结束；domcontentloaded 会过早返回
    const r = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    status = r ? r.status() : 0;
  } catch (e) {
    status = 0;
    navErr = String((e && e.message) || e).split('\n')[0].slice(0, 90);
  }
  if (navErr) console.log(`      ↳ goto 异常: ${navErr}`);
  // 明确的失效路由（品牌已下线等）不必等
  if (status === 404 || status === 405 || status === 410) return { status, state: 'http' };
  await new Promise(r => setTimeout(r, 600));
  const t0 = Date.now();
  let st = { state: 'missing' };
  while (Date.now() - t0 < timeout) {
    st = await readNextModel(page);
    if (st.state === 'ok') return { status, ...st };
    await new Promise(r => setTimeout(r, st.state === 'waf' ? 1200 : 500));
  }
  return { status, ...st };
}

// ---- 主流程 ----
async function main() {
  const puppeteer = require('puppeteer-core');
  
  const edgePath = findEdge();
  if (!edgePath) {
    console.error('❌ 未找到 Edge / Chrome 浏览器！');
    console.error('   请通过 --edge 参数指定路径，或设置 EDGE_PATH 环境变量');
    process.exit(1);
  }
  console.log('✅ 浏览器路径:', edgePath);
  
  // Step 1: 抓取品牌目录
  console.log('\n📋 Step 1/3: 抓取品牌目录...');
  let browserPath = edgePath;
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    browserPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // 关键：WAF 会拦截无头浏览器，必须 headless:false（CI 上用 xvfb-run 提供虚拟显示）
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1440,900',
    ],
  });
  
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(45000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(BROWSER_UA);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    if (!window.chrome) window.chrome = {};
  });
  
  // 逐个尝试种子品牌页，拿到 model.brandList（/chexingku/ 已下线 405）
  let brandDir = null;
  let seedId = null;
  for (const sid of SEED_BRAND_IDS) {
    const url = `https://www.58moto.com/brand/A-${sid}.html`;
    const res = await gotoAndWait(page, url, 25000);
    if (res.state === 'ok' && res.model && res.model.brandList) {
      const brands = {};
      for (const grp of res.model.brandList) {
        for (const b of (grp.brands || [])) {
          brands[b.brandId] = {
            brandId: b.brandId,
            brandName: b.brandName,
            spelling: b.spelling || '',
            aleph: b.aleph || '',
            energyType: b.brandEnergyType || '',
            existSaleGoods: b.existSaleGoods,
            keywords: b.keywords || '',
            logo: b.brandLogo || '',
          };
        }
      }
      // 顺带收集页面上出现的品牌链接，覆盖非 A- 前缀的 URL
      const navUrls = await page.evaluate(() => {
        const m = {};
        document.querySelectorAll('a[href]').forEach(a => {
          const h = a.getAttribute('href') || '';
          const mm = h.match(/^\/brand\/([A-Z])-(\d+)\.html/);
          if (mm) m[parseInt(mm[2])] = 'https://www.58moto.com' + mm[0];
        });
        return m;
      });
      brandDir = Object.keys(brands).map(id => ({
        ...brands[id],
        url: navUrls[id] || `https://www.58moto.com/brand/A-${id}.html`,
      }));
      seedId = sid;
      break;
    }
    console.log(`   种子品牌 A-${sid} 不可用（state=${res.state} http=${res.status}），换下一个...`);
    await new Promise(r => setTimeout(r, 3000));
  }
  
  if (!brandDir || brandDir.length === 0) {
    console.error('❌ 无法获取品牌目录！所有种子品牌页均被 WAF 拦截或已失效。');
    await browser.close();
    process.exit(1);
  }
  
  fs.writeFileSync(path.join(WS, 'brand_directory.json'), JSON.stringify(brandDir, null, 1), 'utf-8');
  let saleBrands = brandDir.filter(b => b.existSaleGoods === 1);
  const MAX_BRANDS = parseInt(process.env.MAX_BRANDS || '0', 10);
  if (MAX_BRANDS > 0) saleBrands = saleBrands.slice(0, MAX_BRANDS);
  console.log(`   ✅ 品牌目录: ${brandDir.length} 个品牌，${saleBrands.length} 个有在售车型（种子页 A-${seedId}）`);
  
  // Step 2: 逐品牌抓取车型（必须真实导航，WAF 会拦截页面内 fetch）
  console.log(`\n🏍️  Step 2/3: 抓取 ${saleBrands.length} 个品牌的车型数据...`);
  const allModels = [];
  let skipped = 0, wafHits = 0;
  const t0 = Date.now();
  
  for (let i = 0; i < saleBrands.length; i++) {
    const brand = saleBrands[i];
    // 基础礼节间隔：WAF 对同 IP 有约 20 次/分钟的短期频率限制
    if (i > 0) await new Promise(r => setTimeout(r, 3000));
    // 每 20 个品牌集中冷却一次，避免累计触发限流
    if (i > 0 && i % 20 === 0) {
      console.log(`   ⏸  已抓 ${i} 个品牌，冷却 25s 规避 WAF 限流...`);
      await new Promise(r => setTimeout(r, 25000));
    }
    try {
      const res = await gotoBrandWithRetry(page, brand.url);
      if (res.state !== 'ok') {
        skipped++;
        if (res.state === 'waf') wafHits++;
        if (skipped <= 8) console.log(`   [${i+1}/${saleBrands.length}] ${brand.brandName}: 跳过（${res.state} http=${res.status}）`);
        continue;
      }
      const goodList = res.model.goodList;
      if (!goodList || !goodList.length) {
        skipped++;
        continue;
      }
      for (const g of goodList) {
        allModels.push({
          goodId: g.goodId, goodName: g.goodName, carName: g.carName || '',
          seriesId: g.seriesId, seriesName: g.seriesName || '',
          brandId: g.brandId, brandName: g.brandName, brandLogo: g.brandLogo || '',
          minPrice: g.minPrice, maxPrice: g.maxPrice, goodPrice: g.goodPrice,
          minActivityPrice: g.minActivityPrice, maxActivityPrice: g.maxActivityPrice,
          energyType: g.energyType, saleStatus: g.saleStatus,
          isNewOnMarket: g.isNewOnMarket || 0, totalScore: g.totalScore || 0,
          goodPic: g.goodPic || '', spelling: brand.spelling || '', aleph: brand.aleph || '',
          gradeGoodType: g.gradeGoodType, queryGoodType: g.queryGoodType,
          hotGoodType: g.hotGoodType, aliasName: g.aliasName || '',
          tags: g.tags || '',
        });
      }
      if ((i + 1) % 25 === 0 || i === saleBrands.length - 1) {
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`   ...${i+1}/${saleBrands.length}（累计 ${allModels.length} 款，跳过 ${skipped}，用时 ${el}s）`);
      }
    } catch (e) {
      skipped++;
      console.log(`   [${i+1}/${saleBrands.length}] ${brand.brandName} ERROR: ${e.message.slice(0,60)}`);
    }
  }
  console.log(`   抓取结束：有效品牌 ${saleBrands.length - skipped} / ${saleBrands.length}，其中 WAF 拦截 ${wafHits}`);
  
  await browser.close();
  
  // 保护 1：绝对下限
  if (allModels.length < 1000) {
    console.error(`\n❌ 仅抓到 ${allModels.length} 款车型（阈值 1000），疑似被 WAF 大面积拦截，放弃本次更新以免覆盖线上数据。`);
    process.exit(1);
  }
  // 保护 2：相对上一次的跌幅（防止只抓到几十个品牌就把库覆盖成残缺版本）
  try {
    const prevPath = path.join(WS, 'models_raw_v2.json');
    if (fs.existsSync(prevPath)) {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf-8'));
      if (Array.isArray(prev) && prev.length > 0 && allModels.length < prev.length * 0.6) {
        console.error(`\n❌ 本次 ${allModels.length} 款，仅为上次 ${prev.length} 款的 ${(allModels.length / prev.length * 100).toFixed(0)}%（低于 60%），疑似被 WAF 限流，放弃本次更新以免覆盖为残缺数据。`);
        process.exit(1);
      }
    }
  } catch (e) {
    console.log('   ⚠️ 无法读取上一次的 models_raw_v2.json 做对比，跳过跌幅校验');
  }
  
  fs.writeFileSync(path.join(WS, 'models_raw_v2.json'), JSON.stringify(allModels), 'utf-8');
  console.log(`\n   ✅ 总车型数: ${allModels.length}`);
  
  // Step 3: 构建 SQLite 数据库
  console.log('\n🗄️  Step 3/3: 构建数据库...');
  buildDb(allModels, brandDir);
  console.log('\n✅ 数据更新完成！');
  
  // 输出统计
  const stats = { totalModels: allModels.length, totalBrands: brandDir.length, saleBrands: saleBrands.length, updateTime: new Date().toISOString() };
  fs.writeFileSync(path.join(WS, 'last_update.json'), JSON.stringify(stats, null, 2), 'utf-8');
  console.log(`   车型: ${stats.totalModels} | 品牌: ${stats.totalBrands} | 更新时间: ${stats.updateTime}`);
}

// ---- 构建 DB（优先 Python，更可靠）----
function buildDb(allModels, brandDir) {
  const pyScript = path.join(WS, 'build_db.py');
  console.log('   使用 Python 构建数据库...');
  try {
    // 关键：Windows 下 Node 的 spawnSync('python3') 找不到 Store/WSL alias 的 python3；
    // 而 execSync 配合 shell:true 可经 cmd 解析 python3.cmd。注意不能设 cwd（含空格路径
    // 会让 Node 在 Windows 上报 cmd.exe ENOENT），依赖进程 cwd(已由调用方设为 WS)。
    const out = execSync(`python3 "${pyScript}"`, {
      encoding: 'utf-8', shell: true, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (out.includes('DB_BUILD_OK')) {
      const okLine = out.split('\n').find(l => l.startsWith('DB_BUILD_OK'));
      console.log('   ✅ 数据库构建完成 (' + okLine + ')');
      return;
    }
    console.log('   ⚠️ Python 未返回成功标记，尝试 Node.js 方案...');
    console.log('   ' + out.split('\n').slice(-8).join('\n   '));
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || ''));
    if (out.includes('DB_BUILD_OK')) {
      const okLine = out.split('\n').find(l => l.startsWith('DB_BUILD_OK'));
      console.log('   ✅ 数据库构建完成 (' + okLine + ') [忽略退出码]');
      return;
    }
    console.log('   ⚠️ Python 构建失败: ' + (e.message || '').split('\n')[0]);
    console.log('   ' + out.split('\n').slice(-8).join('\n   '));
  }
  
  // JS fallback: 使用 better-sqlite3（需要额外安装）
  try {
    const Database = require('better-sqlite3');
    console.log('   使用 better-sqlite3 构建数据库...');
    buildDbJs(allModels, brandDir, Database);
  } catch (e) {
    console.error('❌ 无法构建数据库：需要 Python 3 或 npm install better-sqlite3');
    console.error('   Python 下载: https://www.python.org/downloads/');
    console.error('   或运行: npm install better-sqlite3');
    process.exit(1);
  }
}

function buildDbJs(allModels, brandDir, Database) {
  const dbPath = path.join(WS, '58moto.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  
  const db = new Database(dbPath);
  
  // 过滤在售+有价
  const filtered = allModels.filter(m => m.saleStatus === 1 && parseFloat(m.minPrice) > 0);
  const brandIds = new Set(filtered.map(m => m.brandId));
  
  // brands 表
  db.exec(`CREATE TABLE brands (
    brand_id INTEGER PRIMARY KEY, brand_name TEXT, spelling TEXT, aleph TEXT,
    energy_type TEXT, has_sale_goods INTEGER, keywords TEXT, logo TEXT, page_url TEXT
  )`);
  
  const insertBrand = db.prepare(`INSERT INTO brands VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const b of brandDir) {
    if (brandIds.has(b.brandId)) {
      insertBrand.run(b.brandId, b.brandName||'', b.spelling||'', b.aleph||'',
        b.energyType||'', 1, '', b.logo||'', `/brand/A-${b.brandId}.html`);
    }
  }
  
  // models 表
  db.exec(`CREATE TABLE models (
    good_id INTEGER PRIMARY KEY, good_name TEXT, car_name TEXT,
    series_id INTEGER, series_name TEXT, brand_id INTEGER, brand_name TEXT,
    brand_logo TEXT, min_price REAL, max_price REAL, good_price REAL,
    min_activity_price REAL, max_activity_price REAL,
    energy_type INTEGER, energy_label TEXT, sale_status INTEGER,
    is_new_on_market INTEGER, total_score REAL, good_pic TEXT,
    spelling TEXT, aleph TEXT, grade_good_type INTEGER, vehicle_type TEXT,
    alias_name TEXT, tags TEXT
  )`);
  
  const insertModel = db.prepare(`INSERT INTO models VALUES ($good_id, $good_name, $car_name, $series_id, $series_name, $brand_id, $brand_name, $brand_logo, $min_price, $max_price, $good_price, $min_activity_price, $max_activity_price, $energy_type, $energy_label, $sale_status, $is_new_on_market, $total_score, $good_pic, $spelling, $aleph, $grade_good_type, $vehicle_type, $alias_name, $tags)`);
  
  const energyMap = { 1: '燃油', 2: '电动', 3: '电动反充' };
  
  for (const m of filtered) {
    const ggt = m.gradeGoodType;
    let ggtInt = null;
    if (ggt !== '' && ggt !== null && ggt !== undefined) {
      ggtInt = parseInt(ggt);
      if (isNaN(ggtInt)) ggtInt = null;
    }
    const vt = gradeToType(ggt, m.seriesName || '');
    const el = energyMap[parseInt(m.energyType)] || '其他';
    
    insertModel.run({
      good_id: m.goodId, good_name: m.goodName||'', car_name: m.carName||'',
      series_id: m.seriesId, series_name: m.seriesName||'',
      brand_id: m.brandId, brand_name: m.brandName||'', brand_logo: m.brandLogo||'',
      min_price: parseFloat(m.minPrice)||0, max_price: parseFloat(m.maxPrice)||0,
      good_price: null,
      min_activity_price: m.minActivityPrice ? parseFloat(m.minActivityPrice) : null,
      max_activity_price: m.maxActivityPrice ? parseFloat(m.maxActivityPrice) : null,
      energy_type: parseInt(m.energyType)||0, energy_label: el,
      sale_status: m.saleStatus, is_new_on_market: m.isNewOnMarket||0,
      total_score: m.totalScore ? parseFloat(m.totalScore) : null,
      good_pic: m.goodPic||'', spelling: m.spelling||'', aleph: m.aleph||'',
      grade_good_type: ggtInt, vehicle_type: vt,
      alias_name: m.aliasName||'', tags: m.tags||'',
    });
  }
  
  db.exec(`CREATE INDEX idx_models_brand ON models(brand_id)`);
  db.exec(`CREATE INDEX idx_models_type ON models(vehicle_type)`);
  db.exec(`CREATE INDEX idx_models_energy ON models(energy_label)`);
  db.exec(`CREATE INDEX idx_models_price ON models(min_price)`);
  
  const cnt = db.prepare('SELECT COUNT(*) as c FROM models').get().c;
  const bcnt = db.prepare('SELECT COUNT(*) as c FROM brands').get().c;
  db.close();
  
  console.log(`   ✅ DB built: ${cnt} models, ${bcnt} brands`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
