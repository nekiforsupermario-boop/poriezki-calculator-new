// Комбинированный раскрой: готовые полосы + 2 или 3 подката на первом
// проходе, затем продольная порезка только подкатов.
// Одноподкатный, прямой и вариант без готовых полос ищутся существующими
// алгоритмами. Вместе они образуют один набор кандидатов для ранжирования.
// Поиск имеет явные ограничения и НЕ гарантирует глобального оптимума.
function combinedStripLayouts(coilWidth,stripWidths,thickness,orders,unit,length) {
  const widths=[...new Set(stripWidths)].sort((a,b)=>a-b);
  const trim=minimumScrap();
  const firstLimit=maxStrips(thickness,coilWidth);
  if(widths.length<2||widths.length>8||firstLimit<3) return [];
  const targetByWidth=new Map();
  for(const order of orders) {
    const tons=quantityToTons(order.quantity,unit,thickness,order.width,length);
    targetByWidth.set(order.width,(targetByWidth.get(order.width)||0)+tons);
  }
  const targets=widths.map(w=>targetByWidth.get(w)||0);
  const volume=targets.reduce((s,v)=>s+v,0);
  if(!(volume>0)||targets.some(x=>!(x>0)))return [];
  const allMask=(1<<widths.length)-1;
  const smallest=widths[0];
  const maxReadyUsed=coilWidth-3*trim-2*smallest;
  if(maxReadyUsed<smallest) return [];

  const gather=(kind)=>{
    const rows=[], counts=Array(widths.length).fill(0);
    const minUsed=kind==='group'?0:smallest;
    const hardLimit=kind==='group'?11000:6500;
    const maxUsed=kind==='group'?coilWidth-2*trim-smallest:maxReadyUsed;
    const maxCount=kind==='group'?firstLimit:firstLimit-2;
    function walk(i,used,n,mask) {
      if(rows.length>=hardLimit)return;
      if(i===widths.length) {
        if(!n)return;
        const groupWidth=used+trim;
        if(kind==='group' && n>maxStrips(thickness,groupWidth))return;
        rows.push({counts:counts.slice(),used,n,mask,width:kind==='group'?groupWidth:used});
        return;
      }
      const limit=Math.min(maxCount-n,Math.floor((maxUsed-used+1e-8)/widths[i]));
      for(let k=0;k<=limit;k++) {
        counts[i]=k;
        walk(i+1,used+k*widths[i],n+k,k?mask|(1<<i):mask);
        if(rows.length>=hardLimit)break;
      }
      counts[i]=0;
    }
    walk(0,0,0,0);
    return rows;
  };
  const targetShares=targets.map(t=>t/volume);
  function ratioScore(row) {
    if(!(row.used>0))return Infinity;
    return row.counts.reduce((sum,n,i)=>sum+Math.abs(n*widths[i]/row.used-targetShares[i]),0);
  }
  // Не заполняем всё пространство вариантов одной маской и одним размером
  // подката: сохраняем малые, большие и близкие к заказу комбинации.
  function sampleByMask(rows,budget) {
    if(rows.length<=budget)return rows.sort((a,b)=>a.width-b.width);
    const buckets=new Map();
    for(const row of rows) {
      if(!buckets.has(row.mask))buckets.set(row.mask,[]);
      buckets.get(row.mask).push(row);
    }
    const result=[];
    const perMask=Math.max(4,Math.floor(budget/buckets.size));
    for(const set of buckets.values()) {
      set.sort((a,b)=>a.width-b.width);
      const indices=new Set();
      const end=Math.min(set.length,perMask);
      for(let j=0;j<Math.ceil(end*.55);j++) {
        const at=end<=1?0:Math.round(j*(set.length-1)/(Math.ceil(end*.55)-1||1));
        indices.add(at);
      }
      const nearest=set.map((row,i)=>({i,score:ratioScore(row)}))
        .sort((a,b)=>a.score-b.score);
      for(const item of nearest.slice(0,end-indices.size))indices.add(item.i);
      for(const index of indices)result.push(set[index]);
    }
    return result.sort((a,b)=>a.width-b.width);
  }
  const readyPool=sampleByMask(gather('ready'),200);
  const groupPool=sampleByMask(gather('group'),135);
  if(!readyPool.length||!groupPool.length)return [];

  const priceForFirst=(ready,groups,used)=>{
    const sourceVolume=volume*coilWidth/used;
    const firstWidths=[...widths.flatMap((w,i)=>Array(ready.counts[i]).fill(w)),...groups.map(g=>g.width)];
    const firstMode=getRadio('surface')==='4n'?'open':getRadio('openMode')||'open';
    const surcharge=$('specialConditions')?.checked?PRICE.longitudinal.special:0;
    const discount=$('furtherProcessing')?.checked?PRICE.longitudinal.followUpDiscount:0;
    const firstRate=longitudinalRate(Math.max(...firstWidths),firstMode,coilWidth);
    const first=Math.max(0,charge(firstRate,sourceVolume,PRICE.longitudinal.minTons,firstMode)+surcharge);
    const second=groups.reduce((sum,g)=>{
      const maxFinal=Math.max(...widths.filter((w,i)=>g.counts[i]>0));
      const rate=longitudinalRate(maxFinal,'open',g.width);
      return sum+Math.max(0,rate+surcharge-discount)*g.width/coilWidth;
    },0);
    const cost=numericInputValue($('materialCost')?.value);
    return (first+second)*coilWidth/used+cost*(coilWidth-used)/used;
  };
  const toleranceRaw=Number($('stripTolerance')?.value);
  const tolerance=(Number.isFinite(toleranceRaw)&&toleranceRaw>=0&&toleranceRaw<=100?toleranceRaw:10)/100;
  const bestByCounts=new Map();
  const provisional=[];
  function inspect(ready,groups,firstWidth,finalUsed,finalCounts,mask) {
    if(mask!==allMask || !(finalUsed>0)||firstWidth>coilWidth-trim+1e-8)return;
    let score=0,maxDeviation=0;
    for(let i=0;i<widths.length;i++) {
      const actual=volume*finalCounts[i]*widths[i]/finalUsed;
      const deviation=Math.abs(actual-targets[i])/targets[i];
      score+=deviation;
      maxDeviation=Math.max(maxDeviation,deviation);
    }
    const estimate=priceForFirst(ready,groups,finalUsed);
    const key=finalCounts.join('/')+':'+groups.length;
    const previous=bestByCounts.get(key);
    const candidate={ready,groups,counts:finalCounts,used:finalUsed,score,maxDeviation,estimate};
    if(!previous||candidate.estimate<previous.estimate-1e-7)bestByCounts.set(key,candidate);
    return candidate;
  }
  // Шаблон first pass: <готовые полосы> + <подкат A> + <подкат B>.
  // Первый этап оплачивается один раз, не один раз на каждый подкат.
  const maskStates=new Map();
  function keepPartial(state){
    const bucket=maskStates.get(state.mask)||[];
    state.ratio=state.counts.reduce((sum,n,i)=>sum+Math.abs(n*widths[i]/state.used-targetShares[i]),0);
    state.scoreHint=state.ratio-0.07*state.used/coilWidth;
    bucket.push(state);
    maskStates.set(state.mask,bucket);
  }
  for(const ready of readyPool) {
    if(ready.n+2>firstLimit)continue;
    const maxRemaining=coilWidth-trim-ready.used;
    for(let i=0;i<groupPool.length;i++) {
      const g1=groupPool[i];
      if(ready.used+g1.width+smallest+trim>coilWidth-trim+1e-8)break;
      for(let j=i;j<groupPool.length;j++) {
        const g2=groupPool[j];
        const firstWidth=ready.used+g1.width+g2.width;
        if(firstWidth>maxRemaining+1e-8)break;
        const used=ready.used+g1.used+g2.used;
        const counts=ready.counts.map((x,k)=>x+g1.counts[k]+g2.counts[k]);
        const mask=ready.mask|g1.mask|g2.mask;
        inspect(ready,[g1,g2],firstWidth,used,counts,mask);
        if(ready.n+3<=firstLimit && firstWidth+smallest+trim<=maxRemaining+1e-8) {
          keepPartial({ready,groups:[g1,g2],last:j,firstWidth,used,counts,mask});
        }
      }
    }
  }
  // Три подката: используем разнообразную ограниченную выборку
  // двухподкатных состояний, чтобы время расчёта оставалось предсказуемым.
  const beam=[];
  for(const states of maskStates.values()) {
    states.sort((a,b)=>a.scoreHint-b.scoreHint||b.used-a.used);
    const selected=new Set();
    for(const state of states.slice(0,10))selected.add(state);
    for(const state of states.slice().sort((a,b)=>b.used-a.used).slice(0,5))selected.add(state);
    beam.push(...selected);
  }
  beam.sort((a,b)=>a.scoreHint-b.scoreHint);
  for(const state of beam.slice(0,300)) {
    for(let j=state.last;j<groupPool.length;j++) {
      const g=groupPool[j];
      const firstWidth=state.firstWidth+g.width;
      if(firstWidth>coilWidth-trim+1e-8)break;
      const counts=state.counts.map((n,i)=>n+g.counts[i]);
      inspect(state.ready,[...state.groups,g],firstWidth,state.used+g.used,counts,state.mask|g.mask);
    }
  }
  const candidates=[...bestByCounts.values()];
  if(!candidates.length)return [];
  const accepted=candidates.filter(x=>x.maxDeviation<=tolerance+1e-9)
    .sort((a,b)=>a.estimate-b.estimate||a.maxDeviation-b.maxDeviation);
  const closest=candidates.sort((a,b)=>a.maxDeviation-b.maxDeviation||a.score-b.score||a.estimate-b.estimate);
  const selection=new Map();
  for(const value of accepted.slice(0,70))selection.set(value.counts.join('/')+':'+value.groups.length,value);
  for(const value of closest.slice(0,20))selection.set(value.counts.join('/')+':'+value.groups.length,value);
  return [...selection.values()].map(state=>{
    const readyWidths=widths.flatMap((w,i)=>Array(state.ready.counts[i]).fill(w));
    const subcutGroups=state.groups.map(g=>({
      width:g.width,
      widths:widths.flatMap((w,i)=>Array(g.counts[i]).fill(w)),
      scrap:trim
    }));
    const finalWidths=[...readyWidths,...subcutGroups.flatMap(group=>group.widths)];
    const label=widths.map((w,i)=>state.counts[i]?`${state.counts[i]}×${decimal(w)} мм`:'').filter(Boolean).join(' + ');
    return {readyWidths,subcutGroups,finalWidths,label,score:state.score};
  });
}
