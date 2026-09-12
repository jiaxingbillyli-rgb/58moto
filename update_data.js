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
 *   - Microsoft Edge（用于绕过阿里云 WAF）
 *   - Python 3（用于构建数据库，需要 sqlite3 模块，标准库自带）
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
  (['ATV','UTV','SSV','全地形车','Sea-doo','Ski-doo','雪橇','摩托艇','边三轮','倒三轮','Spyder','剃刀','RZR'], '三轮'),
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

// ---- 主流程 ----
async function main() {
  const puppeteer = require('puppeteer-core');
  
  const edgePath = findEdge();
  if (!edgePath) {
    console.error('❌ 未找到 Microsoft Edge 浏览器！');
    console.error('   请通过 --edge 参数指定路径，或设置 EDGE_PATH 环境变量');
    process.exit(1);
  }
  console.log('✅ Edge 路径:', edgePath);
  
  // Step 1: 抓取品牌目录
  console.log('\n📋 Step 1/3: 抓取品牌目录...');
  let browserPath = edgePath;
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    browserPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  
  // 访问任意品牌页获取 WAF cookie + brandList
  console.log('   访问 58moto.com 过 WAF...');
  await page.goto('https://www.58moto.com/chexingku/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // 从首页或品牌页提取品牌目录
  // 先尝试从页面 HTML 提取 __NEXT_DATA__
  const brandDir = await page.evaluate(async () => {
    // 尝试访问一个品牌页获取 brandList
    const r = await fetch('https://www.58moto.com/brand/A-1.html', { credentials: 'include', cache: 'no-store' });
    const text = await r.text();
    const m = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const model = data.props?.pageProps?.model;
    if (!model || !model.brandList) return null;
    
    const brands = {};
    for (const grp of model.brandList) {
      for (const b of grp.brands) {
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
    
    // 从导航链接获取 URL
    const navUrls = {};
    const aRe = /href="(\/brand\/[A-Z]-(\d+)\.html)"/g;
    let am;
    while ((am = aRe.exec(text)) !== null) {
      navUrls[parseInt(am[2])] = 'https://www.58moto.com' + am[1];
    }
    
    const directory = [];
    for (const id of Object.keys(brands)) {
      directory.push({ ...brands[id], url: navUrls[id] || `https://www.58moto.com/brand/A-${id}.html` });
    }
    return directory;
  });
  
  if (!brandDir || brandDir.length === 0) {
    console.error('❌ 无法获取品牌目录！网站可能改版或 WAF 拦截。');
    await browser.close();
    process.exit(1);
  }
  
  fs.writeFileSync(path.join(WS, 'brand_directory.json'), JSON.stringify(brandDir, null, 1), 'utf-8');
  const saleBrands = brandDir.filter(b => b.existSaleGoods === 1);
  console.log(`   ✅ 品牌目录: ${brandDir.length} 个品牌，${saleBrands.length} 个有在售车型`);
  
  // Step 2: 逐品牌抓取车型
  console.log(`\n🏍️  Step 2/3: 抓取 ${saleBrands.length} 个品牌的车型数据...`);
  const allModels = [];
  
  for (let i = 0; i < saleBrands.length; i++) {
    const brand = saleBrands[i];
    const url = `https://www.58moto.com/brand/A-${brand.brandId}.html`;
    
    try {
      const resp = await page.evaluate(async (url) => {
        const r = await fetch(url);
        const text = await r.text();
        const m = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!m) return null;
        return JSON.parse(m[1]);
      }, url);
      
      if (!resp || !resp.props?.pageProps?.model?.goodList) {
        console.log(`   [${i+1}/${saleBrands.length}] ${brand.brandName}: 无数据`);
        continue;
      }
      
      const goodList = resp.props.pageProps.model.goodList;
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
      console.log(`   [${i+1}/${saleBrands.length}] ${brand.brandName} (id=${brand.brandId}): ${goodList.length} 款`);
    } catch (e) {
      console.log(`   [${i+1}/${saleBrands.length}] ${brand.brandName} ERROR: ${e.message}`);
    }
    
    // 礼貌延迟
    if ((i + 1) % 10 === 0) await new Promise(r => setTimeout(r, 500));
  }
  
  await browser.close();
  
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
