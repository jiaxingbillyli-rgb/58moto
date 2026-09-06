const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1600 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => { const e = document.getElementById('topStats'); return e && /222/.test(e.textContent); }, { timeout: 30000 });
  const info = await page.evaluate(() => ({
    top: document.getElementById('topStats').textContent,
    kpiModels: document.getElementById('kpiModels').textContent,
    kpiBrands: document.getElementById('kpiBrands').textContent,
    kpiPriceRange: document.getElementById('kpiPriceRange').textContent,
    kpiAvg: document.getElementById('kpiAvgPrice').textContent,
    modelRows: document.querySelectorAll('#modelTbody1 tr').length,
    analysisCards: document.querySelectorAll('#analysisCards .stat-card').length,
    hasChartPriceCanvas: !!document.getElementById('chartTab1Price'),
  }));
  console.log('INFO', JSON.stringify(info, null, 2));
  await page.evaluate(() => { document.getElementById('langToggle').click(); });
  await new Promise(r => setTimeout(r, 1000));
  const en = await page.evaluate(() => ({
    top: document.getElementById('topStats').textContent,
    kpiLabel: document.querySelector('.kpi-label') ? document.querySelector('.kpi-label').textContent : null,
    appTitle: document.querySelector('h1').textContent,
    modelRows: document.querySelectorAll('#modelTbody1 tr').length,
  }));
  console.log('EN', JSON.stringify(en, null, 2));
  // click Tab2 to ensure price-matrix local api works
  // Tab2 (filter) via real click
  await page.evaluate(() => document.querySelectorAll('.tab')[1].click());
  await new Promise(r => setTimeout(r, 1500));
  const tab2 = await page.evaluate(() => ({
    matrixRows: document.querySelectorAll('#matrixWrapper2 tr').length,
    modelRows: document.querySelectorAll('#modelTbody2 tr').length,
  }));
  console.log('TAB2', JSON.stringify(tab2, null, 2));
  // Tab3 (analysis) via real click
  await page.evaluate(() => document.querySelectorAll('.tab')[2].click());
  await new Promise(r => setTimeout(r, 2000));
  const tab3 = await page.evaluate(() => {
    const get = id => { try { return Chart.getChart(id); } catch (e) { return null; } };
    const cd = get('chartDisp'), cp = get('chartPrice'), cs = get('chartScatter'), ct = get('chartType');
    const sum = c => (c && c.data) ? c.data.datasets.reduce((a, d) => a + d.data.length, 0) : -1;
    return { dispPts: sum(cd), pricePts: sum(cp), scatterPts: sum(cs), typeLabels: ct && ct.data ? ct.data.labels.length : -1 };
  });
  console.log('TAB3', JSON.stringify(tab3, null, 2));
  await page.screenshot({ path: '_verify.png', fullPage: false });
  console.log('ERRORS', JSON.stringify(errs, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
