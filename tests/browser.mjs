import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AUDIT_PLAYWRIGHT || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.AUDIT_OUTPUT || 'audit-evidence');
mkdirSync(output, { recursive: true });
const testPassword = 'local-audit-fixture';
const hash = createHash('sha256').update(testPassword).digest('hex');
const assets = {
  '/': ['text/html; charset=utf-8', () => readFileSync(resolve(root,'index.html'),'utf8').replace('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js','/exceljs.min.js')],
  '/app.js': ['text/javascript; charset=utf-8', () => readFileSync(resolve(root,'app.js'),'utf8').replace(/(const passwordHash = ')[a-f0-9]{64}(';)/, '$1' + hash + '$2')],
  '/styles.css': ['text/css', () => readFileSync(resolve(root,'styles.css'))],
  '/exceljs.min.js': ['text/javascript', () => readFileSync(process.env.AUDIT_EXCELJS)],
  '/расчет.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', () => readFileSync(resolve(root,'расчет.xlsx'))]
};
const server = createServer((req,res) => {
  const asset = assets[decodeURIComponent(new URL(req.url,'http://localhost').pathname)];
  if (!asset) return res.writeHead(404).end();
  res.writeHead(200,{'Content-Type':asset[0]}).end(asset[1]());
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.AUDIT_CHROME});
  const page = await browser.newPage({viewport:{width:1280,height:800}});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('Page error:',error.message); });
  page.on('response', r => console.log('HTTP',r.status(),r.url()));
  page.on('dialog', async dialog => { console.log('Dialog:',dialog.message()); await dialog.dismiss(); });
  page.on('console', entry => { if (entry.type() === 'error') console.log('Browser:',entry.text()); });
  await page.route('https://www.cbr-xml-daily.ru/**', route => route.fulfill({json:{Date:new Date().toISOString(),Valute:{USD:{Value:90,Nominal:1},CNY:{Value:12,Nominal:1},EUR:{Value:100,Nominal:1}}}}));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('#siteLockPassword').fill(testPassword);
  await page.locator('#siteLockForm button').click();
  await page.locator('#siteLock').waitFor({state:'detached'});
  await page.locator('#nextButton').click();
  await page.locator('#productWidth').fill('125/abc');
  await page.locator('#calculateButton').click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({path:resolve(output,'invalid-width.png')});
  await page.getByRole('button',{name:'Понятно'}).click();
  await page.locator('#productWidth').fill('125,125');
  await page.locator('#quantity').fill('1');
  await page.locator('#materialCost').fill('172000');
  await page.locator('#price').fill('180000');
  await page.locator('#calculateButton').click();
  assert.match(await page.locator('#resultsBody').innerText(), /Итого: 1,000 т/);
  await page.screenshot({path:resolve(output,'strip-result.png')});
  const directExport = page.locator('#exportExcelButton');
  if (await directExport.isVisible()) {
    const [directDownload] = await Promise.all([page.waitForEvent('download',{timeout:20000}),directExport.click()]);
    await directDownload.saveAs(resolve(output,'direct.xlsx'));
    console.log('Direct Excel download generated');
  }
  console.log('Strip e2e: invalid width rejected, 1.000 t finished');
  const buttons = await page.locator('#resultsStep button').allTextContents();
  console.log('Result actions:',buttons);
  await page.getByRole('button',{name:/Сделать расчёт/i}).first().click();
  await page.locator('#purchaseModal').waitFor();
  console.log('Purchase actions:',await page.locator('#purchaseModal button').allTextContents());
  console.log('Excel state:', await page.evaluate(() => [!!window.ExcelJS, !!lastCalculation, lastCalculation?.type]));
  await page.locator('#defermentDays').fill('30');
  await page.locator('#finalPrice').fill('246801');
  const exportButton = page.locator('#purchaseModal').getByRole('button',{name:/Excel/i}).first();
  const [download] = await Promise.all([page.waitForEvent('download',{timeout:20000}),exportButton.click()]);
  await download.saveAs(resolve(output,'single.xlsx'));
  assert.deepEqual(errors, []);
  console.log('Single Excel download generated');
  await page.locator('#purchaseCurrency').selectOption('CNY');
  await page.locator('#purchasePrice').fill('1500');
  await page.locator('#finalPrice').fill('0');
  const [zeroDownload] = await Promise.all([page.waitForEvent('download',{timeout:25000}),exportButton.click()]);
  await zeroDownload.saveAs(resolve(output,'single-zero-cny.xlsx'));
  await page.locator('#finalPrice').fill('');
  const [autoDownload] = await Promise.all([page.waitForEvent('download',{timeout:25000}),exportButton.click()]);
  await autoDownload.saveAs(resolve(output,'single-auto-cny.xlsx'));
  await page.reload();
  await page.locator('button[data-type="sheet"]').click();
  await page.locator('#nextButton').click();
  await page.locator('#batchModeToggle').check();
  await page.locator('.batch-add').click();
  await page.locator('.batch-add').click();
  await page.locator('.batch-quantity').nth(2).fill('');
  await page.locator('#calculateButton').click();
  const invalidBatchRejected = await page.getByRole('dialog').isVisible();
  if (!invalidBatchRejected) await page.screenshot({path:resolve(output,'batch-silent-omission.png')});
  assert.equal(invalidBatchRejected, true, 'invalid third position must block calculation');
  await page.getByRole('button',{name:'Понятно'}).click();
  await page.locator('.batch-quantity').nth(2).fill('2');
  await page.locator('.batch-film').first().selectOption('pe');
  await page.locator('.batch-price').first().fill('185000');
  await page.locator('.batch-price').nth(1).fill('186000');
  await page.locator('.batch-price').nth(2).fill('187000');
  await page.locator('#calculateButton').click();
  await page.getByRole('button',{name:/Сделать расчёт/i}).first().click();
  await page.locator('#purchaseModal').waitFor();
  await page.screenshot({path:resolve(output,'batch-purchase.png')});
  const [batchDownload] = await Promise.all([page.waitForEvent('download',{timeout:20000}),exportButton.click()]);
  await batchDownload.saveAs(resolve(output,'batch.xlsx'));
  assert.deepEqual(errors, []);
  console.log('Batch Excel download generated');
  for (const [type, size] of [['rewind', {width:768,height:1024}], ['card', {width:390,height:844}]]) {
    await page.setViewportSize(size);
    await page.reload();
    await page.locator(`button[data-type="${type}"]`).click();
    await page.locator('#nextButton').click();
    if (type === 'card') {
      await page.locator('#productWidth').fill('300');
      await page.locator('#productLength').fill('500');
    }
    await page.locator('#calculateButton').click();
    await page.locator('#resultsStep').waitFor();
    assert.doesNotMatch(await page.locator('#resultsStep').innerText(), /NaN|Infinity/);
    await page.screenshot({path:resolve(output,`${type}-result.png`)});
    console.log(`${type}: normal workflow at ${size.width}px`);
    if (type === 'card') {
      await page.locator('#customCoilWidth').fill('550');
      const plan = page.locator('#customResult .cut-plan');
      await plan.locator('summary').click();
      assert.match(await plan.innerText(), /500,00 × 300,00 мм/);
      await page.screenshot({path:resolve(output,'card-rotated-custom.png')});
      await page.getByRole('button',{name:/Сделать расчёт/i}).first().click();
      await page.waitForFunction(() => Number(document.querySelector('#cbrRate')?.dataset.rate) > 0);
      await page.route('**/*.xlsx', route => route.fulfill({status:404, body:''}));
      const chooserPending = page.waitForEvent('filechooser');
      await exportButton.click();
      const chooser = await chooserPending;
      const downloadPending = page.waitForEvent('download',{timeout:25000});
      await chooser.setFiles(resolve(root,'расчет.xlsx'));
      const cardDownload = await downloadPending;
      await cardDownload.saveAs(resolve(output,'card.xlsx'));
      await page.unroute('**/*.xlsx');
      console.log('Card export recovered using local template after HTTP 404');
    }
  }
  await page.setViewportSize({width:1280,height:800});
  await page.reload();
  await page.locator('button[data-type="strip"]').click();
  await page.locator('#nextButton').click();
  await page.locator('#batchModeToggle').check();
  await page.locator('.multi-strip-add').click();
  for (const [index,width,tons] of [[0,'150','1'],[1,'310','2']]) {
    await page.locator('.multi-strip-width').nth(index).fill(width);
    await page.locator('.multi-strip-quantity').nth(index).fill(tons);
  }
  await page.locator('#calculateButton').click();
  await page.locator('#resultsStep').waitFor();
  assert.match(await page.locator('#resultsBody').innerText(), /откл/);
  await page.screenshot({path:resolve(output,'mixed-strip.png')});
  await page.getByRole('button',{name:/Сделать расчёт/i}).first().click();
  await page.waitForFunction(() => Number(document.querySelector('#cbrRate')?.dataset.rate) > 0);
  const [mixedDownload] = await Promise.all([page.waitForEvent('download',{timeout:25000}),exportButton.click()]);
  await mixedDownload.saveAs(resolve(output,'mixed-strip.xlsx'));
  await page.keyboard.press('Escape');
  for (const kind of ['network', 'stale', 'timeout']) {
    await page.unroute('https://www.cbr-xml-daily.ru/**');
    await page.route('https://www.cbr-xml-daily.ru/**', async route => {
      if (kind === 'network') return route.abort('failed');
      if (kind === 'stale') return route.fulfill({json:{Date:'2020-01-01',Valute:{USD:{Value:90,Nominal:1},CNY:{Value:12,Nominal:1}}}});
      await new Promise(resolve => setTimeout(resolve, 9000));
      await route.abort('timedout').catch(() => {});
    });
    await page.getByRole('button',{name:/Сделать расчёт/i}).first().click();
    await page.getByText('нет актуальных данных',{exact:true}).waitFor({timeout:12000});
    const blocked = page.waitForEvent('dialog');
    await exportButton.click();
    assert.match((await blocked).message(), /курс недоступен/);
    await page.keyboard.press('Escape');
    console.log(`Exchange rate failure blocked: ${kind}`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
}
