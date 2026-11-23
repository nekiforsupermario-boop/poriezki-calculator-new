// Дополнительные двухэтапные схемы для смешанных заказов ленты.
// Загружается ДО app.js, выполняется только при вызове из stripRows().
// Поиск ограничен по числу комбинаций для быстрого отклика браузера.
function mixedSubcutLayouts(coilWidth, stripWidths, thickness, orders, unit, length) {
  const widths = [...new Set(stripWidths)].sort((a,b)=>a-b);
  const trim = minimumScrap(), sourceLimit=maxStrips(thickness,coilWidth);
  if (widths.length<2 || widths.length>12 || sourceLimit<2
      || widths.reduce((s,w)=>s+w,0)+3*trim>coilWidth) return [];
  const targets=new Map();
  for (const order of orders) {
    const tons=quantityToTons(order.quantity,unit,thickness,order.width,length);
    targets.set(order.width,(targets.get(order.width)||0)+tons);
  }
  const targetTons=widths.map(w=>targets.get(w)||0);
  const orderTons=targetTons.reduce((a,b)=>a+b,0);
  if (!(orderTons>0) || targetTons.some(t=>!(t>0))) return [];
  const allMask=(1<<widths.length)-1;
  const available=coilWidth-2*trim;
  const groups=[], counts=Array(widths.length).fill(0);
  // Этап 2: генерация допустимых раскроев одного промежуточного рулона.
  function build(index,used,strips,mask) {
    if(groups.length>=12000) return;
    if(index===widths.length) {
      if(!strips) return;
      const width=used+trim;
      if(strips<=maxStrips(thickness,width))
        groups.push({width,used,strips,counts:counts.slice(),mask});
      return;
    }
    const maxCount=Math.min(sourceLimit-strips,Math.floor((available-used+1e-8)/widths[index]));
    for(let n=0;n<=maxCount;n++) {
      counts[index]=n;
      build(index+1,used+n*widths[index],strips+n,n?mask|(1<<index):mask);
      if(groups.length>=12000) break;
    }
    counts[index]=0;
  }
  build(0,0,0,0);
  if(!groups.length) return [];
  // При большом числе комбинаций сохраняем выборку с разными наборами лент
  // и разной шириной подкатов. Поиск не выдаётся за глобально точный.
  let pool=groups;
  if(groups.length>960) {
    const byMask=new Map();
    for(const group of groups) {
      if(!byMask.has(group.mask)) byMask.set(group.mask,[]);
      byMask.get(group.mask).push(group);
    }
    pool=[];
    const perMask=Math.max(8,Math.floor(960/byMask.size));
    for(const items of byMask.values()) {
      items.sort((a,b)=>a.width-b.width);
      const chosen=new Set();
      for(let i=0;i<Math.min(items.length,perMask);i++) {
        const at=perMask===1?0:Math.round(i*(items.length-1)/(perMask-1));
        chosen.add(at);
      }
      for(const at of chosen) pool.push(items[at]);
    }
  }
  pool.sort((a,b)=>a.width-b.width);
  function score(countVector,used) {
    if(!(used>0)) return Infinity;
    let loss=0;
    for(let i=0;i<widths.length;i++)
      loss+=Math.abs(orderTons*countVector[i]*widths[i]/used-targetTons[i])/targetTons[i];
    return loss;
  }
  const rank=(a,b)=>(Math.abs(a.score-b.score)>1e-9?a.score-b.score:0)
    || b.used-a.used || a.maxWidth-b.maxWidth;
  const finals=[];
  function keepFinal(state) {
    if(finals.length>=80 && rank(state,finals[finals.length-1])>=0) return;
    finals.push(state);
    if(finals.length>=160) {finals.sort(rank);finals.length=80;}
  }
  function keepPartial(buckets,state) {
    let bucket=buckets.get(state.mask);
    if(!bucket) {bucket=[];buckets.set(state.mask,bucket);}
    state.heuristic=state.score-0.15*state.used/coilWidth;
    if(bucket.length>=80 && state.heuristic>=bucket[bucket.length-1].heuristic) return;
    bucket.push(state);
    if(bucket.length>=160) {
      bucket.sort((a,b)=>a.heuristic-b.heuristic||b.used-a.used);
      bucket.length=80;
    }
  }
  let states=pool.map((group,i)=>({
    indices:[i],last:i,counts:group.counts,width:group.width,
    used:group.used,mask:group.mask,maxWidth:group.width,score:score(group.counts,group.used)
  }));
  const maxGroups=Math.min(4,sourceLimit);
  // Этап 1: раскладка 2–4 подкатов внутри исходного рулона.
  for(let depth=2;depth<=maxGroups && states.length;depth++) {
    const buckets=new Map();
    for(const state of states) for(let i=state.last;i<pool.length;i++) {
      const group=pool[i],newWidth=state.width+group.width;
      if(newWidth>coilWidth-trim+1e-8) break;
      const newCounts=state.counts.map((n,k)=>n+group.counts[k]);
      const newUsed=state.used+group.used, newMask=state.mask|group.mask;
      const next={
        indices:[...state.indices,i],last:i,counts:newCounts,width:newWidth,
        used:newUsed,mask:newMask,maxWidth:Math.max(state.maxWidth,group.width),
        score:score(newCounts,newUsed)
      };
      if(newMask===allMask) keepFinal(next);
      if(depth<maxGroups) keepPartial(buckets,next);
    }
    if(finals.length>80) {finals.sort(rank);finals.length=80;}
    states=[];
    for(const bucket of buckets.values()) {
      bucket.sort((a,b)=>a.heuristic-b.heuristic||b.used-a.used);
      states.push(...bucket.slice(0,40));
    }
  }
  finals.sort(rank);
  // Несколько вариантов с одинаковой геометрией не дают полезной альтернативы.
  const unique=new Set(), result=[];
  for(const state of finals) {
    const ordered=state.indices.map(i=>pool[i]);
    const key=state.counts.join('/')+':'+ordered.map(g=>g.width.toFixed(4)).join('/');
    if(unique.has(key)) continue;
    unique.add(key);
    const subcutGroups=ordered.map(group=>{
      const finalWidths=group.counts.flatMap((n,i)=>Array(n).fill(widths[i]));
      return {width:group.width,widths:finalWidths,scrap:group.width-group.used};
    });
    const finalWidths=subcutGroups.flatMap(group=>group.widths);
    result.push({
      subcutGroups,finalWidths,
      label:widths.map((w,i)=>state.counts[i]?`${state.counts[i]}×${decimal(w)} мм`:'').filter(Boolean).join(' + '),
      score:state.score
    });
    if(result.length>=60) break;
  }
  return result;
}

// Первый проход оплачивается по исходной массе; второй — по массе подкатов.
// Возвращённые цены на этом этапе руб/т ИСХОДНОГО металла.
// stripPricingPerFinishedTon() затем переводит их в руб/т готовой ленты.
function serviceDataWithMixedSubcut(coilWidth,thickness,sourceVolume,price,layout) {
  const groups=layout.subcutGroups;
  if(!groups || groups.length<2) return null;
  const intermediateWidths=groups.map(group=>group.width);
  const finalWidths=layout.finalWidths;
  const trim=minimumScrap();
  const sourceScrap=coilWidth-intermediateWidths.reduce((sum,w)=>sum+w,0);
  const finalUsed=finalWidths.reduce((sum,w)=>sum+w,0);
  if(sourceScrap+1e-8<trim || !(finalUsed>0)
      || groups.some(g=>g.width-g.widths.reduce((sum,w)=>sum+w,0)+1e-8<trim
        || g.widths.length>maxStrips(thickness,g.width))) return null;
  const base=serviceData(coilWidth,intermediateWidths,thickness,sourceVolume,price,layout.label);
  if(!base) return null;
  const hasGrinding=getRadio('surface')==='4n';
  const firstMode=hasGrinding?'open':(getRadio('openMode')||'open');
  const surcharge=$('specialConditions')?.checked?PRICE.longitudinal.special:0;
  const discount=$('furtherProcessing')?.checked?PRICE.longitudinal.followUpDiscount:0;
  const firstRate=longitudinalRate(Math.max(...intermediateWidths),firstMode,coilWidth);
  const first=Math.max(0,charge(firstRate,sourceVolume,PRICE.longitudinal.minTons,firstMode)+surcharge);
  const second=groups.reduce((sum,group)=>{
    const rate=longitudinalRate(Math.max(...group.widths),'open',group.width);
    const share=group.width/coilWidth; // масса данного подката / исходная масса
    return sum+Math.max(0,rate+surcharge-discount)*share;
  },0);
  const replacement=[
    {name:hasGrinding?'2. Продольная резка подкатов':'1. Продольная резка подкатов',
      mode:firstMode==='open'?'открытый рулон до конца':firstMode==='full'?'полный рулон':'частичный рулон',price:first},
    {name:hasGrinding?'3. Продольная резка в ленту':'2. Продольная резка в ленту',
      mode:'открытый рулон до конца',price:second}
  ];
  const prev=base.operations.filter(op=>op.name.includes('Продольная резка')).reduce((s,op)=>s+op.price,0);
  base.operations=base.operations.flatMap(op=>op.name.includes('Продольная резка')?replacement:[op]);
  base.layoutWidths=finalWidths;
  base.pieces=finalWidths.length;
  base.subcutGroups=groups;
  base.subcutWidths=intermediateWidths;
  base.subcuts=groups.length;
  base.subcutTrim=trim;
  base.sourceScrap=sourceScrap;
  base.subcutScrapTotal=groups.reduce((sum,g)=>sum+g.scrap,0);
  base.subcutScrap=base.subcutScrapTotal;
  base.scrap=coilWidth-finalUsed;
  base.yieldRate=finalUsed/coilWidth;
  const cost=numericInputValue($('materialCost').value);
  base.effectiveMaterial=cost/base.yieldRate;
  base.scrapCost=cost*(1-base.yieldRate)/base.yieldRate;
  base.firstCut=first;
  base.secondCut=second;
  base.cutting=base.cutting-prev+first+second;
  base.film=filmPrice(selectedType,thickness,base.yieldRate,coilWidth);
  const filmOp=base.operations.find(op=>op.name==='Плёнка');
  if(filmOp)filmOp.price=base.film;
  base.processing=base.operations.reduce((sum,op)=>sum+op.price,0);
  base.total=base.price+base.processing+base.scrapCost;
  return base;
}
