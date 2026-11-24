import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const optimizerSource = readFileSync(new URL('../subcut-optimizer.js', import.meta.url), 'utf8');
const combinedSource = readFileSync(new URL('../combined-strip-optimizer.js', import.meta.url), 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const lines = source.split(/\r?\n/).filter(line => /^(const (decimal|charge) =|function (maxStrips|quantityToTons|thicknessBand|grindingPrice|filmPrice|stripBand|longitudinalRate)\()/.test(line));
const api = runInNewContext([
  "let selectedType = 'strip';",
  block('const PRICE =', 'const getRadio ='),
  ...lines,
  "let radios = {}; let testMaterialCost = 172000, testSmallScrap = false, testTolerance=10; const getRadio = name => radios[name] || ''; const $ = id => id === 'allowSmallScrap' ? {checked:testSmallScrap} : {value: id === 'stripTolerance' ? String(testTolerance) : String(testMaterialCost)}; const numericInputValue = Number;",
  block('function modeForNextOperation(', 'function showStep('),
  block('function serviceData(', 'function cardLayouts('),
  block('function readStripWidths(', 'function updateStripSizeControl('),
  block('function stripLayoutMatch(', 'function setType('),
  block('function cardLayouts(', 'function serviceDataWithSubcut('),
  optimizerSource,
  combinedSource,
  block('function layoutWeightItems(', 'function renderActualStripWeight('),
  block('function cardCutDimensions(', 'function cutPlanHtml('),
  block('function serviceDataWithSubcut(', 'function cardCutDimensions('),
  block('function stripRowForFinishedVolume(', 'function calculate('),
  block('function bestCardBatchCoilWidth(', 'function calculateBatch('),
  '({ bestCardBatchCoilWidth, cardRows, cardCutDimensions, compareCardRows, stripRows, compareStripRows, sourceCoilChoices, selectStripResults, combinedStripLayouts, singleStripHybridLayouts, setTypeForTest(type) { selectedType = type; testSmallScrap = false; radios = {surface: "2b", film: "none", openMode: "partial"}; }, setMaterialCostForTest(value) { testMaterialCost = value; }, setSmallScrapForTest(value) { testSmallScrap = value; }, setToleranceForTest(value){testTolerance=value;}, route(type, choices, ...args) { selectedType = type; radios = choices; return serviceData(...args); }, quantityToTons, stripLayoutMatch, stripLayouts, subcutLayouts, mixedSubcutLayouts, hybridSubcutLayouts, minimumScrap, cardLayouts, multiStripLayouts, mixedLayoutSearchFits, layoutWeightItems, readStripWidths, charge, maxStrips, minScrap: PRICE.longitudinal.minScrap })'
].join('\n'));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' != ' + expected);
test('A: mass balance independently of machine capacity', () => {
  const items = api.layoutWeightItems({coilWidth:1000, layoutWidths:Array(48).fill(20)}, 1000 / 960);
  near(items[0].tons, 1);
  assert.equal(items[0].count, 48);
  assert.ok(api.maxStrips(0.6, 1000) < 48);
  assert.ok(api.subcutLayouts(1000, 20, 0.6).some(row => row.count === 48 && row.subcuts === 4 && row.scrap + row.subcuts * api.minScrap === 40));
});
test('B: actual weights for both widths and mass conservation', () => {
  const widths = [150,150,310,310];
  const match = api.stripLayoutMatch({widths}, [{width:150,quantity:1},{width:310,quantity:2}], 'tons', 1, 0, 1000);
  near(match.sourceVolume, 3 / .92);
  const items = api.layoutWeightItems({coilWidth:1000, layoutWidths:widths}, match.sourceVolume);
  near(items[0].tons, 3 * 300 / 920);
  near(items[1].tons, 3 * 620 / 920);
});
test('mass never uses rounded presentation labels', () => {
  const [item] = api.layoutWeightItems({coilWidth:1000, cardSize:'3×125,13 мм', layoutWidths:[125.125,125.125,125.125]}, 1);
  near(item.tons, 3 * 125.125 / 1000);
});
test('mixed invalid width is rejected rather than silently dropping it', () => {
  assert.equal(api.readStripWidths('125/abc').length, 0);
  assert.equal(api.readStripWidths('125/0').length, 0);
  assert.equal(api.readStripWidths('125/').length, 0);
  assert.equal(api.readStripWidths('125,125/150').length, 2);
});
test('subcut search with extremely small width terminates', {timeout: 2000}, () => {
  assert.ok(api.subcutLayouts(1500, 1e-15, 0.6).length > 0);
});
test('quantities and only one minimum charge', () => {
  near(api.quantityToTons(1000,'meters',1.2,125,0),1.17);
  near(api.quantityToTons(1000,'pieces',1.2,1000,2500),23.4);
  near(api.charge(1500,.25,1,'partial'),6000);
  near(api.charge(1000,.25,1,'open'),1000);
});
test('4800 direct, card, mixed and two-stage cutting inputs obey geometry and mass balance', () => {
  let seed = 1520;
  const sample = n => ((seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) % n);
  for (let i=0; i<1200; i++) {
    const coil = [1000,1219,1250,1500][sample(7)%4];
    const thickness = [.4,.6,.8,1,1.2,1.5,2,2.01][sample(13)%8];
    const width = 15 + sample(750), second = 15 + sample(700), source = .01 + sample(10000)/100;
    for (const layouts of [api.stripLayouts(coil,width,thickness),api.cardLayouts(coil,width,second,thickness),api.multiStripLayouts(coil,[width,second],thickness)]) {
      for (const {widths} of layouts) {
        const used = widths.reduce((a,b)=>a+b,0);
        assert.ok(widths.length <= api.maxStrips(thickness,coil));
        assert.ok(coil-used >= api.minScrap);
        near(api.layoutWeightItems({coilWidth:coil,layoutWidths:widths},source).reduce((sum,item)=>sum+item.tons,0)+source*(coil-used)/coil,source);
      }
    }
    for (const row of api.subcutLayouts(coil,width,thickness)) {
      assert.ok(row.subcuts <= api.maxStrips(thickness,coil));
      assert.ok(row.scrap >= api.minScrap);
      row.widths.forEach((w,k) => {
        assert.ok(row.counts[k] <= api.maxStrips(thickness,w));
        near(w-row.counts[k]*width,api.minScrap);
      });
      near(source * (row.count*width + row.scrap + row.subcuts*api.minScrap) / coil,source);
    }
  }
});

test('open grinding applies no minimum; subsequent operations always use open', () => {
  const card = api.route('card', {surface:'2b',film:'none',openMode:'partial'}, 1000,[300,300,300],1,1,180000);
  assert.equal(card.operations[0].price,6368*3);
  assert.equal(card.operations[1].price,4060);
  const sheet = api.route('sheet', {surface:'4n',film:'none',openMode:'open'},1250,1250,1,1,180000);
  assert.equal(sheet.operations[0].price,5898);
  assert.equal(sheet.operations[1].price,4060);
  const strip = api.route('strip', {surface:'4n',film:'pe',filmSides:'two',openMode:'full'},1000,[125,125],1,1,180000);
  assert.equal(strip.operations[0].price,6545*3);
  assert.equal(strip.operations[1].price,3183);
  assert.equal(strip.operations[2].price,3460);
});
test('mixed strip ranking agrees with independent complete enumeration', () => {
  const coil = 1000, limit = 25, widths = [150,310];
  const orders = [{width:150,quantity:1},{width:310,quantity:2}];
  const rank = (a,b) => a[0]-b[0] || b[1]-a[1];
  const exact = [];
  for (let a=1; a<limit; a++) for (let b=1; b<=limit-a; b++) {
    const use = a*150+b*310;
    if (use > 993) continue;
    exact.push([Math.abs(3*a*150/use-1) + Math.abs(3*b*310/use-2)/2, use/coil, a, b]);
  }
  const actual = api.multiStripLayouts(coil,widths,.6).map(layout => {
    const a = layout.widths.filter(width=>width===150).length;
    const b = layout.widths.length-a;
    return [api.stripLayoutMatch(layout,orders,'tons',.6,0,coil).score,(a*150+b*310)/coil,a,b];
  }).sort(rank);
  exact.sort(rank);
  assert.equal(actual.length,exact.length);
  actual.forEach((row,index)=>row.forEach((value,column)=>near(value,exact[index][column])));
  assert.deepEqual(actual[0].slice(2),[2,2]);
});
test('dense width lists are rejected by the preflight bound', () => {
  assert.ok(api.mixedLayoutSearchFits([150,310],.6,true));
  assert.equal(api.mixedLayoutSearchFits(Array.from({length:8},(_,i)=>20+i),.6,true),false);
});
test('card minimum-price plan uses both orientations and is invariant under swapping dimensions', () => {
  api.setTypeForTest('card');
  const coil = 1000, width = 280, length = 430;
  const best = api.cardRows(coil,width,length,.6,3,180000).sort(api.compareCardRows)[0];
  const swapped = api.cardRows(coil,length,width,.6,3,180000).sort(api.compareCardRows)[0];
  const expected = [];
  for (let a=0; a<=25; a++) for (let b=0; b<=25-a; b++) {
    const used = width*a + length*b;
    if (used <= 0 || used > 993) continue;
    const price = 180000 + 6368 + 4060 + 172000 * (coil-used) / used;
    expected.push({ price, used });
  }
  expected.sort((a,b)=>a.price-b.price || b.used-a.used);
  near(best.total,expected[0].price);
  assert.equal(best.scrap,10);
  near(swapped.total,best.total);
  assert.equal(swapped.scrap,best.scrap);
  const cuts = api.cardCutDimensions(best.layoutWidths,width,length);
  assert.equal(JSON.stringify(cuts),JSON.stringify([{across:280,along:430,count:2},{across:430,along:280,count:1}]));
  const rotatedOnly = api.cardRows(550,700,400,.6,3,180000).sort(api.compareCardRows)[0];
  assert.equal(rotatedOnly.layoutWidths[0],400);
  api.setTypeForTest('strip');
});
test('two-stage strip search represents every feasible yield in a brute-force case', () => {
  api.setTypeForTest('strip');
  const coil=1000, width=70, trim=7;
  const expected=new Set();
  const visit=(counts, used, start) => {
    if (counts.length>=2) expected.add(counts.reduce((a,b)=>a+b,0));
    for (let n=start;n<=15;n++) {
      const intermediate=n*width+trim;
      if (used+intermediate>coil-trim) break;
      visit([...counts,n],used+intermediate,n);
    }
  };
  visit([],0,1);
  const actual=new Set(api.subcutLayouts(coil,width,.6).map(row=>row.count));
  assert.deepEqual([...actual].sort((a,b)=>a-b),[...expected].sort((a,b)=>a-b));
  const rows = api.stripRows(coil,[width],.6,.25,180000,'single',[],'tons',0);
  const twoStage = rows.filter(row=>row.subcuts);
  for (const row of twoStage) near(row.sourceVolume*row.yieldRate,.25);
  const ranked=rows.sort((a,b)=>api.compareStripRows(a,b,'single',1));
  // Первый проход рассчитывается по исходной массе, повторная резка —
  // по суммарной массе промежуточных рулонов, а не по исходной.
  const independentPrice = row => {
    const source = row.sourceVolume, intermediateWidth = row.subcutWidths
      ? row.subcutWidths.reduce((sum,w) => sum+w,0) : 0;
    const first = 6368*Math.max(source,3)/.25;
    const second = row.subcutWidths ? 3460*source*intermediateWidth/(coil*.25) : 0;
    const scrap = 172000*(1-row.yieldRate)/row.yieldRate;
    return 180000+first+second+scrap;
  };
  rows.forEach(row=>near(row.total,independentPrice(row)));
  near(ranked[0].total,Math.min(...rows.map(independentPrice)));
});

test('batch card chooses price first and yield on ties, regardless of coil width', () => {
  const rows = [
    {coilWidth:1000,total:13612,yieldRate:.8},
    {coilWidth:1250,total:13612,yieldRate:.96},
    {coilWidth:1219,total:13612,yieldRate:1200/1219}
  ];
  const items = [{orderVolume:2,calculation:{rows}}];
  assert.equal(api.bestCardBatchCoilWidth([1000,1250,1219],items),1219);
  assert.equal(api.bestCardBatchCoilWidth([1000,1250],items),1250);
  rows[0].total -= 1;
  assert.equal(api.bestCardBatchCoilWidth([1000,1250,1219],items),1000);
});

test('119.5 mm strip avoids a single-lane layout when material price is zero', () => {
  api.setTypeForTest('strip');
  api.setMaterialCostForTest(0);
  try {
    const rows = [1000,1219,1250,1500].flatMap(coil =>
      api.stripRows(coil,[119.5],1,1,0,'single',[],'tons',0)
    ).sort((a,b) => api.compareStripRows(a,b,'single',1));
    const best = rows[0];
    assert.equal(best.coilWidth,1219);
    assert.equal(best.layoutWidths.length,10);
    near(best.scrap,24);
    near(best.sourceVolume,1219/1195);
    near(best.finishedVolume,1);
    near(best.processing,3*6368);
    near(best.total,19104);
    const wasteful = rows.find(row => row.coilWidth===1500 && row.pieces===1 && !row.subcuts);
    assert.ok(wasteful);
    near(wasteful.sourceVolume,1500/119.5);
    assert.ok(wasteful.total > 79000);
    assert.ok(wasteful.total > best.total);
    for (const row of rows) {
      near(row.sourceVolume * row.yieldRate,row.finishedVolume);
      near(row.processing,row.operations.reduce((sum,operation) => sum + operation.price,0));
      near(row.total,row.price + row.processing + row.scrapCost);
    }
  } finally {
    api.setMaterialCostForTest(172000);
  }
});

test('mixed strip operations are also converted to rubles per finished tonne', () => {
  api.setTypeForTest('strip');
  api.setMaterialCostForTest(0);
  try {
    const rows = api.stripRows(1000,[150,310],.6,3,0,'multiple',
      [{width:150,quantity:1},{width:310,quantity:2}],'tons',0);
    const layout = rows.find(row =>
      row.layoutWidths.filter(width => width===150).length===2
      && row.layoutWidths.filter(width => width===310).length===2
    );
    assert.ok(layout);
    near(layout.sourceVolume,3/0.92);
    near(layout.finishedVolume,3);
    near(layout.processing,6368*layout.sourceVolume/3);
    near(layout.total,layout.processing);
  } finally {
    api.setMaterialCostForTest(172000);
  }
});


test('mixed two-stage subcuts combine several widths and preserve mass at both passes', () => {
  api.setTypeForTest('strip');
  api.setMaterialCostForTest(0);
  const orders = [
    {width:74,quantity:1},{width:87,quantity:1},
    {width:120,quantity:.35},{width:78,quantity:1}
  ];
  try {
    const rows = [1000,1219,1250,1500].flatMap(coil =>
      api.stripRows(coil,[74,87,120,78],2,3.35,0,'multiple',orders,'tons',0)
    ).sort((a,b)=>api.compareStripRows(a,b,'multiple',4));
    const oldSubcuts=rows.filter(row=>row.subcuts>=2 && !row.readyWidths?.length)
      .sort((a,b)=>api.compareStripRows(a,b,'multiple',4));
    assert.ok(oldSubcuts.length);
    const best=oldSubcuts[0];
    assert.equal(best.coilWidth,1219);
    assert.ok(best.subcuts>=2);
    assert.ok(best.layoutScore < .2);
    near(best.sourceVolume*best.yieldRate,3.35);
    const firstWidths=best.subcutGroups.reduce((sum,group)=>sum+group.width,0);
    near(best.sourceScrap+firstWidths,best.coilWidth);
    let finalWidths=0;
    for (const group of best.subcutGroups) {
      assert.ok(group.widths.length<=api.maxStrips(2,group.width));
      assert.ok(group.scrap>=api.minimumScrap());
      near(group.scrap+group.widths.reduce((sum,width)=>sum+width,0),group.width);
      finalWidths+=group.widths.reduce((sum,width)=>sum+width,0);
    }
    near(finalWidths+best.scrap,best.coilWidth);
    near(best.processing,best.operations.reduce((sum,op)=>sum+op.price,0));
    const expectedFirst=6368*Math.max(best.sourceVolume,3)/3.35;
    const expectedSecond=3460*best.sourceVolume*firstWidths/(best.coilWidth*3.35);
    near(best.processing,expectedFirst+expectedSecond);
    const direct=rows.filter(row=>!row.subcuts).sort((a,b)=>api.compareStripRows(a,b,'multiple',4))[0];
    assert.ok(best.layoutScore<direct.layoutScore);
  } finally {
    api.setMaterialCostForTest(172000);
  }
});

test('optional lower trim permits 6 mm but never 5 mm on every pass', () => {
  api.setTypeForTest('strip');
  assert.equal(api.minimumScrap(),7);
  assert.equal(api.stripLayouts(1000,994,1).length,0);
  api.setSmallScrapForTest(true);
  try {
    assert.equal(api.minimumScrap(),6);
    assert.equal(api.stripLayouts(1000,994,1).length,1);
    assert.equal(api.stripLayouts(1000,995,1).length,0);
    const orders=[{width:74,quantity:1},{width:87,quantity:1},{width:120,quantity:.35},{width:78,quantity:1}];
    const rows=api.stripRows(1000,[74,87,120,78],2,3.35,0,'multiple',orders,'tons',0);
    const via=rows.filter(row=>row.subcuts);
    assert.ok(via.length);
    for(const row of via) {
      assert.ok(row.sourceScrap>=6-1e-8);
      for(const group of row.subcutGroups) assert.ok(group.scrap>=6-1e-8);
      near(row.sourceVolume*row.yieldRate,3.35);
    }
    api.setTypeForTest('card');
    assert.equal(api.minimumScrap(),7);
  } finally {
    api.setTypeForTest('strip');
    api.setSmallScrapForTest(false);
  }
});


test('hybrid first pass makes finished widths plus exactly one subcoil; only subcoil is cut twice', () => {
  api.setTypeForTest('strip');
  api.setMaterialCostForTest(0);
  const orders=[{width:74,quantity:1},{width:78,quantity:1},{width:87,quantity:1},{width:120,quantity:.35}];
  try {
    const rows=api.stripRows(1219,[74,78,87,120],2,3.35,0,'multiple',orders,'tons',0);
    const hybrid=rows.filter(row=>row.readyWidths?.length && row.subcutGroups?.length===1)
      .sort((a,b)=>api.compareStripRows(a,b,'multiple',4))[0];
    assert.ok(hybrid,'must find at least one hybrid layout');
    assert.equal(hybrid.subcuts,1);
    assert.equal(hybrid.subcutGroups.length,1);
    assert.equal(hybrid.operations.filter(operation=>operation.name.includes('Продольная резка')).length,2,
      'a hybrid needs two cutting operations, not one per strip or per subcoil');
    assert.equal(hybrid.coilWidth,1219);
    assert.equal(hybrid.layoutWidths.length,14);
    near(hybrid.sourceVolume,3.551);
    near(hybrid.sourceVolume*hybrid.yieldRate,3.35);
    const group=hybrid.subcutGroups[0];
    const readyWidth=hybrid.readyWidths.reduce((sum,w)=>sum+w,0);
    near(readyWidth+group.width+hybrid.sourceScrap,1219);
    near(group.widths.reduce((sum,w)=>sum+w,0)+group.scrap,group.width);
    assert.ok(hybrid.readyWidths.length+1<=api.maxStrips(2,1219));
    assert.ok(group.widths.length<=api.maxStrips(2,group.width));
    assert.ok(hybrid.sourceScrap>=7&&group.scrap>=7);
    const directMass=hybrid.sourceVolume*readyWidth/1219;
    const subcoilMass=hybrid.sourceVolume*group.width/1219;
    const secondTons=hybrid.sourceVolume*group.widths.reduce((sum,w)=>sum+w,0)/1219;
    near(directMass+secondTons,3.35);
    assert.ok(subcoilMass<hybrid.sourceVolume);
    near(hybrid.operations[1].price,3460*subcoilMass/3.35);
    near(hybrid.processing,hybrid.operations.reduce((sum,operation)=>sum+operation.price,0));
    const multi=rows.filter(row=>!row.readyWidths && row.subcuts>1
       && row.layoutWidths.length===hybrid.layoutWidths.length
       && [74,78,87,120].every(width=>
         row.layoutWidths.filter(w=>w===width).length===hybrid.layoutWidths.filter(w=>w===width).length
       )).sort((a,b)=>a.total-b.total)[0];
    assert.ok(multi,'same delivered quantities must have two-subcoil alternative');
    assert.ok(hybrid.total<multi.total,'hybrid must win on cost for same delivered output');
  } finally {
    api.setMaterialCostForTest(172000);
  }
});

test('hybrid optional 6mm minimum applies to source and subcoil independently', () => {
  api.setTypeForTest('strip');
  const orders=[{width:74,quantity:1},{width:78,quantity:1},{width:87,quantity:1},{width:120,quantity:.35}];
  api.setSmallScrapForTest(true);
  try {
    const rows=api.stripRows(1219,[74,78,87,120],2,3.35,0,'multiple',orders,'tons',0);
    const hybrids=rows.filter(row=>row.readyWidths?.length && row.subcutGroups?.length===1);
    assert.ok(hybrids.length);
    assert.ok(hybrids.some(row=>row.subcutGroups[0].scrap===6));
    for(const row of hybrids) {
      assert.ok(row.sourceScrap>=6-1e-8);
      assert.ok(row.subcutGroups[0].scrap>=6-1e-8);
      assert.ok(row.readyWidths.length+1<=api.maxStrips(2,1219));
      near(row.sourceVolume*row.yieldRate,3.35);
    }
  } finally {
    api.setSmallScrapForTest(false);
  }
});


test('lowest actual cost wins among all plans that fit the per-width tolerance', () => {
  api.setTypeForTest('strip');
  api.setMaterialCostForTest(0);
  api.setToleranceForTest(10);
  const orders=[{width:74,quantity:1},{width:78,quantity:1},{width:87,quantity:1},{width:120,quantity:.35}];
  try {
    const rows=[1000,1219,1250,1500].flatMap(coil=>
      api.stripRows(coil,[74,78,87,120],2,3.35,0,'multiple',orders,'tons',0)
    ).sort((a,b)=>api.compareStripRows(a,b,'multiple',4));
    const best=rows[0];
    assert.equal(best.coilWidth,1250);
    assert.equal(best.subcutGroups.length,1);
    assert.equal(best.readyWidths.length,9);
    assert.equal(best.subcutGroups[0].width,455);
    near(best.sourceVolume,3.35*1250/1228);
    near(best.scrap,22);
    near(best.processing,6368*best.sourceVolume/3.35+3460*455/1228);
    assert.ok(best.maxDeviation<.10);
    const eligible=rows.filter(row=>row.maxDeviation<=.10+1e-9);
    assert.ok(eligible.length>0);
    assert.ok(eligible.every(row=>row.total+1e-7>=best.total));
    assert.equal(best.operations.filter(op=>op.name.includes('Продольная резка')).length,2);
  } finally {
    api.setMaterialCostForTest(172000);
  }
});

test('price ranking cannot hide a size that violates the configured tolerance', () => {
  api.setTypeForTest('strip');
  const example={coilWidth:1250,yieldRate:.9,layoutScore:.2,maxDeviation:.08,total:12000};
  const cheap={...example,maxDeviation:.13,total:8000};
  api.setToleranceForTest(10);
  assert.ok(api.compareStripRows(example,cheap,'multiple',4)<0);
  api.setToleranceForTest(15);
  assert.ok(api.compareStripRows(cheap,example,'multiple',4)<0);
  api.setToleranceForTest(10);
});


test('source roll choice restricts only strip calculations', () => {
  assert.deepEqual(Array.from(api.sourceCoilChoices('strip',53,'any')),[1000,1219,1250,1500]);
  assert.deepEqual(Array.from(api.sourceCoilChoices('strip',53,'1000')),[1000]);
  assert.deepEqual(Array.from(api.sourceCoilChoices('strip',120,'1219')),[1219]);
  assert.deepEqual(Array.from(api.sourceCoilChoices('strip',120,'1250')),[1250]);
  assert.deepEqual(Array.from(api.sourceCoilChoices('strip',120,'1500')),[1500]);
  assert.deepEqual(Array.from(api.sourceCoilChoices('strip',120,'invalid')),[1000,1219,1250,1500]);
  assert.deepEqual(Array.from(api.sourceCoilChoices('card',200,'1000')),[1000,1219,1250,1500]);
  assert.deepEqual(Array.from(api.sourceCoilChoices('rewind',1250,'1000')),[1250]);
});

test('results show three distinct schemes for each available source roll', () => {
  const plans=[
    {coilWidth:1000,layoutWidths:[120,120],total:1000},
    {coilWidth:1000,layoutWidths:[120,120],total:1100},
    {coilWidth:1000,layoutWidths:[120,120,120],total:1200},
    {coilWidth:1000,layoutWidths:[120,120,120,120],total:1300},
    {coilWidth:1000,layoutWidths:[120,120,120,120,120],total:1400},
    {coilWidth:1219,layoutWidths:[120],total:1500},
    {coilWidth:1219,layoutWidths:[120,120],total:1600}
  ];
  const selected=api.selectStripResults(plans,3);
  assert.equal(selected.filter(row=>row.coilWidth===1000).length,3);
  assert.equal(selected.filter(row=>row.coilWidth===1219).length,2);
  assert.equal(selected.find(row=>row.coilWidth===1000).total,1000);
});

test('combined route can produce ready strips plus multiple subcoils on the same first pass', () => {
  api.setTypeForTest('strip');
  api.setMaterialCostForTest(0);
  const orders=[
    {width:74,quantity:1},{width:78,quantity:1},
    {width:87,quantity:1},{width:120,quantity:.35}
  ];
  for(const six of [false,true]){
    api.setSmallScrapForTest(six);
    const trim=api.minimumScrap();
    const rows=api.stripRows(1250,[74,78,87,120],2,3.35,0,'multiple',orders,'tons',0);
    const mixed=rows.filter(row=>row.readyWidths?.length && row.subcutGroups?.length>=2);
    assert.ok(mixed.length,'must construct mixed first pass with 2+ subcoils');
    for(const row of mixed){
      assert.equal(row.operations.filter(op=>op.name.includes('Продольная резка')).length,2);
      const first=[...row.readyWidths,...row.subcutGroups.map(g=>g.width)];
      assert.ok(first.length<=api.maxStrips(2,1250));
      assert.ok(row.sourceScrap>=trim-1e-8);
      near(first.reduce((sum,w)=>sum+w,0)+row.sourceScrap,1250);
      const finalWidths=[...row.readyWidths,...row.subcutGroups.flatMap(group=>group.widths)];
      near(finalWidths.reduce((sum,w)=>sum+w,0)+row.scrap,1250);
      for(const group of row.subcutGroups){
        assert.ok(group.widths.length<=api.maxStrips(2,group.width));
        assert.ok(group.scrap>=trim-1e-8);
        near(group.widths.reduce((sum,w)=>sum+w,0)+group.scrap,group.width);
      }
      near(row.sourceVolume*row.yieldRate,3.35);
      near(row.processing,row.operations.reduce((sum,op)=>sum+op.price,0));
      const firstRate=6368; // Все ленты примера шире 30 мм.
      const source=row.sourceVolume;
      const secondCost=row.subcutGroups.reduce((sum,group)=>sum+3460*group.width/1250,0);
      near(row.processing,(firstRate*Math.max(source,3)/source+secondCost)*source/3.35);
    }
  }
  api.setSmallScrapForTest(false);
  api.setMaterialCostForTest(172000);
});

test('one-width order considers first-pass finished strips plus one second-pass subcoil', () => {
  api.setTypeForTest('strip');
  const layouts=api.singleStripHybridLayouts(1219,70,1);
  assert.ok(layouts.length);
  const rows=api.stripRows(1219,[70],1,1,0,'single',[],'tons',0);
  assert.ok(rows.some(row=>row.readyWidths?.length===1 && row.subcutGroups?.length===1));
});
