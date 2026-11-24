// Комбинированная порезка: готовые ленты + ОДИН подкат на первом проходе,
// затем повторная резка только подката. Лимиты по ножам действуют на каждый
// проход. Для 1–4 типоразмеров и небольшого числа комбинаций перебираем
// целочисленные варианты, для сложных задач используем ограниченный поиск.
// Геометрию храним в миллиметрах без округления.
function hybridStripLayouts(coilWidth, stripWidths, thickness, orders, unit, length) {
  const widths = [...new Set(stripWidths)].sort((a,b)=>a-b);
  const trim=minimumScrap(), sourceLimit=maxStrips(thickness,coilWidth);
  if(!widths.length || widths.length>12 || !sourceLimit
      || widths.reduce((s,w)=>s+w,0)+2*trim>coilWidth) return [];
  const targets=new Map();
  for(const order of orders) {
    const tons=quantityToTons(order.quantity,unit,thickness,order.width,length);
    targets.set(order.width,(targets.get(order.width)||0)+tons);
  }
  const totalTons=[...targets.values()].reduce((sum,t)=>sum+t,0);
  if(!(totalTons>0) || widths.some(w=>!(targets.get(w)>0))) return [];
  const totalTarget=widths.map(w=>targets.get(w));
  const materialCost=numericInputValue($('materialCost')?.value);
  const firstMode=getRadio('surface')==='4n'?'open':(getRadio('openMode')||'open');
  const allowed=coilWidth-2*trim;
  const counts=Array(widths.length).fill(0);
  const maxTotal=sourceLimit*2-1;
  const candidates=[];
  let complete=0,limitReached=false;
  const exhaustiveLimit=12000;
  function add(counts,used,total) {
    if(total<2 || total>maxTotal) return;
    let score=0,maxDeviation=0;
    for(let i=0;i<widths.length;i++){
      const actual=totalTons*counts[i]*widths[i]/used;
      const deviation=Math.abs(actual-totalTarget[i])/totalTarget[i];
      score+=deviation;
      maxDeviation=Math.max(maxDeviation,deviation);
    }
    // Один подкат должен вместить не менее n - (число ножей - 1) полос.
    const minSubCount=Math.max(1,total-sourceLimit+1);
    const allWidths=counts.flatMap((count,i)=>Array(count).fill(widths[i]));
    const sourceTons=totalTons*coilWidth/used;
    // Перестановки второй операции проверяются отдельно.
    for(let k=minSubCount;k<=Math.min(total-1,sourceLimit,minSubCount+2);k++){
      for(const direction of [1,-1]) {
        const sorted=direction===1?allWidths:allWidths.slice().reverse();
        const subWidths=sorted.slice(0,k);
        const directWidths=sorted.slice(k);
        const subUsed=subWidths.reduce((s,w)=>s+w,0);
        const subWidth=subUsed+trim;
        if(k>maxStrips(thickness,subWidth) || directWidths.length+1>sourceLimit)continue;
        const firstWidths=[...directWidths,subWidth];
        const firstScrap=coilWidth-firstWidths.reduce((s,w)=>s+w,0);
        if(firstScrap+1e-8<trim)continue;
        const firstTariff=longitudinalRate(Math.max(...firstWidths),firstMode,coilWidth);
        const secondTariff=longitudinalRate(Math.max(...subWidths),'open',subWidth);
        const firstCost=firstTariff*(firstMode==='open'?sourceTons:Math.max(PRICE.longitudinal.minTons,sourceTons))/totalTons;
        const secondCost=secondTariff*subWidth/used;
        const scrapCost=materialCost*(coilWidth-used)/used;
        const approxTotal=firstCost+secondCost+scrapCost;
        candidates.push({
          directWidths,subcutGroups:[{width:subWidth,widths:subWidths,scrap:trim}],
          finalWidths:allWidths.slice(),score,maxDeviation,approxTotal,
          label:widths.map((w,i)=>`${counts[i]}×${decimal(w)} мм`).join(' + ')
        });
      }
    }
  }
  function enumerate(i,used,total){
    if(limitReached)return;
    if(i===widths.length){
      if(++complete>exhaustiveLimit){limitReached=true;return;}
      add(counts,used,total); return;
    }
    const remain=widths.slice(i+1).reduce((s,w)=>s+w,0);
    const upper=Math.min(maxTotal-total-(widths.length-i-1),
      Math.floor((allowed-used-remain+1e-8)/widths[i]));
    for(let n=1;n<=upper;n++){
      counts[i]=n;
      enumerate(i+1,used+n*widths[i],total+n);
      if(limitReached)break;
    }
    counts[i]=0;
  }
  enumerate(0,0,0);
  if(limitReached) {
    // При экстремально узких лентах добавляем кандидатов вокруг целевых
    // пропорций. Это ограниченный поиск, а не обещание глобального оптимума.
    const maxAnchor=Math.min(maxTotal,Math.floor(allowed/widths[0]));
    for(let anchor=1;anchor<=maxAnchor;anchor++){
      const center=widths.map((w,i)=>i===0?anchor:anchor*widths[0]*totalTarget[i]/(w*totalTarget[0]));
      const values=center.map((c,i)=>i===0?[anchor]:[Math.max(1,Math.round(c)-1),Math.max(1,Math.round(c)),Math.max(1,Math.round(c)+1)]);
      const traverse=(i,used,total)=>{
        if(i===widths.length){ if(used<=allowed && total<=maxTotal) add(counts,used,total); return; }
        for(const n of [...new Set(values[i])]){
          if(total+n>maxTotal || used+n*widths[i]>allowed)continue;
          counts[i]=n;traverse(i+1,used+n*widths[i],total+n);
        }
      };
      traverse(0,0,0);
    }
  }
  const toleranceRaw=Number($('stripTolerance')?.value);
  const tolerance=Number.isFinite(toleranceRaw)?Math.max(0,Math.min(100,toleranceRaw))/100:0.10;
  const eligible=candidates.filter(x=>x.maxDeviation<=tolerance+1e-9);
  const byCost=(a,b)=>a.approxTotal-b.approxTotal||a.maxDeviation-b.maxDeviation||b.finalWidths.length-a.finalWidths.length;
  const byScore=(a,b)=>a.maxDeviation-b.maxDeviation||a.score-b.score||a.approxTotal-b.approxTotal;
  // Для небольших задач сохраняем ВСЕ подходящие по допуску варианты,
  // чтобы сравнивать точные цены, а не только предварительную оценку.
  const economic=eligible.sort(byCost);
  const shortlisted=[...(limitReached ? economic.slice(0,120) : economic),...candidates.sort(byScore).slice(0,40)];
  const seen=new Set(),result=[];
  for(const item of shortlisted) {
    const key=item.directWidths.slice().sort((a,b)=>a-b).join(',')+'|'+item.subcutGroups[0].widths.slice().sort((a,b)=>a-b).join(',');
    if(seen.has(key))continue;
    seen.add(key); result.push(item);
  }
  return result;
}
