(() => {
  const passwordHash = 'ad4941386c090ac54142d38b390d313075deff4d873a1c82e3a25540cf611127';
  const lock = document.getElementById('siteLock');
  const form = document.getElementById('siteLockForm');
  const input = document.getElementById('siteLockPassword');
  const error = document.getElementById('siteLockError');
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const unlock = () => { lock?.remove(); document.body.classList.remove('site-locked'); };
  if (sessionStorage.getItem('poriezki-unlocked') === '1') unlock();
  form?.addEventListener('submit', async event => { event.preventDefault(); if (await digest(input.value) === passwordHash) { sessionStorage.setItem('poriezki-unlocked', '1'); unlock(); } else { error.hidden = false; input.select(); } });
})();
const $ = id => document.getElementById(id);
function showCalculationError(message) {
  const old = document.querySelector('.calculation-error-modal');
  old?.remove();
  const modal = document.createElement('div');
  modal.className = 'calculation-error-modal';
  modal.innerHTML = '<div class="calculation-error-window" role="dialog" aria-modal="true" aria-labelledby="calculationErrorTitle"><h2 id="calculationErrorTitle">Не удалось выполнить расчёт</h2><p></p><button class="button primary" type="button">Понятно</button></div>';
  modal.querySelector('p').textContent = message;
  const close = () => modal.remove();
  modal.querySelector('button').addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  document.body.appendChild(modal);
}
const calculationErrorElement = $('error');
if (calculationErrorElement) new MutationObserver(() => { if (!calculationErrorElement.hidden) showCalculationError(calculationErrorElement.textContent || 'Проверьте заполнение параметров.'); }).observe(calculationErrorElement, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
const money = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value));
const decimal = value => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(String(value).replace(',', '.')));
const rateDecimal = value => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(String(value).replace(',', '.')));
const prettyLayout = value => String(value || '').replace(/(\d+(?:[.,]\d+)?)(?= мм)/g, value => decimal(value));
const pct = value => `${value.toFixed(2).replace('.', ',')}%`;
const typeNames = { strip: 'ленты', rewind: 'рулона', sheet: 'листа', card: 'карточки' };
const resultNames = { strip: 'Лента', rewind: 'Рулон / перемотка', sheet: 'Лист', card: 'Карточка' };
function fullNomenclature(type, thickness, width, length = 0) { const size = `${decimal(thickness)}×${decimal(width)}${type === 'sheet' || type === 'card' ? `×${decimal(length)}` : ''} мм`; return `${resultNames[type]} ${size}`; }
let selectedType = 'strip';
let lastCalculationTotal = 0;
let lastCalculation = null;

// Прайсы Ferrit от 01.03.2026. Все цены включают НДС.
const PRICE = {
  crossCut: { full: 4660, partial: 7032, open: 4060, minTons: 2, special: 1000 },
  longitudinal: {
    minTons: 3, special: 500, minScrap: 7, followUpDiscount: 500,
    standard: { '>30': { full: 4179, partial: 6368, open: 3460 }, '19-30': { full: 7112, partial: 11038, open: 5920 }, '12-18.9': { full: 10221, partial: 15948, open: 8250 }, '5-11.9': { full: 15131, partial: 22577, open: 11960 } },
    narrow: { '>30': { full: 4328, partial: 6667, open: 3460 }, '19-30': { full: 7397, partial: 11528, open: 5920 }, '12-18.9': { full: 10221, partial: 15948, open: 8250 }, '5-11.9': { full: 15131, partial: 22577, open: 11960 } }
  },
  rewind: { full: 4010, partial: 6165, open: 3460, narrowThin: { full: 4083, partial: 6372, open: 3460 }, minTons: 3 },
  grinding: { rollMinTons: 3, sheetMinTons: 3, roll: [{ max: .6, full: 8901, partial: 11790, open: 8254 }, { max: .8, full: 7469, partial: 10071, open: 6822 }, { max: 1, full: 6545, partial: 8962, open: 5898 }, { max: 1.5, full: 5944, partial: 8242, open: 5297 }, { max: 3, full: 5482, partial: 7687, open: 4835 }, { max: 5, full: 4928, partial: 7022, open: 4281 }], sheet: 10900, rewind: { full: 3760, partial: 5772, open: 3183 } },
  film: { pePerMeter: 60, lpePerMeter: 80 }, density: 7.8
};
const COIL_WIDTHS = [1000, 1219, 1250, 1500];
// Обычный минимальный откройник 7 мм; для согласованной нестандартной
// операции с лентой можно явно разрешить 6 мм, но никогда меньше.
const minimumScrap = () => selectedType === 'strip' && $('allowSmallScrap')?.checked ? 6 : PRICE.longitudinal.minScrap;
const getRadio = name => document.querySelector(`input[name="${name}"]:checked`)?.value || document.querySelector(`[name="${name}"]`)?.value || '';
const charge = (rate, volume, minTons, mode) => rate * (mode === 'open' ? volume : Math.max(volume, minTons)) / volume;
// Первая технологическая операция использует выбранный режим рулона.
// Любая последующая — только тариф «открытый рулон до конца», без повторного минимума.
function modeForNextOperation(operations, initialMode) {
  return operations.length ? 'open' : initialMode;
}

function showStep(step) { $('typeStep').hidden = step !== 1; $('paramsStep').hidden = step !== 2; $('resultsStep').hidden = step !== 3; ['step1Nav', 'step2Nav', 'step3Nav'].forEach((id, i) => $(id).classList.toggle('active', i + 1 === step)); }
function setupDeliveryMonths() { const select = $('deliveryMonth'); if (!select || select.options.length) return; const names = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'], now = new Date(); for (let offset = 0; offset < 12; offset += 1) { const date = new Date(now.getFullYear(), now.getMonth() + offset, 1), option = document.createElement('option'); option.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; option.textContent = `${names[date.getMonth()]} ${date.getFullYear()}`; select.appendChild(option); } }
function updateUnits() { const count = selectedType === 'sheet' || selectedType === 'card'; document.querySelectorAll('.unit-count').forEach(el => { el.hidden = !count; el.style.display = count ? '' : 'none'; }); document.querySelectorAll('.unit-meters').forEach(el => { el.hidden = count; el.style.display = count ? 'none' : ''; }); $('unitLegend').textContent = 'Единица заказа'; if ((count && getRadio('unit') === 'meters') || (!count && getRadio('unit') === 'pieces')) document.querySelector('input[name="unit"][value="tons"]').checked = true; }
function addOpenModeField() { const anchor = document.querySelector('.conditions') || document.querySelector('#paramsStep .actions'); if (!anchor || document.querySelector('input[name="openMode"]')) return; const row = document.createElement('div'); row.className = 'choice-row open-mode-row'; row.innerHTML = '<fieldset><legend>Рулон</legend><label class="radio"><input name="openMode" value="partial" type="radio" checked> Частично</label><label class="radio"><input name="openMode" value="full" type="radio"> Полностью</label><label class="radio"><input name="openMode" value="open" type="radio"> Полностью открытый</label></fieldset>'; anchor.before(row); }
function updateRewindWidthControl() { const label = $('productWidthLabel'), current = $('productWidth'); if (selectedType === 'rewind' && current?.tagName !== 'SELECT') { const select = document.createElement('select'); select.id = 'productWidth'; select.innerHTML = [1000, 1219, 1250, 1500].map(width => `<option value="${width}">${width} мм</option>`).join(''); select.value = [1000, 1219, 1250, 1500].includes(Number(current?.value)) ? current.value : '1250'; current?.replaceWith(select); } else if (selectedType !== 'rewind' && current?.tagName === 'SELECT') { const input = document.createElement('input'); input.id = 'productWidth'; input.type = 'number'; input.min = '1'; input.step = '1'; input.value = current.value || '125'; current.replaceWith(input); } label.firstChild.textContent = selectedType === 'rewind' ? 'Ширина рулона, мм' : 'Ширина готового изделия, мм'; }
function readStripWidths(raw) {
  const widths = String(raw ?? '').split(/[\/;]/).map(value => Number(value.trim().replace(',', '.')));
  return widths.every(width => Number.isFinite(width) && width > 0) ? [...new Set(widths)] : [];
}
function updateStripSizeControl() { const label = $('productWidthLabel'), current = $('productWidth'), quantityLabel = $('quantity')?.closest('label'), fieldGrid = document.querySelector('.field-grid'); if (!label || selectedType !== 'strip') { label?.querySelector('.strip-size-mode')?.remove(); document.querySelector('.multi-strip-orders')?.remove(); if (quantityLabel) quantityLabel.hidden = false; if (current?.type === 'text') { const input = document.createElement('input'); input.id = 'productWidth'; input.type = 'number'; input.min = '1'; input.step = '1'; input.value = readStripWidths(current.value)[0] || '125'; current.replaceWith(input); } return; } if (current?.type !== 'text') { const input = document.createElement('input'); input.id = 'productWidth'; input.type = 'text'; input.inputMode = 'decimal'; input.value = current?.value || '125'; current?.replaceWith(input); } if (!label.querySelector('.strip-size-mode')) { const mode = document.createElement('div'); mode.className = 'strip-size-mode'; mode.innerHTML = '<label class="radio"><input name="stripSizeMode" value="single" type="radio" checked> 1 типоразмер</label><label class="radio"><input name="stripSizeMode" value="multiple" type="radio"> Несколько типоразмеров</label>'; label.insertBefore(mode, $('productWidth')); mode.querySelectorAll('input').forEach(input => input.addEventListener('change', () => updateStripSizeControl())); } const multiple = getRadio('stripSizeMode') === 'multiple'; const updateWidthLabel = () => { label.firstChild.textContent = multiple ? 'Ширины лент, мм' : readStripWidths($('productWidth')?.value).length > 1 ? 'Варианты ширины ленты, мм' : 'Ширина готового изделия, мм'; }; updateWidthLabel(); label.hidden = multiple; if (quantityLabel) quantityLabel.hidden = multiple; $('productWidth').placeholder = multiple ? '' : 'Например, 184,5/249,5'; if (!multiple && $('productWidth').dataset.alternativesBound !== '1') { $('productWidth').dataset.alternativesBound = '1'; $('productWidth').addEventListener('input', updateWidthLabel); } if (!fieldGrid) return; let ordersBox = document.querySelector('.multi-strip-orders'); if (!ordersBox) { ordersBox = document.createElement('div'); ordersBox.className = 'multi-strip-orders'; fieldGrid.after(ordersBox); } ordersBox.hidden = !multiple; if (!multiple) return; if (!ordersBox.querySelector('.multi-strip-row')) { const initialWidth = Number($('productWidth').value) || 125, initialQuantity = Number($('quantity').value) || 1; ordersBox.innerHTML = `<div class="multi-strip-heading"><strong>Типоразмеры и объём заказа</strong><span>Для каждой ширины укажите нужный вес или метраж</span></div><div class="multi-strip-rows"></div><button class="button ghost multi-strip-add" type="button">+ Добавить типоразмер</button>`; const rows = ordersBox.querySelector('.multi-strip-rows'); addStripOrderRow(rows, initialWidth, initialQuantity); ordersBox.querySelector('.multi-strip-add').addEventListener('click', () => addStripOrderRow(rows, '', '')); } }
function addStripOrderRow(container, width = '', quantity = '') { const row = document.createElement('div'); row.className = 'multi-strip-row'; row.innerHTML = `<label>Ширина, мм<input class="multi-strip-width" type="number" min="1" step="1" value="${width}" placeholder="Например, 163"></label><label>Количество<input class="multi-strip-quantity" type="number" min="0.001" step="0.001" value="${quantity}" placeholder="Вес или метры"></label><button class="button ghost multi-strip-remove" type="button" aria-label="Удалить типоразмер">×</button>`; row.querySelector('.multi-strip-remove').addEventListener('click', () => { if (container.children.length > 1) row.remove(); }); container.appendChild(row); }
function readStripOrders() { return [...document.querySelectorAll('.multi-strip-row')].map(row => ({ width: Number(row.querySelector('.multi-strip-width')?.value), quantity: Number(row.querySelector('.multi-strip-quantity')?.value) })); }
function stripLayoutMatch(layout, orders, unit, thickness, length, coilWidth) {
  const targets = new Map();
  for (const order of orders) {
    const tons = quantityToTons(order.quantity, unit, thickness, order.width, length);
    targets.set(order.width, (targets.get(order.width) || 0) + tons);
  }
  const finished = [...targets.values()].reduce((sum, tons) => sum + tons, 0);
  const used = layout.widths.reduce((sum, width) => sum + width, 0);
  const sourceVolume = finished * coilWidth / used;
  const requestedWeights = [...targets].map(([width, tons]) => ({ width, tons }));
  const score = requestedWeights.reduce((sum, item) => {
    const count = layout.widths.filter(width => Math.abs(width - item.width) < 1e-8).length;
    return sum + Math.abs(sourceVolume * count * item.width / coilWidth - item.tons) / item.tons;
  }, 0);
  return { sourceVolume, requestedWeights, score };
}
function setType(type) { selectedType = type; if ($('stripScrapOptions')) $('stripScrapOptions').hidden = type !== 'strip'; addOpenModeField(); updateRewindWidthControl(); document.querySelectorAll('label').forEach(label => { if (label.firstChild) label.firstChild.textContent = label.firstChild.textContent.replace(/руб\/т(?!н)/, 'руб/тн'); }); document.querySelectorAll('.type-card').forEach(card => card.classList.toggle('selected', card.dataset.type === type)); $('paramsTitle').textContent = `Параметры ${typeNames[type]}`; document.querySelector('.length-field').hidden = type === 'strip' || type === 'rewind'; updateStripSizeControl(); updateUnits(); }
function thicknessBand(t) { return t <= .6 ? 0 : t <= .8 ? 1 : t <= 1 ? 2 : t <= 1.5 ? 3 : t <= 3 ? 4 : t <= 5 ? 5 : -1; }
function grindingPrice(type, thickness, volume, mode) { const band = PRICE.grinding.roll[thicknessBand(thickness)]; return band ? charge(band[mode], volume, PRICE.grinding.rollMinTons, mode) : 0; }
function filmPrice(type, thickness, yieldRate, coilWidth) { const film = getRadio('film'); if (film === 'none') return 0; const sides = getRadio('filmSides') === 'two' ? 2 : 1; const pricePerMeter = film === 'lpe' ? PRICE.film.lpePerMeter : PRICE.film.pePerMeter; const width = Number(coilWidth) || 1250; const tonsPerMeter = thickness * width * PRICE.density * 0.000001; return tonsPerMeter > 0 ? pricePerMeter * sides / tonsPerMeter : 0; }
function stripBand(width) { return width > 30 ? '>30' : width >= 19 ? '19-30' : width >= 12 ? '12-18.9' : '5-11.9'; }
function maxStrips(thickness, coilWidth) { if ((selectedType === 'strip' || selectedType === 'card') && thickness > 2) return 0; const band = thickness <= .6 ? 0 : thickness <= .8 ? 1 : thickness <= 1 ? 2 : thickness <= 1.2 ? 3 : thickness <= 1.5 ? 4 : 5; const limits = coilWidth < 500 ? [15, 15, 13, 13, 0, 7] : coilWidth < 1000 ? [16, 16, 13, 13, 0, 7] : [25, 21, 20, 17, 15, 10]; return limits[band] || 0; }
function longitudinalRate(width, mode, coilWidth) { const table = coilWidth < 500 || width < 20 ? PRICE.longitudinal.narrow : PRICE.longitudinal.standard; return table[stripBand(width)]?.[mode] || 0; }
function quantityToTons(quantity, unit, thickness, width, length) { if (unit === 'tons') return quantity; if (unit === 'meters') return quantity * thickness * width * PRICE.density * 0.000001; return quantity * thickness * (width / 1000) * (length / 1000) * PRICE.density / 1000; }

function serviceData(coilWidth, productWidth, thickness, volume, price, cardSize = '') {
  const laneWidths = Array.isArray(productWidth) ? productWidth : [productWidth], usedWidth = laneWidths.reduce((sum, width) => sum + width, 0), pieces = selectedType === 'rewind' ? 1 : laneWidths.length, scrap = coilWidth - usedWidth, yieldRate = usedWidth / coilWidth;
  if (!pieces || (selectedType !== 'sheet' && selectedType !== 'rewind' && maxStrips(thickness, coilWidth) < pieces) || (selectedType !== 'sheet' && selectedType !== 'rewind' && scrap < minimumScrap())) return null;
  const mode = scrap === 0 ? 'full' : 'partial', openCutMode = getRadio('openMode') || 'open', operations = [], hasGrinding = getRadio('surface') === '4n';
  let firstCut = 0;
  let grinding = 0; if (hasGrinding) { grinding = grindingPrice(selectedType, thickness, volume, openCutMode); operations.push({ name: '1. Шлифовка', mode: openCutMode === 'open' ? 'полностью открытый рулон' : openCutMode === 'full' ? 'полностью рулон' : 'частичный рулон', price: grinding }); if (getRadio('film') !== 'none' && getRadio('filmSides') === 'two') { const rewindMode = modeForNextOperation(operations, openCutMode), rewindPrice = PRICE.grinding.rewind[rewindMode]; operations.push({ name: 'Дополнительная перемотка на шлифовке', mode: 'открытый рулон до конца (вторая сторона)', price: charge(rewindPrice, volume, selectedType === 'sheet' ? 1 : PRICE.grinding.rollMinTons, rewindMode) }); } }
  if (selectedType === 'strip' || selectedType === 'card') { const cutMode = modeForNextOperation(operations, openCutMode), tariffWidth = Math.max(...laneWidths); firstCut = longitudinalRate(tariffWidth, cutMode, coilWidth); if (!firstCut) return null; firstCut = charge(firstCut, volume, PRICE.longitudinal.minTons, cutMode); if ($('specialConditions')?.checked) firstCut += PRICE.longitudinal.special; if ($('furtherProcessing')?.checked) firstCut = Math.max(0, firstCut - PRICE.longitudinal.followUpDiscount); operations.push({ name: selectedType === 'card' ? (hasGrinding ? '2. Продольная резка в ленту' : '1. Продольная резка в ленту') : hasGrinding ? '2. Продольная резка в ленту' : '1. Продольная резка в ленту', mode: cutMode === 'open' ? 'открытый рулон до конца' : cutMode === 'full' ? 'полный рулон' : 'частичный рулон', price: firstCut }); }
  if (selectedType === 'rewind') { const tariff = thickness <= .4 ? PRICE.rewind.narrowThin : PRICE.rewind, rewindMode = modeForNextOperation(operations, openCutMode); firstCut = charge(tariff[rewindMode], volume, PRICE.rewind.minTons, rewindMode); if ($('specialConditions')?.checked) firstCut += PRICE.longitudinal.special; operations.push({ name: hasGrinding ? '2. Перемотка рулона' : '1. Перемотка рулона', mode: rewindMode === 'open' ? 'открытый рулон до конца' : rewindMode === 'full' ? 'полный рулон' : 'частичный рулон', price: firstCut }); }
  let secondCut = 0; if (selectedType === 'sheet' || selectedType === 'card') { const cutMode = modeForNextOperation(operations, openCutMode); secondCut = charge(PRICE.crossCut[cutMode], volume, PRICE.crossCut.minTons, cutMode); if ($('specialConditions')?.checked) secondCut += PRICE.crossCut.special; if ($('noPallet')?.checked) secondCut = Math.max(0, secondCut - 500); operations.push({ name: selectedType === 'card' ? (hasGrinding ? '3. Поперечная резка в карточки' : '2. Поперечная резка в карточки') : hasGrinding ? '2. Поперечная резка в лист' : '1. Поперечная резка в лист', mode: cutMode === 'open' ? 'открытый рулон до конца' : cutMode === 'full' ? 'полный рулон' : 'частичный рулон', price: secondCut }); } else if ($('noPallet')?.checked) firstCut = Math.max(0, firstCut - 500);
  const film = filmPrice(selectedType, thickness, yieldRate, coilWidth); if (film) operations.push({ name: 'Плёнка', mode: getRadio('filmSides') === 'two' ? 'с двух сторон' : 'с одной стороны', price: film });
  const materialCost = numericInputValue($('materialCost').value), effectiveMaterial = materialCost / yieldRate, scrapCost = materialCost * (1 - yieldRate) / yieldRate, processing = operations.reduce((sum, item) => sum + item.price, 0);
  return { coilWidth, pieces, scrap, yieldRate, price, cardSize, layoutWidths: laneWidths, effectiveMaterial, scrapCost, cutting: firstCut + secondCut, firstCut, secondCut, grinding, film, processing, total: price + processing + scrapCost, mode, operations };
}

function cardLayouts(coilWidth, firstWidth, secondWidth, thickness) {
  const layouts = [], max = maxStrips(thickness, coilWidth), duplicate = firstWidth === secondWidth;
  for (let first = 0; first <= max; first += 1) for (let second = 0; second <= max - first; second += 1) {
    if (!first && !second) continue;
    if (duplicate && second) continue;
    const widths = [...Array(first).fill(firstWidth), ...Array(second).fill(secondWidth)], used = widths.reduce((sum, width) => sum + width, 0), scrap = coilWidth - used;
    if (used <= coilWidth && scrap >= minimumScrap()) {
      const label = `${first ? `${first}×${firstWidth} мм` : ''}${first && second ? ' + ' : ''}${second ? `${second}×${secondWidth} мм` : ''}`;
      layouts.push({ widths, label });
    }
  }
  return layouts;
}

function stripLayouts(coilWidth, stripWidth, thickness) {
  const layouts = [], max = Math.min(maxStrips(thickness, coilWidth), Math.floor(coilWidth / stripWidth));
  for (let count = 1; count <= max; count += 1) {
    const used = count * stripWidth, scrap = coilWidth - used;
    if (scrap >= minimumScrap()) layouts.push({ widths: Array(count).fill(stripWidth), label: `${count}×${decimal(stripWidth)} мм` });
  }
  return layouts;
}
function mixedLayoutSearchFits(widths, thickness, multiple, coils = COIL_WIDTHS) {
  if (widths.length > 25) return multiple;
  let work = 0;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const smallest = Math.min(...widths);
  for (const coil of coils) {
    const available = coil - minimumScrap();
    const free = Math.min(maxStrips(thickness, coil) - widths.length, Math.floor((available - totalWidth) / smallest));
    if (free < 0) continue;
    // C(free + widths.length, widths.length) bounds all count vectors.
    let combinations = 1;
    for (let i = 1; i <= widths.length; i += 1) combinations *= (free + i) / i;
    work += combinations * widths.length * (multiple ? 1 : widths.length);
  }
  return work <= 100000;
}
  function multiStripLayouts(coilWidth, stripWidths, thickness) { const widths = [...new Set(stripWidths)].sort((a, b) => a - b); if (widths.length <= 1) return stripLayouts(coilWidth, widths[0], thickness); const layouts = [], max = maxStrips(thickness, coilWidth); if (widths.length > max || widths.reduce((sum, width) => sum + width, 0) > coilWidth - minimumScrap()) return layouts; function build(index, selected, used) { if (index === widths.length) { const scrap = coilWidth - used; if (selected.length && scrap >= minimumScrap()) { const counts = widths.map(width => selected.filter(item => item === width).length).filter(Boolean); const label = widths.map((width, i) => counts[i] ? `${counts[i]}×${width} мм` : '').filter(Boolean).join(' + '); layouts.push({ widths: selected, label }); } return; } const width = widths[index], maxCount = Math.min(max - selected.length - (widths.length - index - 1), Math.floor((coilWidth - used - minimumScrap() - widths.slice(index + 1).reduce((sum, item) => sum + item, 0)) / width)); for (let count = 1; count <= maxCount; count += 1) build(index + 1, [...selected, ...Array(count).fill(width)], used + count * width); } build(0, [], 0); return layouts; }
function subcutLayouts(coilWidth, stripWidth, thickness) {
  const sourceLimit = maxStrips(thickness, coilWidth);
  if (!sourceLimit || !Number.isFinite(stripWidth) || stripWidth <= 0) return [];
  const trim = minimumScrap();
  const feasibleCounts = [];
  for (let count = 1; count <= sourceLimit; count += 1) {
    const width = count * stripWidth + trim;
    if (width <= coilWidth - trim && count <= maxStrips(thickness, width)) feasibleCounts.push(count);
  }
  const layouts = new Map();
  for (const largest of feasibleCounts) {
    const maxWidth = largest * stripWidth + trim;
    const tariffKey = ['full', 'partial', 'open'].map(mode => longitudinalRate(maxWidth, mode, coilWidth)).join('/')
      + ':' + longitudinalRate(stripWidth, 'open', maxWidth);
    const allowed = feasibleCounts.filter(count => count <= largest);
    // With the largest intermediate strip fixed, equal totals at a given
    // group count have identical yield, trim and tariffs. Keep one witness.
    let partial = new Map([[largest, [largest]]]);
    for (let groups = 2; groups <= sourceLimit && partial.size; groups += 1) {
      const next = new Map();
      for (const [sum, counts] of partial) {
        for (const count of allowed) {
          const total = sum + count;
          if (total * stripWidth + groups * trim > coilWidth - trim) break;
          if (!next.has(total)) next.set(total, [...counts, count]);
        }
      }
      for (const [count, counts] of next) {
        const widths = counts.map(item => item * stripWidth + trim);
        const scrap = coilWidth - widths.reduce((sum, width) => sum + width, 0);
        if (scrap < trim) continue;
        const key = `${count}:${tariffKey}`;
        const previous = layouts.get(key);
        if (!previous || groups < previous.subcuts) {
          layouts.set(key, { count, scrap, subcuts: groups, counts, widths });
        }
      }
      partial = next;
    }
  }
  const formatted = new Map();
  const format = width => {
    if (!formatted.has(width)) formatted.set(width, decimal(width));
    return formatted.get(width);
  };
  return [...layouts.values()].map(layout => ({ ...layout,
    label: `${layout.count}×${format(stripWidth)} мм`,
    subcutLabel: `${layout.widths.map(format).join(' + ')} мм` }));

}
// Для одного размера применяем те же правила массы второго прохода,
// что и для смешанного раскроя через подкаты.
function serviceDataWithSubcut(coilWidth,stripWidth,thickness,volume,price,layout) {
  const subcutGroups=layout.widths.map((width,index)=>({
    width,widths:Array(layout.counts[index]).fill(stripWidth),
    scrap:width-layout.counts[index]*stripWidth
  }));
  const row=serviceDataWithMixedSubcut(coilWidth,thickness,volume,price,{
    subcutGroups,finalWidths:Array(layout.count).fill(stripWidth),label:layout.label
  });
  if(row) {row.subcutCounts=layout.counts;row.subcutLabel=layout.subcutLabel;}
  return row;
}
function cardCutDimensions(widths, width, length) {
  const counts = new Map();
  for (const across of widths) counts.set(across, (counts.get(across) || 0) + 1);
  return [...counts].map(([across, count]) => ({
    across, along: across === width ? length : width, count
  }));
}

function cardRows(coilWidth, width, length, thickness, volume, price) {
  return cardLayouts(coilWidth, width, length, thickness)
    .map(layout => serviceData(coilWidth, layout.widths, thickness, volume, price, layout.label))
    .filter(Boolean);
}

const compareCardRows = (a, b) => a.total - b.total || b.yieldRate - a.yieldRate;

function cutPlanHtml(row, length = 0, width = 0) {
  const finalLayout = prettyLayout(row.cardSize) || `${row.pieces} полос`;
  if (row.subcutGroups?.length) {
    const groupTitles=row.subcutGroups.map(group=>`${decimal(group.width)} мм`).join(' + ');
    const readyText = row.readyWidths?.length
      ? [...new Set(row.readyWidths)].map(width=>`${row.readyWidths.filter(w=>w===width).length}×${decimal(width)} мм`).join(' + ')
      : '';
    const detail=row.subcutGroups.map((group,index)=>{
      const unique=[...new Set(group.widths)];
      const final=unique.map(w=>`${group.widths.filter(v=>v===w).length}×${decimal(w)} мм`).join(' + ');
      return `<div class="cut-plan-line"><b>${index+1}.</b> Подкат <strong>${decimal(group.width)} мм</strong> → <strong>${final}</strong><span>откройник: ${decimal(group.scrap)} мм</span></div>`;
    }).join('');
    return `<details class="cut-plan"><summary>Показать этапы</summary><div class="cut-plan-line"><b>1.</b> Исходный рулон <strong>${row.coilWidth} мм</strong> → ${readyText ? `готовые ленты <strong>${readyText}</strong> + ` : ''}подкат${row.subcutGroups.length>1?'ы':''}: <strong>${groupTitles}</strong><span>откройник исходного рулона: ${decimal(row.sourceScrap)} мм</span></div><div class="cut-plan-line"><b>2.</b> Повторная резка только подкат${row.subcutGroups.length>1?'ов':'а'}:</div>${detail}<div class="cut-plan-line"><strong>Готовая лента: ${finalLayout}</strong><span>итоговые потери: ${decimal(row.scrap)} мм</span></div></details>`;
  }
  if (row.subcutWidths?.length) {
    const subcutLayout = row.subcutWidths.map((width, index) => `${decimal(width)} мм → ${row.subcutCounts[index]} полос`).join(' + ');
    return `<details class="cut-plan"><summary>Показать этапы</summary><div class="cut-plan-line"><b>1.</b> Исходный рулон <strong>${row.coilWidth} мм</strong> → подкат: <strong>${subcutLayout}</strong><span>откройник рулона: ${decimal(row.sourceScrap)} мм</span></div><div class="cut-plan-line"><b>2.</b> Подкаты → готовая лента: <strong>${finalLayout}</strong><span>откройник каждого подката: ${minimumScrap()} мм</span></div></details>`;
  }
  if (selectedType === 'card') return `<details class="cut-plan"><summary>Показать этапы</summary><div class="cut-plan-line"><b>1.</b> Исходный рулон <strong>${row.coilWidth} мм</strong> → ленты: <strong>${finalLayout}</strong><span>откройник: ${decimal(row.scrap)} мм</span></div><div class="cut-plan-line"><b>2.</b> Ленты → карточки <strong>${cardCutDimensions(row.layoutWidths, width, length).map(({across, along, count}) => `${count} × (${decimal(across)} × ${decimal(along)} мм)`).join(' + ')}</strong><span>поперечная резка открытого рулона</span></div></details>`;
  return `<details class="cut-plan"><summary>Показать этапы</summary><div class="cut-plan-line"><b>1.</b> Исходный рулон <strong>${row.coilWidth} мм</strong> → готовая лента: <strong>${finalLayout}</strong><span>откройник: ${decimal(row.scrap)} мм</span></div></details>`;
}

// Учитываем откройник: количество заказа — масса ГОТОВОЙ ленты.
function stripRowForFinishedVolume(coilWidth, layout, thickness, finishedTons, price, subcutWidth = null) {
  const finalWidths = subcutWidth === null ? layout.widths : Array(layout.count).fill(subcutWidth);
  const finalUsed = finalWidths.reduce((sum, width) => sum + width, 0);
  if (!(coilWidth > 0 && finalUsed > 0 && finishedTons > 0)) return null;
  const sourceVolume = finishedTons * coilWidth / finalUsed;
  const row = subcutWidth === null
    ? serviceData(coilWidth, layout.widths, thickness, sourceVolume, price, layout.label)
    : serviceDataWithSubcut(coilWidth, subcutWidth, thickness, sourceVolume, price, layout);
  if (!row) return null;
  row.sourceVolume = sourceVolume;
  row.finishedVolume = finishedTons;
  if (finalWidths.every(width => Math.abs(width - finalWidths[0]) < 1e-8))
    row.requestedWeights = [{ width: finalWidths[0], tons: finishedTons }];
  return stripPricingPerFinishedTon(row, finishedTons);
}

// Переработка исходного металла должна выражаться в руб/т ГОТОВОЙ ленты:
// минимальная стоимость операции оплачивается за исходный объём, а не за выход.
function stripPricingPerFinishedTon(row, finishedTons) {
  if (!row || !(row.sourceVolume > 0) || !(finishedTons > 0)) return row;
  const factor = row.sourceVolume / finishedTons;
  row.operations.forEach(operation => { operation.price *= factor; });
  row.firstCut *= factor;
  row.secondCut *= factor;
  row.cutting *= factor;
  row.grinding *= factor;
  row.film *= factor;
  row.processing = row.operations.reduce((sum, operation) => sum + operation.price, 0);
  row.total = row.price + row.processing + row.scrapCost;
  return row;
}

function stripRows(coilWidth, widths, thickness, volume, price, mode, orders, unit, length) {
  if (mode === 'multiple') {
    const direct = multiStripLayouts(coilWidth, widths, thickness).map(layout => {
      const match = stripLayoutMatch(layout, orders, unit, thickness, length, coilWidth);
      const row = serviceData(coilWidth, layout.widths, thickness, match.sourceVolume, price, layout.label);
      return row && stripPricingPerFinishedTon(Object.assign(row, { layoutScore: match.score, sourceVolume: match.sourceVolume, finishedVolume: volume, requestedWeights: match.requestedWeights }), volume);
    }).filter(Boolean);
    const subcuts = mixedSubcutLayouts(coilWidth, widths, thickness, orders, unit, length).map(layout => {
      const match = stripLayoutMatch({ widths: layout.finalWidths }, orders, unit, thickness, length, coilWidth);
      const row = serviceDataWithMixedSubcut(coilWidth, thickness, match.sourceVolume, price, layout);
      return row && stripPricingPerFinishedTon(Object.assign(row, {
        layoutScore: match.score, sourceVolume: match.sourceVolume, finishedVolume: volume,
        requestedWeights: match.requestedWeights
      }), volume);
    }).filter(Boolean);
    const hybrid = hybridSubcutLayouts(coilWidth, widths, thickness, orders, unit, length).map(layout => {
      const match = stripLayoutMatch({ widths: layout.finalWidths }, orders, unit, thickness, length, coilWidth);
      const row = serviceDataWithHybridSubcut(coilWidth, thickness, match.sourceVolume, price, layout);
      return row && stripPricingPerFinishedTon(Object.assign(row, {
        layoutScore: match.score, sourceVolume: match.sourceVolume, finishedVolume: volume,
        requestedWeights: match.requestedWeights
      }), volume);
    }).filter(Boolean);
    return direct.concat(hybrid, subcuts);
  }
  const rows = widths.flatMap(width => [
    ...stripLayouts(coilWidth, width, thickness).map(layout => stripRowForFinishedVolume(coilWidth, layout, thickness, volume, price)),
    ...subcutLayouts(coilWidth, width, thickness).map(layout => stripRowForFinishedVolume(coilWidth, layout, thickness, volume, price, width))
  ]);
  if (widths.length > 1) rows.push(...multiStripLayouts(coilWidth, widths, thickness)
    .map(layout => stripRowForFinishedVolume(coilWidth, layout, thickness, volume, price)));
  return rows.filter(Boolean);
}

function compareStripRows(a, b, mode, widthCount) {
  if (mode === 'multiple') {
    const difference = a.layoutScore - b.layoutScore;
    if (Math.abs(difference) > 1e-9) return difference;
  }
  // Вначале экономическая стоимость, при равенстве — меньшие потери металла.
  const priceDifference = a.total - b.total;
  return (Math.abs(priceDifference) > 0.005 ? priceDifference : 0)
    || b.yieldRate - a.yieldRate || a.coilWidth - b.coilWidth;
}

function calculate() {
  const thickness = Number($('thickness').value), productWidthRaw = $('productWidth').value.trim(), stripSizeMode = selectedType === 'strip' ? (getRadio('stripSizeMode') || 'single') : 'single', stripOrders = selectedType === 'strip' && stripSizeMode === 'multiple' ? readStripOrders() : [], alternativeWidths = selectedType === 'strip' && stripSizeMode === 'single' ? readStripWidths(productWidthRaw) : [], productWidths = selectedType === 'strip' && stripSizeMode === 'multiple' ? [...new Set(stripOrders.map(order => order.width))] : selectedType === 'strip' ? alternativeWidths : [Number(productWidthRaw.replace(',', '.'))], productWidth = productWidths[0], length = Number($('productLength').value) || 0, quantity = Number($('quantity').value), materialCost = parseNumericInput($('materialCost').value), price = parseNumericInput($('price').value), unit = getRadio('unit'), error = $('error'), film = getRadio('film'), filmSides = getRadio('filmSides'), validStripOrders = selectedType !== 'strip' || stripSizeMode !== 'multiple' || (stripOrders.length >= 2 && stripOrders.every(order => Number.isFinite(order.width) && order.width > 0 && Number.isFinite(order.quantity) && order.quantity > 0));
  if (![thickness, productWidth, materialCost, price].every(Number.isFinite) || !productWidths.length || thickness <= 0 || productWidth <= 0 || (!validStripOrders) || (stripSizeMode === 'single' && (!Number.isFinite(quantity) || quantity <= 0)) || materialCost < 0 || price < 0 || (selectedType !== 'strip' && selectedType !== 'rewind' && length <= 0) || (filmSides === 'two' && (film === 'none' || thickness > 2))) { error.textContent = filmSides === 'two' && film === 'none' ? 'Для двухсторонней плёнки выберите PE или LPE.' : filmSides === 'two' && thickness > 2 ? 'Плёнка с двух сторон доступна только до толщины 2,0 мм.' : !validStripOrders ? 'Добавьте минимум два типоразмера лент и укажите ширину с нужным весом или метражом.' : selectedType === 'strip' ? 'Проверьте заполнение параметров ленты. Ширины можно указать через /, например 184,5/249,5.' : 'Проверьте заполнение параметров выбранной позиции.'; error.hidden = false; return; }
  const volume = stripSizeMode === 'multiple' ? stripOrders.reduce((sum, order) => sum + quantityToTons(order.quantity, unit, thickness, order.width, length), 0) : quantityToTons(quantity, unit, thickness, productWidth, length); if (!Number.isFinite(volume) || volume <= 0) { error.textContent = 'Не удалось перевести количество в тонны. Проверьте размеры.'; error.hidden = false; return; } error.hidden = true;
  const candidates = selectedType === 'sheet' || selectedType === 'rewind' ? [productWidth] : COIL_WIDTHS;
  if (selectedType === 'strip' && productWidths.length > 1
      && !mixedLayoutSearchFits(productWidths, thickness, stripSizeMode === 'multiple')) {
    error.textContent = 'Слишком много сочетаний ширин. Сократите число типоразмеров и повторите расчёт.';
    error.hidden = false;
    return;
  }
  const rows = (selectedType === 'card'
    ? candidates.flatMap(width => cardRows(width, productWidth, length, thickness, volume, price)).sort(compareCardRows)
    : selectedType === 'strip'
      ? candidates.flatMap(width => stripRows(width, productWidths, thickness, volume, price, stripSizeMode, stripOrders, unit, length))
        .sort((a, b) => compareStripRows(a, b, stripSizeMode, productWidths.length))
      : candidates.map(width => serviceData(width, productWidth, thickness, volume, price)).filter(Boolean).sort((a, b) => a.total - b.total)).filter((row, index, list) => (selectedType !== 'strip' && selectedType !== 'card') || list.findIndex(item => item.coilWidth === row.coilWidth) === index).slice(0, selectedType === 'strip' || selectedType === 'card' ? COIL_WIDTHS.length : 5); if (!rows.length) { error.textContent = 'По условиям прайса подходящего варианта нет: проверьте ширину, толщину, количество полос и откройник.'; error.hidden = false; return; }
  const productLabel = selectedType === 'strip' && stripSizeMode === 'multiple' ? stripOrders.map(order => `${fullNomenclature(selectedType, thickness, order.width)} — ${decimal(order.quantity)} ${unit === 'tons' ? 'т' : 'м'}`).join('<br>') : selectedType === 'strip' && productWidths.length > 1 ? `${productWidths.map(width => `${decimal(width)} мм`).join(' / ')} · ${decimal(thickness)} мм` : fullNomenclature(selectedType, thickness, productWidth, length), paymentLabel = getRadio('paymentTerms') === 'deferment' ? 'Отсрочка' : 'Предоплата', monthLabel = $('deliveryMonth')?.selectedOptions[0]?.textContent || ''; $('resultCaption').innerHTML = `<strong>${productLabel}</strong> · объём ${decimal(volume)} т · ${getRadio('surface') === '4n' ? 'Шлифовка' : 'Без шлифовки'} · ${paymentLabel}${monthLabel ? ` · поставка: ${monthLabel}` : ''}`;
  const best = rows[0];
  document.querySelector('#resultsStep thead tr').innerHTML = selectedType === 'strip'
    ? '<th>Исходный рулон</th><th>Раскрой</th><th>Вес готовых лент</th><th>Откройник</th><th>Итоговая цена</th>'
    : '<th>Исходный рулон</th><th class="orientation-col">Направление карточки</th><th>Полос / листов</th><th class="scrap-col">Откройник</th><th class="yield-col">Выход</th><th>Итоговая цена</th>';
  if (selectedType === 'strip')
    $('resultCaption').innerHTML = $('resultCaption').innerHTML.replace(/ · объём [\d\s,.]+ т/, ` · заказ ${stripTons(volume)} т готовой ленты · исходный металл ${stripTons(best.sourceVolume)} т`); document.querySelector('.table-wrap').hidden = selectedType === 'sheet' || selectedType === 'rewind'; document.querySelectorAll('.scrap-col,.scrap-cell').forEach(el => el.hidden = selectedType === 'sheet' || selectedType === 'rewind'); document.querySelectorAll('.orientation-col,.orientation-cell').forEach(el => el.hidden = selectedType !== 'card'); $('recommendation').innerHTML = `${selectedType === 'sheet' ? 'Лист' : selectedType === 'rewind' ? 'Рулон' : 'Рекомендуемый рулон:'} <strong>${best.coilWidth} мм</strong>${(selectedType === 'card' || selectedType === 'strip') && best.cardSize ? ` · раскрой ${prettyLayout(best.cardSize)}` : ''}<span>Маршрут: ${best.operations.map(item => item.name.replace(/^\d\. /, '')).join(' → ')}</span>`;
  $('resultsBody').innerHTML = rows.map((row, index) => {
    const coil = `<strong>${row.coilWidth} мм</strong>${index === 0 ? '<em>лучший</em>' : ''}${selectedType === 'strip' || selectedType === 'card' ? cutPlanHtml(row, length, productWidth) : ''}`;
    const scrap = `${decimal(row.scrap)} мм / ${pct((1 - row.yieldRate) * 100)}${row.subcutScrapTotal ? `<small> (${decimal(row.sourceScrap)} + ${row.subcuts}×${row.subcutTrim || minimumScrap()})</small>` : ''}`;
    const priceCell = `<strong>${money(row.total)} руб/тн</strong>`;
    if (selectedType === 'strip') {
      const source = row.sourceVolume ? `<small class="strip-source-weight">Исходный металл: ${stripTons(row.sourceVolume)} т</small>` : '';
      return `<tr class="${index === 0 ? 'best' : ''}"><td>${coil}${source}</td><td>${prettyLayout(row.cardSize) || row.pieces}</td><td>${actualWeightText(row, volume)}</td><td>${scrap}</td><td>${priceCell}</td></tr>`;
    }
    return `<tr class="${index === 0 ? 'best' : ''}"><td>${coil}</td><td class="orientation-cell">${prettyLayout(row.cardSize)}</td><td>${row.pieces}</td><td class="scrap-cell">${scrap}</td><td class="yield-cell">${pct(row.yieldRate * 100)}</td><td>${priceCell}</td></tr>`;
  }).join('');
  const operationLines = best.operations.map(operation => `<div class="subline"><span>${operation.name}${operation.name === 'Плёнка' ? '' : ` <small>(${operation.mode})</small>`}</span><strong>${money(operation.price)} руб/тн</strong></div>`).join(''); $('priceBreakdown').innerHTML = `<h3>Итоговая цена: ${money(best.total)} руб/тн с НДС</h3><div class="price-lines"><div><span>Прайс</span><strong>${money(best.price)} руб/тн</strong></div><div><span>Переработка</span><strong>${money(best.processing)} руб/тн</strong></div>${operationLines}<div><span>Откройник от себестоимости</span><strong>${best.scrapCost ? money(best.scrapCost) + ' руб/тн' : '—'}</strong></div><div class="grand"><span>ИТОГО</span><strong>${money(best.total)} руб/тн</strong></div></div>`;
  $('note').textContent = selectedType === 'card' && getRadio('surface') === '4n' ? 'Карточки: сначала шлифовка, затем продольная резка в ленту и поперечная резка открытого рулона до конца.' : selectedType === 'card' ? 'Карточки: сначала продольная резка в ленту, затем поперечная резка открытого рулона до конца.' : selectedType === 'sheet' && getRadio('surface') === '4n' ? 'Шлифованный лист: сначала шлифовка, затем поперечная резка открытого рулона до конца.' : selectedType === 'rewind' ? 'Рулон рассчитан как отдельная операция перемотки без продольного раскроя.' : 'Автоматически применены условия прайса по режиму рулона, минимальному объёму и дальнейшей переработке.';
  const customMinWidth = selectedType === 'strip' && stripSizeMode === 'multiple' ? productWidths.reduce((sum, width) => sum + width, 0) : productWidth, customProductWidth = selectedType === 'strip' ? productWidths : productWidth; const custom = document.createElement('tr'); custom.className = 'custom-row'; custom.innerHTML = `<td><input id="customCoilWidth" type="number" min="${customMinWidth}" step="1" placeholder="Своя ширина"></td>${selectedType === 'strip' ? '' : `<td class="orientation-cell"${selectedType === 'card' ? '' : ' hidden'}>${selectedType === 'card' ? 'Ориентация задаётся в таблице' : ''}</td>`}<td colspan="${selectedType === 'strip' ? 4 : selectedType === 'sheet' || selectedType === 'rewind' ? 3 : 4}" id="customResult">Введите ширину — расчёт появится автоматически</td>`; $('resultsBody').appendChild(custom); $('customCoilWidth').addEventListener('input', () => renderCustom(Number($('customCoilWidth').value), thickness, customProductWidth, volume, price));
  lastCalculation = { rows, best, volume, thickness, length, materialCost, unit, stripOrders, stripSizeMode, productWidths, alternativeWidths, paymentTerms: getRadio('paymentTerms'), deliveryMonth: $('deliveryMonth')?.value || '' };
  localStorage.setItem('metal-cutter-values', JSON.stringify({ allowSmallScrap: $('allowSmallScrap')?.checked === true, type: selectedType, thickness, productWidth: productWidthRaw, stripSizeMode, stripOrders, length, quantity, unit, volume, materialCost, price, surface: getRadio('surface'), film, filmSides, openMode: getRadio('openMode'), paymentTerms: getRadio('paymentTerms'), deliveryMonth: $('deliveryMonth')?.value || '' }));
}
function renderCustom(coilWidth, thickness, productWidth, volume, price) {
  const out = $('customResult'), widths = Array.isArray(productWidth) ? productWidth : [productWidth];
  if (selectedType === 'card') {
    if (!Number.isFinite(coilWidth) || coilWidth <= 0) { out.textContent = 'Введите ширину рулона'; return; }
    const length = Number($('productLength').value);
    const best = cardRows(coilWidth, widths[0], length, thickness, volume, price).sort(compareCardRows)[0];
    out.innerHTML = best ? cutPlanHtml(best, length, widths[0]) + `<strong>${money(best.total)} руб/тн</strong>`
      : 'Карточки не помещаются ни в одной допустимой ориентации.';
    return;
  }
  if (!Number.isFinite(coilWidth) || coilWidth <= 0) { out.textContent = 'Введите ширину рулона'; return; }
  const c = lastCalculation;
  if (selectedType === 'strip' && widths.length > 1
      && !mixedLayoutSearchFits(widths, thickness, c.stripSizeMode === 'multiple', [coilWidth])) {
    out.textContent = 'Слишком много сочетаний ширин. Сократите число типоразмеров.';
    return;
  }
  const row = selectedType === 'strip'
    ? stripRows(coilWidth, widths, thickness, volume, price, c.stripSizeMode, c.stripOrders, c.unit, c.length)
      .sort((a, b) => compareStripRows(a, b, c.stripSizeMode, widths.length))[0]
    : serviceData(coilWidth, productWidth, thickness, volume, price);
  if (!row) { out.textContent = 'Вариант не проходит по условиям прайса или минимальному откройнику'; return; }
  const weights = selectedType === 'strip' ? `<div class="custom-strip-weight">Расчётный вес готовых лент: ${actualWeightText(row, volume)}</div>` : '';
  out.innerHTML = `${decimal(coilWidth)} мм · ${prettyLayout(row.cardSize) || row.pieces} полос / листов${selectedType === 'sheet' || selectedType === 'rewind' ? '' : ` · откройник <strong>${decimal(row.scrap)} мм</strong>`} · переработка ${money(row.processing)} руб/тн · откройник от себестоимости ${money(row.scrapCost)} руб/тн · <strong>${money(row.total)} руб/тн</strong>${weights}`;
}
document.querySelectorAll('.type-card').forEach(card => card.addEventListener('click', () => setType(card.dataset.type))); $('nextButton').addEventListener('click', () => showStep(2)); $('backButton').addEventListener('click', () => showStep(1)); $('calculateButton').addEventListener('click', () => { calculate(); if (!$('error').hidden) return; showStep(3); }); $('editButton').addEventListener('click', () => showStep(2)); $('resetButton').addEventListener('click', () => { localStorage.removeItem('metal-cutter-values'); location.reload(); });
$('backButton').addEventListener('click', event => { event.stopImmediatePropagation(); localStorage.removeItem('metal-cutter-values'); location.reload(); }, true);
setupDeliveryMonths(); try { const saved = JSON.parse(localStorage.getItem('metal-cutter-values') || 'null'); if (saved) { if ($('allowSmallScrap')) $('allowSmallScrap').checked = saved.allowSmallScrap === true; setType(saved.type || 'strip'); ['thickness', 'productWidth', 'productLength', 'quantity', 'materialCost', 'price'].forEach(id => { if (saved[id] !== undefined) $(id).value = saved[id]; }); document.querySelector(`input[name="stripSizeMode"][value="${saved.stripSizeMode || 'single'}"]`)?.click(); if (saved.stripSizeMode === 'multiple' && Array.isArray(saved.stripOrders)) { const rows = document.querySelector('.multi-strip-rows'); if (rows) { rows.innerHTML = ''; saved.stripOrders.forEach(order => addStripOrderRow(rows, order.width, order.quantity)); } } document.querySelector(`input[name="unit"][value="${saved.unit}"]`)?.click(); document.querySelector(`input[name="surface"][value="${saved.surface}"]`)?.click(); document.querySelector(`input[name="film"][value="${saved.film}"]`)?.click(); document.querySelector(`input[name="filmSides"][value="${saved.filmSides}"]`)?.click(); document.querySelector(`input[name="openMode"][value="${saved.openMode || 'partial'}"]`)?.click(); document.querySelector(`input[name="paymentTerms"][value="${saved.paymentTerms || 'prepayment'}"]`)?.click(); if (saved.deliveryMonth) $('deliveryMonth').value = saved.deliveryMonth; } } catch {} setType(selectedType); showStep(1);
document.querySelectorAll('input[name="film"]').forEach(input => input.addEventListener('change', () => { if (input.checked && input.value === 'none') document.querySelector('input[name="filmSides"][value="one"]').checked = true; })); if (getRadio('film') === 'none') document.querySelector('input[name="filmSides"][value="one"]').checked = true;
['specialConditions', 'furtherProcessing', 'noPallet'].forEach(id => { if ($(id)) $(id).checked = false; });
document.querySelector('input[name="unit"][value="tons"]').checked = true; document.querySelector('input[name="surface"][value="2b"]').checked = true; document.querySelector('input[name="film"][value="none"]').checked = true; document.querySelector('input[name="filmSides"][value="one"]').checked = true; document.querySelector('input[name="openMode"][value="partial"]').checked = true;
document.querySelectorAll('label').forEach(label => { if (label.textContent.trim() === '4N') label.lastChild.textContent = ' Шлифовка'; });
const STEEL_GRADES = ['AISI 201 J4', 'AISI 201', 'AISI 202', 'AISI 304L', 'AISI 304 Tp', 'AISI 304', '08Х18Н10', 'AISI 304 DDQ', 'AISI 309S', 'AISI 310S', 'AISI 316L', 'AISI 316Ti', '10Х17Н13М2Т', 'AISI 321', '12Х18Н10Т', '1.4541/321', 'AISI 409', 'AISI 410S', 'AISI 430', '430YD', 'AISI 439', 'AISI 444', 'AISI 904L', 'UNS N08810', 'DX54D', 'DX52D', 'DX51D', 'NM450', 'NM500', 'INCOLOY 825', 'ENAW 5083 Н111', 'ENAW 5086 Н111', 'Alloy28', 'ЛОМ', 'UNS N06600'];
const CBR_RATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const currentPurchaseRate = () => Number($('cbrRate')?.dataset.rate || 0);
function purchaseSalePrice(fallback) {
  const raw = $('finalPrice')?.value?.trim();
  if (raw !== undefined && raw !== '') {
    const price = Number(raw);
    if (Number.isFinite(price) && price >= 0) return price;
    throw new Error('Итоговая цена должна быть конечным неотрицательным числом.');
  }
  const sale = Number($('salePrice')?.value || fallback);
  const delivery = Math.max(0, Number($('deliveryCost')?.value) || 0);
  const days = Math.max(0, Number($('defermentDays')?.value) || 0);
  return Math.round(sale + delivery + sale * DEFERMENT_ANNUAL_RATE * days / 365);
}
// Для отсрочки используется фиксированная ставка 12% годовых, а не ключевая ставка ЦБ.
const DEFERMENT_ANNUAL_RATE = 0.12;
const DEFERMENT_RATE_PERCENT = DEFERMENT_ANNUAL_RATE * 100;
function ensurePurchaseButton() { if ($('makeCalculationButton') || !$('editButton')) return; const button = document.createElement('button'); button.id = 'makeCalculationButton'; button.type = 'button'; button.className = 'button primary'; button.textContent = 'Сделать расчёт'; button.addEventListener('click', openPurchaseWindow); $('editButton').before(button); }
async function getCbrRates() {
  try {
    const response = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return {};
    const data = await response.json();
    const date = new Date(data.Date), age = Date.now() - date.getTime();
    if (!Number.isFinite(age) || age > CBR_RATE_MAX_AGE_MS || age < -24 * 60 * 60 * 1000) return {};
    return Object.fromEntries(['USD', 'CNY'].flatMap(currency => {
      const entry = data.Valute?.[currency], rate = entry?.Value / entry?.Nominal;
      return Number.isFinite(rate) && rate > 0 ? [[currency, { rate, date: date.toLocaleDateString('ru-RU') }]] : [];
    }));
  } catch {
    return {};
  }
}
function openPurchaseWindow() { ensurePurchaseButton(); if (!$('purchaseModal')) { const style = document.createElement('style'); style.id = 'purchaseStyles'; style.textContent = '.purchase-modal{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:18px;background:#17212b66}.purchase-window{width:min(560px,100%);max-height:calc(100vh - 36px);overflow:auto;background:#fff;border:1px solid #dce4e9;border-radius:16px;box-shadow:0 20px 60px #17212b33;padding:22px}.purchase-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}.purchase-head h2{margin:0;font-size:20px}.purchase-head p{margin:4px 0 0;color:#78848c;font-size:12px}.purchase-close{border:0;background:transparent;color:#65717c;font-size:24px;cursor:pointer;line-height:1}.purchase-field{display:block;margin:0 0 15px;font-size:13px;font-weight:700;color:#394650}.purchase-field input,.purchase-field select{margin-top:7px}.purchase-rate{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:-4px 0 15px;padding:12px;border-radius:10px;background:#f0faf7;color:#126e61;font-size:13px}.purchase-rate strong{font-size:16px}.purchase-result{margin-top:18px;padding:15px;border-radius:10px;background:#f7f9fa;color:#23323b;font-size:14px}.purchase-result>div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #dce4e9}.purchase-result>div:last-of-type{border-bottom:0}.purchase-result .purchase-total{margin-top:8px;padding-top:11px;border-top:1px solid #bfcbd1;font-weight:800}.purchase-result strong{font-size:16px}.purchase-result .purchase-total strong{font-size:19px}.purchase-source{display:block;margin-top:8px;color:#7a858e;font-size:11px}.purchase-actions{display:flex;justify-content:flex-end;margin-top:18px}'; document.head.appendChild(style); const modal = document.createElement('div'); modal.id = 'purchaseModal'; modal.className = 'purchase-modal'; modal.innerHTML = `<div class="purchase-window" role="dialog" aria-modal="true" aria-labelledby="purchaseTitle"><div class="purchase-head"><div><h2 id="purchaseTitle">Расчёт закупки</h2><p>Данные используются только в этом браузере</p></div><button class="purchase-close" type="button" aria-label="Закрыть">×</button></div><label class="purchase-field">Марка стали<select id="steelGrade">${STEEL_GRADES.map(grade => `<option>${grade}</option>`).join('')}</select></label><label class="purchase-field">Валюта закупки<select id="purchaseCurrency"><option value="USD">USD — доллар США</option><option value="CNY">CNY — китайский юань</option></select></label><div class="purchase-rate"><span>Курс ЦБ РФ на <span id="cbrDate">загрузка…</span></span><strong id="cbrRate">—</strong></div><label class="purchase-field">Цена закупки, валют/тн<input id="purchasePrice" type="number" min="0" step="0.01" placeholder="Введите цену"></label><label class="purchase-field">Доставка, руб/тн<input id="deliveryCost" type="number" min="0" step="0.01" value="0"></label><label class="purchase-field">Отсрочка платежа, дней<input id="defermentDays" type="number" min="0" step="1" value="0"></label><div class="purchase-rate"><span>Ставка отсрочки — фиксированная</span><strong id="keyRate">—</strong></div><div class="purchase-result"><div><span>Закупка</span><strong id="purchaseRub">—</strong></div><div><span>Доставка</span><strong id="deliveryOutput">0 руб/тн</strong></div><div><span>Стоимость отсрочки</span><strong id="defermentCost">0 руб/тн</strong></div><div class="purchase-total"><span>Итого</span><strong id="purchaseTotal">—</strong></div><span class="purchase-source">Источник курса и ставки: <a href="https://www.cbr.ru/currency_base/daily/" target="_blank" rel="noreferrer">ЦБ РФ, курсы валют</a> · <a href="https://www.cbr.ru/hd_base/KeyRate/" target="_blank" rel="noreferrer">ЦБ РФ, ключевая ставка</a></span></div><div class="purchase-actions"><button class="button ghost purchase-close" type="button">Закрыть</button></div></div>`; document.body.appendChild(modal); modal.querySelectorAll('.purchase-close').forEach(button => button.addEventListener('click', () => modal.remove())); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); }); const currency = $('purchaseCurrency'), priceInput = $('purchasePrice'), deliveryInput = $('deliveryCost'), daysInput = $('defermentDays'), rateOutput = $('cbrRate'), dateOutput = $('cbrDate'), rubOutput = $('purchaseRub'), keyRateOutput = $('keyRate'), deliveryOutput = $('deliveryOutput'), defermentOutput = $('defermentCost'), totalOutput = $('purchaseTotal'); let rates = {}, pendingRate = true; function renderPurchase() { const selected = rates[currency.value], price = Number(priceInput.value), purchaseRub = Number.isFinite(price) && price > 0 && selected && Number.isFinite(price * selected.rate) ? price * selected.rate : 0, delivery = Math.max(0, Number(deliveryInput.value) || 0), days = Math.max(0, Number(daysInput.value) || 0), deferment = purchaseRub * DEFERMENT_ANNUAL_RATE * days / 365, total = purchaseRub + delivery + deferment; rateOutput.dataset.rate = selected?.rate ?? ''; rateOutput.textContent = selected ? `${rateDecimal(selected.rate)} руб` : '—'; dateOutput.textContent = selected?.date ?? (pendingRate ? 'загрузка…' : 'нет актуальных данных'); keyRateOutput.textContent = `${decimal(DEFERMENT_RATE_PERCENT)}% годовых`; rubOutput.textContent = purchaseRub ? `${money(purchaseRub)} руб/тн` : '—'; deliveryOutput.textContent = `${money(delivery)} руб/тн`; defermentOutput.textContent = `${money(deferment)} руб/тн`; totalOutput.textContent = purchaseRub ? `${money(total)} руб/тн` : '—'; } [currency, priceInput, deliveryInput, daysInput].forEach(input => input.addEventListener('input', renderPurchase)); currency.addEventListener('change', renderPurchase); renderPurchase(); getCbrRates().then(result => { rates = result; pendingRate = false; renderPurchase(); }); } else $('purchaseModal').remove(); }
function enhancePurchaseWindow() { const modal = $('purchaseModal'); if (!modal || $('salePrice')) return; const previousMatch = $('priceBreakdown')?.textContent.match(/Итоговая цена:\s*([\d\s]+)\s*руб\/тн/), previousTotal = lastCalculationTotal || (previousMatch ? Number(previousMatch[1].replace(/\s/g, '')) : 0), saleInput = document.createElement('input'); saleInput.type = 'hidden'; saleInput.id = 'salePrice'; saleInput.value = previousTotal ? String(Math.round(previousTotal)) : ''; modal.appendChild(saleInput); const update = () => { const price = Number($('purchasePrice')?.value), rate = currentPurchaseRate(), delivery = Math.max(0, Number($('deliveryCost')?.value) || 0), days = Math.max(0, Number($('defermentDays')?.value) || 0), sale = Number(saleInput.value), purchaseRub = Number.isFinite(price) && price > 0 && Number.isFinite(rate) ? price * rate : 0, keyRate = DEFERMENT_RATE_PERCENT, deferment = purchaseRub * keyRate / 100 * days / 365, total = sale > 0 ? sale + delivery + deferment : 0; if ($('salePriceOutput')) $('salePriceOutput').textContent = sale > 0 ? `${money(sale)} руб/тн` : '—'; if ($('deliveryOutput')) $('deliveryOutput').textContent = `${money(delivery)} руб/тн`; if ($('defermentCost')) $('defermentCost').textContent = `${money(deferment)} руб/тн`; if ($('purchaseTotal')) $('purchaseTotal').textContent = total > 0 ? `${money(total)} руб/тн` : '—'; }; [saleInput, $('purchasePrice'), $('deliveryCost'), $('defermentDays'), $('purchaseCurrency')].filter(Boolean).forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', update)); update(); }
function updateSaleBasedPurchaseSummary() { const sale = Number($('salePrice')?.value) || 0, delivery = Math.max(0, Number($('deliveryCost')?.value) || 0), days = Math.max(0, Number($('defermentDays')?.value) || 0), rate = DEFERMENT_RATE_PERCENT, deferment = sale * rate / 100 * days / 365, total = sale + delivery + deferment; if ($('defermentCost')) $('defermentCost').textContent = currentPurchaseRate() ? `${money(deferment)} руб/тн` : '—'; if ($('purchaseTotal')) $('purchaseTotal').textContent = currentPurchaseRate() && sale > 0 ? `${money(total)} руб/тн` : '—'; }
function bindEditablePurchaseTotal() { const modal = $('purchaseModal'), result = modal?.querySelector('.purchase-result'), totalRow = result?.querySelector('.purchase-total'); if (!modal || !result || !totalRow || $('finalPrice')) return; const field = document.createElement('label'); field.className = 'purchase-field'; field.innerHTML = '<span>Итоговая цена, руб/тн</span><input id="finalPrice" type="number" min="0" step="1" placeholder="Рассчитывается автоматически">'; totalRow.before(field); const input = $('finalPrice'), sync = () => { const sale = Number($('salePrice')?.value) || 0, delivery = Math.max(0, Number($('deliveryCost')?.value) || 0), days = Math.max(0, Number($('defermentDays')?.value) || 0), rate = DEFERMENT_RATE_PERCENT, total = sale + delivery + sale * rate / 100 * days / 365; if (document.activeElement !== input) input.value = total > 0 ? Math.round(total) : ''; if (document.activeElement !== input && $('purchaseTotal')) $('purchaseTotal').textContent = total > 0 ? `${money(total)} руб/тн` : '—'; }; input.addEventListener('input', () => { const value = Number(input.value); if ($('purchaseTotal')) $('purchaseTotal').textContent = value > 0 ? `${money(value)} руб/тн` : '—'; }); ['salePrice', 'deliveryCost', 'defermentDays', 'keyRate'].forEach(id => $(id)?.addEventListener('input', sync)); $('purchaseCurrency')?.addEventListener('change', sync); sync(); }
function formatKeyRateDisplay() { const node = $('keyRate'); if (!node || node.dataset.formatted === '1') return; const format = () => { const value = Number(String(node.textContent || '').replace(/[^\d,.-]/g, '').replace(',', '.')); if (!Number.isFinite(value)) return; const formatted = `${decimal(value)}% годовых`; if (node.textContent !== formatted) node.textContent = formatted; if (typeof updateSaleBasedPurchaseSummary === 'function') updateSaleBasedPurchaseSummary(); }; node.dataset.formatted = '1'; format(); new MutationObserver(format).observe(node, { childList: true, characterData: true, subtree: true }); }
function ensurePurchaseButton() { if ($('makeCalculationButton') || !$('editButton')) return; const button = document.createElement('button'); button.id = 'makeCalculationButton'; button.type = 'button'; button.className = 'button primary'; button.textContent = 'Сделать расчёт'; button.addEventListener('click', openPurchaseWindow); button.addEventListener('click', () => setTimeout(() => { ['purchasePrice', 'deliveryCost', 'defermentDays'].forEach(id => { if ($(id)?.value === '0') $(id).value = ''; }); enhancePurchaseWindow(); bindEditablePurchaseTotal(); document.querySelector('.purchase-source')?.remove(); formatKeyRateDisplay(); const refreshDelivery = () => { if ($('deliveryOutput') && !$('deliveryCost')?.value) $('deliveryOutput').textContent = '—'; }; $('deliveryCost')?.addEventListener('input', refreshDelivery); ['purchasePrice', 'salePrice', 'deliveryCost', 'defermentDays', 'keyRate'].forEach(id => $(id)?.addEventListener('input', updateSaleBasedPurchaseSummary)); $('purchaseCurrency')?.addEventListener('change', updateSaleBasedPurchaseSummary); const modal = $('purchaseModal'); modal?.addEventListener('click', event => { if (event.target === modal) event.stopImmediatePropagation(); }, true); updateSaleBasedPurchaseSummary(); refreshDelivery(); }, 0)); $('editButton').before(button); }
async function exportCalculationToExcel(file) { if (!lastCalculation || !file) return; if (!window.ExcelJS) { alert('Не удалось загрузить модуль Excel. Проверьте подключение к интернету и повторите попытку.'); return; } const buffer = await file.arrayBuffer(), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); const sheet = workbook.getWorksheet('Расчет') || workbook.worksheets[0]; if (!sheet) throw new Error('В шаблоне не найден лист расчёта.'); const calculation = lastCalculation, monthText = $('deliveryMonth')?.selectedOptions[0]?.textContent || '', paymentText = calculation.paymentTerms === 'deferment' ? 'отсрочка' : 'предоплата', lineItems = calculation.stripSizeMode === 'multiple' ? calculation.stripOrders.map(order => ({ width: order.width, quantity: order.quantity, tons: quantityToTons(order.quantity, calculation.unit, calculation.thickness, order.width, calculation.length) })) : [{ width: Number($('productWidth').value), quantity: Number($('quantity').value), tons: calculation.volume }]; sheet.getCell('Q1').value = 'руб'; sheet.getCell('Q2').value = monthText; sheet.getCell('Q4').value = paymentText; lineItems.slice(0, 14).forEach((item, index) => { const row = sheet.getRow(8 + index); row.getCell(2).value = fullNomenclature(selectedType, calculation.thickness, item.width, calculation.length).toLowerCase(); row.getCell(4).value = calculation.thickness; row.getCell(5).value = item.width; row.getCell(6).value = selectedType === 'sheet' || selectedType === 'card' ? calculation.length : null; row.getCell(7).value = getRadio('surface') === '4n' ? 'N4' : ''; row.getCell(8).value = calculation.unit === 'pieces' ? item.quantity : null; row.getCell(9).value = item.tons; row.getCell(12).value = calculation.best.price; row.getCell(15).value = calculation.best.processing; row.getCell(16).value = 0; row.getCell(17).value = calculation.best.processing; }); sheet.getCell('B8').note = `Выгружено из калькулятора: ${resultNames[selectedType]}; поставка — ${monthText}; условия оплаты — ${paymentText}.`; if (workbook.calcProperties) { workbook.calcProperties.fullCalcOnLoad = true; workbook.calcProperties.forceFullCalc = true; } const output = await workbook.xlsx.writeBuffer(), blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `Расчет_${resultNames[selectedType].replace(/[^а-яёa-z0-9]+/gi, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function bindExcelExport() { const button = $('exportExcelButton'); if (!button || button.dataset.bound) return; button.dataset.bound = '1'; button.addEventListener('click', openPurchaseWindow); }
async function exportPurchaseCalculationToExcel(file) { if (!lastCalculation || !file) return; if (!window.ExcelJS) { alert('Не удалось загрузить модуль Excel. Проверьте подключение к интернету и повторите попытку.'); return; } const buffer = await file.arrayBuffer(), workbook = new ExcelJS.Workbook(), calculation = lastCalculation; await workbook.xlsx.load(buffer); const sheet = workbook.getWorksheet('Расчет') || workbook.worksheets[0]; if (!sheet) throw new Error('В шаблоне не найден лист расчёта.'); const grade = $('steelGrade')?.value || '', currency = $('purchaseCurrency')?.value || 'USD', purchasePrice = Number($('purchasePrice')?.value) || 0, rate = currentPurchaseRate(), salePrice = Number($('finalPrice')?.value) || Number($('salePrice')?.value) || calculation.best.total, delivery = Math.max(0, Number($('deliveryCost')?.value) || 0), days = Math.max(0, Number($('defermentDays')?.value) || 0), keyRate = Number(String($('keyRate')?.textContent || '').replace(/[^d,.-]/g, '').replace(',', '.')) || 0, monthText = $('modalDeliveryMonth')?.selectedOptions[0]?.textContent || '', paymentText = Number($('defermentDays')?.value) > 0 ? 'отсрочка' : 'предоплата', lineItems = calculation.stripSizeMode === 'multiple' ? calculation.stripOrders.map(order => ({ width: order.width, quantity: order.quantity, tons: quantityToTons(order.quantity, calculation.unit, calculation.thickness, order.width, calculation.length) })) : [{ width: Number($('productWidth').value), quantity: Number($('quantity').value), tons: calculation.volume }]; sheet.getCell('Q1').value = 'руб'; sheet.getCell('Q2').value = monthText; sheet.getCell('Q4').value = paymentText; lineItems.slice(0, 14).forEach((item, index) => { const row = sheet.getRow(8 + index); row.getCell(2).value = fullNomenclature(selectedType, calculation.thickness, item.width, calculation.length).toLowerCase(); row.getCell(3).value = grade; row.getCell(4).value = calculation.thickness; row.getCell(5).value = item.width; row.getCell(6).value = selectedType === 'sheet' || selectedType === 'card' ? calculation.length : null; row.getCell(7).value = getRadio('surface') === '4n' ? 'N4' : ''; row.getCell(8).value = calculation.unit === 'pieces' ? item.quantity : null; row.getCell(9).value = item.tons; row.getCell(12).value = materialCostForExport(); row.getCell(15).value = calculation.best.processing; row.getCell(16).value = 0; row.getCell(17).value = calculation.best.processing; row.getCell(21).value = salePrice; }); const purchaseRow = sheet.getRow(45); purchaseRow.getCell(2).value = fullNomenclature(selectedType, calculation.thickness, lineItems[0].width, calculation.length).toLowerCase(); purchaseRow.getCell(3).value = grade; purchaseRow.getCell(4).value = calculation.thickness; purchaseRow.getCell(5).value = lineItems[0].width; purchaseRow.getCell(6).value = selectedType === 'sheet' || selectedType === 'card' ? calculation.length : null; purchaseRow.getCell(7).value = getRadio('surface') === '4n' ? 'N4' : ''; purchaseRow.getCell(9).value = calculation.volume; purchaseRow.getCell(10).value = rate; purchaseRow.getCell(11).value = purchasePrice; purchaseRow.getCell(21).value = salePrice; sheet.getCell('D24').value = delivery; sheet.getCell('F28').value = DEFERMENT_ANNUAL_RATE; sheet.getCell('B25').value = paymentText === 'отсрочка' ? 'ДП на расч.счет' : 'предоплата'; sheet.getCell('B33').value = days; sheet.getCell('C33').value = days > 0 ? 1 : 0; sheet.getCell('D61').value = delivery; sheet.getCell('F65').value = { formula: 'F28' }; sheet.getCell('B70').value = days; sheet.getCell('C70').value = days > 0 ? 1 : 0; sheet.getCell('B8').note = `Выгружено из расчёта закупки: ${grade}, ${currency}, ${purchasePrice} валют/тн, курс ${rate}, продажа ${salePrice} руб/тн.`; if (workbook.calcProperties) { workbook.calcProperties.fullCalcOnLoad = true; workbook.calcProperties.forceFullCalc = true; } const output = await workbook.xlsx.writeBuffer(), blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `Расчет_закупки_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
 function bindPurchaseExcelExport() { const modal = $('purchaseModal'); if (!modal || modal.dataset.excelBound) return; modal.dataset.excelBound = '1'; const windowEl = modal.querySelector('.purchase-window'), result = modal.querySelector('.purchase-result'); if (!windowEl || !result) return; const meta = document.createElement('div'); meta.className = 'purchase-meta'; meta.innerHTML = '<fieldset><legend>Условия оплаты</legend><label class="radio"><input name="modalPaymentTerms" value="prepayment" type="radio" checked> Предоплата</label><label class="radio"><input name="modalPaymentTerms" value="deferment" type="radio"> Отсрочка</label></fieldset><label class="purchase-field">Месяц поставки<select id="modalDeliveryMonth"></select></label><label class="purchase-field layout-choice">Вариант раскроя<select id="layoutSelect"></select></label>'; result.before(meta); setupPurchaseMonths(); setupLayoutChoices(); const actions = modal.querySelector('.purchase-actions'); const button = document.createElement('button'); button.className = 'button primary'; button.type = 'button'; button.textContent = 'Выгрузить в Excel'; const input = document.createElement('input'); input.id = 'purchaseExcelTemplateInput'; input.type = 'file'; input.accept = '.xlsx'; input.hidden = true; actions?.prepend(button, input); const exportFile = async file => { if (!file || button.disabled) return; button.disabled = true; try { if (!currentPurchaseRate()) throw new Error('Актуальный валютный курс недоступен. Откройте расчёт повторно.'); await exportPurchaseCalculationToExcel(file); } catch (error) { console.error(error); const reason = error?.message ? `\n\nПричина: ${error.message}` : ''; alert(`Не удалось сформировать Excel из выбранного шаблона.${reason}`); } finally { button.disabled = false; } }; button.addEventListener('click', async () => { try { const response = await fetch('./расчет.xlsx', { cache: 'no-store' }); if (!response.ok) throw new Error(`Шаблон расчет.xlsx недоступен (${response.status})`); await exportFile({ name: 'расчет.xlsx', arrayBuffer: () => response.arrayBuffer() }); } catch (error) { input.click(); } }); input.addEventListener('change', async () => { await exportFile(input.files[0]); input.value = ''; }); }
function setupPurchaseMonths() { const select = $('modalDeliveryMonth'); if (!select || select.options.length) return; const source = $('deliveryMonth'); [...(source?.options || [])].forEach(option => select.add(new Option(option.textContent, option.value))); if (source?.value) select.value = source.value; }
function setupLayoutChoices() { const select = $('layoutSelect'); if (!select || select.options.length || !lastCalculation?.rows) return; lastCalculation.rows.forEach((row, index) => { const option = new Option(`${row.coilWidth} мм — ${prettyLayout(row.cardSize) || row.pieces} — ${money(row.total)} руб/тн`, String(index)); select.add(option); }); select.value = '0'; if (select.dataset.priceBound === '1') return; select.dataset.priceBound = '1'; select.addEventListener('change', () => { const row = lastCalculation?.rows?.[Number(select.value)] || lastCalculation?.best; if (!row) return; const price = Math.round(Number(row.total) || 0); ['salePrice', 'finalPrice'].forEach(id => { const input = $(id); if (!input) return; input.value = price; input.dispatchEvent(new Event('input', { bubbles: true })); }); }); }
 function repairBrokenSharedFormulas(workbook) {
    for (const sheet of workbook.worksheets) {
      const shared = [];
      sheet.eachRow(row => row.eachCell(cell => {
        if (cell.value?.sharedFormula) shared.push([cell, cell.formula]);
      }));
      for (const [cell, formula] of shared) cell.value = { formula };
    }
  }
async function exportPurchaseCalculationToExcel(file) { if (!lastCalculation || !file) return; if (!window.ExcelJS) throw new Error('ExcelJS is not loaded'); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer()); repairBrokenSharedFormulas(workbook); const sheet = workbook.getWorksheet('Расчет') || workbook.worksheets[0]; if (!sheet) throw new Error('Расчет sheet is missing'); const c = lastCalculation, grade = $('steelGrade')?.value || '', purchasePrice = Number($('purchasePrice')?.value) || 0, rate = currentPurchaseRate(), salePrice = purchaseSalePrice(c.best.total), delivery = Number($('deliveryCost')?.value) || 0, days = Number($('defermentDays')?.value) || 0, keyRate = DEFERMENT_RATE_PERCENT, monthText = $('modalDeliveryMonth')?.selectedOptions[0]?.textContent || '', paymentText = Number($('defermentDays')?.value) > 0 ? 'отсрочка' : 'предоплата', lines = c.stripSizeMode === 'multiple' ? c.stripOrders.map(order => ({ width: order.width, tons: quantityToTons(order.quantity, c.unit, c.thickness, order.width, c.length) })) : [{ width: Number($('productWidth').value), tons: c.volume }]; sheet.getCell('Q1').value = 'руб'; sheet.getCell('Q2').value = monthText; sheet.getCell('Q4').value = paymentText; const fill = (row, line, purchase = false) => { row.getCell(2).value = fullNomenclature(selectedType, c.thickness, line.width, c.length).toLowerCase(); row.getCell(3).value = grade; row.getCell(4).value = c.thickness; row.getCell(5).value = line.width; row.getCell(6).value = selectedType === 'sheet' || selectedType === 'card' ? c.length : null; row.getCell(7).value = getRadio('surface') === '4n' ? 'N4' : ''; row.getCell(9).value = line.tons; if (!purchase) { row.getCell(12).value = materialCostForExport(); row.getCell(15).value = c.best.processing; row.getCell(17).value = c.best.processing; row.getCell(21).value = salePrice; } else { row.getCell(10).value = rate; row.getCell(11).value = purchasePrice; } }; lines.slice(0, 14).forEach((line, i) => fill(sheet.getRow(8 + i), line)); fill(sheet.getRow(45), lines[0], true); sheet.getCell('D24').value = delivery; sheet.getCell('F28').value = DEFERMENT_ANNUAL_RATE; sheet.getCell('B25').value = paymentText === 'отсрочка' ? 'ДП на расч.счет' : 'предоплата'; sheet.getCell('B33').value = days; sheet.getCell('C33').value = days > 0 ? 1 : 0; sheet.getCell('D61').value = delivery; sheet.getCell('B70').value = days; sheet.getCell('C70').value = days > 0 ? 1 : 0; repairBrokenSharedFormulas(workbook); if (workbook.calcProperties) { workbook.calcProperties.fullCalcOnLoad = true; workbook.calcProperties.forceFullCalc = true; } const output = await workbook.xlsx.writeBuffer(), link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); link.download = `Расчет_закупки_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function clearTemplateInputs(sheet) { [8, 21, 45, 58].forEach((rowNumber, index) => { const end = index % 2 === 0 ? [21, 58][index / 2] : rowNumber; for (let row = rowNumber; row <= end; row += 1) for (let column = 2; column <= 21; column += 1) { const cell = sheet.getRow(row).getCell(column); if (!cell.formula && !cell.sharedFormula && !(cell.value && typeof cell.value === 'object' && cell.value.sharedFormula)) cell.value = null; } }); ['Q1', 'Q2', 'Q4', 'I24', 'J24', 'I25', 'J25', 'D24', 'F28', 'B25', 'B33', 'C33', 'D61', 'F65', 'B70', 'C70'].forEach(address => { const cell = sheet.getCell(address); if (!cell.formula && !cell.sharedFormula && !(cell.value && typeof cell.value === 'object' && cell.value.sharedFormula)) cell.value = null; }); }
  function columnNumberFromLetters(letters) { return [...letters.toUpperCase()].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0); }
  function isMergedNonTopLeft(sheet, rowNumber, columnNumber) { return (sheet.model?.merges || []).some(range => { const match = String(range).match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i); if (!match) return false; const startColumn = columnNumberFromLetters(match[1]), startRow = Number(match[2]), endColumn = columnNumberFromLetters(match[3]), endRow = Number(match[4]); return rowNumber >= startRow && rowNumber <= endRow && columnNumber >= startColumn && columnNumber <= endColumn && (rowNumber !== startRow || columnNumber !== startColumn); }); }
  function copyFormulaRow(sheet, sourceRowNumber, targetRowNumber, inputColumns = []) { const source = sheet.getRow(sourceRowNumber), target = sheet.getRow(targetRowNumber); for (let column = 1; column <= 35; column += 1) { if (inputColumns.includes(column) || (column >= 29 && column <= 31) || isMergedNonTopLeft(sheet, targetRowNumber, column)) continue; const sourceCell = source.getCell(column), sharedMaster = sourceCell.sharedFormula, formula = sourceCell.formula || (sharedMaster ? sheet.getCell(sharedMaster).formula : ''); if (!formula) continue; const masterMatch = sharedMaster && String(sharedMaster).match(/\d+$/), formulaRowNumber = masterMatch ? Number(masterMatch[0]) : sourceRowNumber; const shifted = formula.replace(new RegExp(`(\\$?[A-Z]{1,3})(\\$?)${formulaRowNumber}\\b`, 'g'), (_, columnName, absoluteRow) => `${columnName}${absoluteRow ? '$' + formulaRowNumber : targetRowNumber}`); target.getCell(column).value = { formula: shifted }; } }
 async function exportPurchaseCalculationToExcel(file) { if (!lastCalculation || !file) return; if (!window.ExcelJS) throw new Error('ExcelJS is not loaded'); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer()); repairBrokenSharedFormulas(workbook); const sheet = workbook.getWorksheet('Расчет') || workbook.worksheets[0]; if (!sheet) throw new Error('Расчет sheet is missing'); const c = lastCalculation, selectedRow = c.rows?.[Number($('layoutSelect')?.value) || 0] || c.best, grade = $('steelGrade')?.value || '', currency = $('purchaseCurrency')?.value || 'USD', purchasePrice = Number($('purchasePrice')?.value) || 0, rate = currentPurchaseRate(), salePrice = purchaseSalePrice(c.best.total), delivery = Number($('deliveryCost')?.value) || 0, days = Number($('defermentDays')?.value) || 0, keyRate = DEFERMENT_RATE_PERCENT, monthText = $('modalDeliveryMonth')?.selectedOptions[0]?.textContent || '', paymentText = Number($('defermentDays')?.value) > 0 ? 'отсрочка' : 'предоплата', typeLabel = ({ strip: 'лента', card: 'карточка', sheet: 'лист', rewind: 'рулон' })[selectedType] || selectedType, lines = c.stripSizeMode === 'multiple' ? c.stripOrders.map(order => ({ width: order.width, quantity: Number(order.quantity) || 0, tons: quantityToTons(order.quantity, c.unit, c.thickness, order.width, c.length) })) : [{ width: Number($('productWidth')?.value) || selectedRow.width || 0, quantity: Number($('quantity')?.value) || 0, tons: c.volume }]; sheet.getCell('Q1').value = 'руб'; sheet.getCell('Q2').value = monthText; sheet.getCell('Q4').value = paymentText; const fill = (row, line, purchase = false, processing = selectedRow.processing) => { row.getCell(2).value = typeLabel; row.getCell(3).value = grade; row.getCell(4).value = c.thickness; row.getCell(5).value = line.width; row.getCell(6).value = selectedType === 'sheet' || selectedType === 'card' ? c.length : null; row.getCell(7).value = getRadio('surface') === '4n' ? 'N4' : ''; row.getCell(8).value = c.unit === 'pieces' ? line.quantity : null; row.getCell(9).value = line.tons; if (!purchase) { row.getCell(12).value = materialCostForExport(); row.getCell(15).value = processing; row.getCell(17).value = processing; row.getCell(21).value = salePrice; } else { row.getCell(10).value = rate; row.getCell(11).value = purchasePrice; } }; if (lines.length > 14) throw new Error('Шаблон Excel вмещает до 14 позиций.'); lines.forEach((line, index) => fill(sheet.getRow(8 + index), line)); const inputColumns = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; lines.slice(0, 14).forEach((line, index) => { const rowNumber = 45 + index; fill(sheet.getRow(rowNumber), line, true); if (index > 0) copyFormulaRow(sheet, 45, rowNumber, inputColumns); }); sheet.getCell('D24').value = delivery; sheet.getCell('F28').value = DEFERMENT_ANNUAL_RATE; sheet.getCell('B25').value = paymentText === 'отсрочка' ? 'ДП на расч.счет' : 'предоплата'; sheet.getCell('B33').value = days; sheet.getCell('C33').value = days > 0 ? 1 : 0; sheet.getCell('D61').value = delivery; sheet.getCell('B70').value = days; sheet.getCell('C70').value = days > 0 ? 1 : 0; sheet.getCell('B8').note = `Выгружено из расчёта закупки: ${typeLabel}, ${c.thickness} мм × ${lines[0]?.width || 0} мм; ${grade}, ${currency}, ${purchasePrice} валют/тн, курс ${rate}, продажа ${salePrice} руб/тн.`; repairBrokenSharedFormulas(workbook); if (workbook.calcProperties) { workbook.calcProperties.fullCalcOnLoad = true; workbook.calcProperties.forceFullCalc = true; } const output = await workbook.xlsx.writeBuffer(), link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); link.download = `Расчет_закупки_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
 function actualCalculationForSelectedLayout(calculation) { const selected = calculation?.rows?.[Number($('layoutSelect')?.value) || 0] || calculation?.best; if (!selected) return calculation; const items = layoutWeightItems(selected, calculation.volume); if (!items.length) return { ...calculation, volume: calculation.volume * (selected.yieldRate || 1), actualVolume: calculation.volume * (selected.yieldRate || 1) }; const actualVolume = items.reduce((sum, item) => sum + item.tons, 0), orders = items.map(item => ({ width: item.width, quantity: item.tons })); return { ...calculation, volume: actualVolume, actualVolume, unit: 'tons', stripSizeMode: 'multiple', stripOrders: orders }; }
 const exportPurchaseCalculationToExcelBase = exportPurchaseCalculationToExcel;
 exportPurchaseCalculationToExcel = async function(file) { const original = lastCalculation; if (!original) return; lastCalculation = actualCalculationForSelectedLayout(original); try { return await exportPurchaseCalculationToExcelBase(file); } finally { lastCalculation = original; } };
  function setupSurfaceChoices() { const fieldset = [...document.querySelectorAll('#paramsStep fieldset')].find(item => item.querySelector('legend')?.textContent.trim() === 'Поверхность'); if (!fieldset) return; const current = document.querySelector('input[name="surface"]:checked')?.value; fieldset.innerHTML = '<legend>Поверхность</legend><label class="radio"><input name="surface" value="2b" type="radio"> 2B</label><label class="radio"><input name="surface" value="1d" type="radio"> 1D</label><label class="radio"><input name="surface" value="ba" type="radio"> BA</label><label class="radio"><input name="surface" value="m2b" type="radio"> М2Б</label><label class="radio"><input name="surface" value="4n" type="radio"> Шлифовка</label>'; document.querySelector(`input[name="surface"][value="${['2b', '1d', 'ba', 'm2b', '4n'].includes(current) ? current : '2b'}"]`).checked = true; }
  function excelSurfaceLabel() { const surface = ({ '2b': '2B', '1d': '1D', ba: 'BA', m2b: 'М2Б', '4n': 'N4' })[getRadio('surface')] || '2B', film = getRadio('film'), sides = getRadio('filmSides') === 'two' ? 2 : 1; return film === 'none' ? surface : `${surface}${Array.from({ length: sides }, () => `+${film.toUpperCase()}`).join('')}`; }
  setupSurfaceChoices();
  // Локальный режим должен запускаться независимо от загрузки ExcelJS.
  setupBatchMode();
  document.querySelectorAll('.type-card').forEach(card => card.addEventListener('click', () => setTimeout(updateBatchVisibility, 0)));
  $('calculateButton').addEventListener('click', event => { if (!batchMode || !document.querySelector('#batchModeToggle')?.checked || !batchSupported()) return; event.stopImmediatePropagation(); if (calculateBatch()) showStep(3); }, true);

  const ExcelJSWorkbook = ExcelJS.Workbook;
  ExcelJS.Workbook = class extends ExcelJSWorkbook { constructor(...args) { super(...args); const writeBuffer = this.xlsx.writeBuffer.bind(this.xlsx); this.xlsx.writeBuffer = async (...writeArgs) => { const sheet = this.getWorksheet('Расчет') || this.worksheets[0], rate = currentPurchaseRate(); if (sheet) { sheet.getCell('Q1').value = 'руб'; sheet.getCell('I24').value = 1; sheet.getCell('J24').value = rate; if (!lastCalculation?.batch) { const surface = excelSurfaceLabel(); [8, 21, 45, 58].forEach((rangeStart, index) => { const rangeEnd = index % 2 === 0 ? [21, 58][index / 2] : rangeStart; for (let row = rangeStart; row <= rangeEnd; row += 1) if (sheet.getRow(row).getCell(2).value) sheet.getRow(row).getCell(7).value = surface; }); } } return writeBuffer(...writeArgs); }; } };
  function syncPurchasePaymentChoice() { document.querySelectorAll('input[name="modalPaymentTerms"]').forEach(input => input.closest('fieldset')?.remove()); const modal = $('purchaseModal'); if (!modal) return; modal.querySelector('#salePrice')?.closest('label')?.setAttribute('hidden', 'hidden'); modal.querySelector('#salePriceOutput')?.closest('div')?.setAttribute('hidden', 'hidden'); let input = modal.querySelector('input[name="modalPaymentTerms"]'); if (!input) { input = document.createElement('input'); input.type = 'radio'; input.name = 'modalPaymentTerms'; input.hidden = true; modal.appendChild(input); } const sync = () => { input.value = Number($('defermentDays')?.value) > 0 ? 'deferment' : 'prepayment'; input.checked = true; }; $('defermentDays')?.addEventListener('input', sync); sync(); }
  document.addEventListener('click', event => { if (!event.target.closest('#purchaseModal .button.primary')) return; const input = document.querySelector('input[name="modalPaymentTerms"]'); if (input) { input.value = Number($('defermentDays')?.value) > 0 ? 'deferment' : 'prepayment'; input.checked = true; } }, true);
  // Каждый экспорт загружает свежий исходный шаблон. Не очищаем его после загрузки:
  // это сохраняет нули, оформление и формулы, которые уже находятся в шаблоне.
  new MutationObserver(() => { if ($('purchaseModal')) { bindPurchaseExcelExport(); syncPurchasePaymentChoice(); } }).observe(document.body, { childList: true });
$('calculateButton').addEventListener('click', () => { if (!$('error').hidden) return; $('resultCaption').innerHTML = $('resultCaption').innerHTML.replace(/ · (?:Без шлифовки|Шлифовка) · (?:Предоплата|Отсрочка).*$/s, ''); });
$('calculateButton').addEventListener('click', () => { if (!$('error').hidden || !lastCalculation) return; const items = lastCalculation.stripSizeMode === 'multiple' ? lastCalculation.stripOrders.map(order => ({ width: order.width, tons: quantityToTons(order.quantity, lastCalculation.unit, lastCalculation.thickness, order.width, lastCalculation.length) })) : [{ width: Number($('productWidth').value), tons: lastCalculation.volume }]; const weightText = items.map(item => `${decimal(item.width)} мм — ${decimal(item.tons)} т`).join('<br>'); $('priceBreakdown').insertAdjacentHTML('afterbegin', `<div class="theoretical-weight"><span>Теоретический вес готовой продукции</span><strong>${weightText}</strong></div>`); });
function layoutWeightItems(row, reelTons) {
  const counts = new Map();
  for (const width of row?.layoutWidths || []) {
    if (Number.isFinite(width) && width > 0) counts.set(width, (counts.get(width) || 0) + 1);
  }
  return [...counts.entries()].map(([width, count]) => ({
    width, count, tons: (row?.sourceVolume ?? reelTons) * width * count / row.coilWidth
  }));
}
 function renderActualStripWeight() { const calculation = lastCalculation, weightBox = document.querySelector('.theoretical-weight'); if (!calculation || !weightBox) return; const selected = calculation.rows?.[Number($('layoutSelect')?.value) || 0] || calculation.best, items = layoutWeightItems(selected, calculation.volume); if (!items.length) return; const actualVolume = items.reduce((sum, item) => sum + item.tons, 0); calculation.actualVolume = actualVolume; weightBox.innerHTML = `<span>Фактический вес лент из рулона ${decimal(selected.sourceVolume ?? calculation.volume)} т</span><strong>${items.map(item => `${item.count}×${decimal(item.width)} мм — ${decimal(item.tons)} т всего`).join('<br>')}</strong>`; const caption = $('resultCaption'); if (caption) caption.innerHTML = caption.innerHTML.replace(/объём\s+[\d\s,.]+\s*т/, `фактический вес ${decimal(actualVolume)} т`); $('note').hidden = true; }
 $('calculateButton').addEventListener('click', () => { $('note').hidden = true; setTimeout(renderActualStripWeight, 0); });
 new MutationObserver(() => { const select = $('layoutSelect'); if (select && select.dataset.weightBound !== '1') { select.dataset.weightBound = '1'; select.addEventListener('change', renderActualStripWeight); } }).observe(document.body, { childList: true });
function stripTons(value) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);
}
function actualWeightText(row, reelTons) {
  const items = layoutWeightItems(row, reelTons);
  if (!items.length) return `${stripTons(reelTons * (row?.yieldRate || 1))} т`;
  const total = items.reduce((sum, item) => sum + item.tons, 0);
  return `<div class="strip-weight-list">${items.map(item => {
    const target = row.requestedWeights?.find(target => Math.abs(target.width - item.width) < 1e-8);
    const deviation = target ? item.tons - target.tons : 0;
    const targetText = target ? `<small>заказ ${stripTons(target.tons)} т · откл. ${deviation >= 0 ? '+' : ''}${stripTons(deviation)} т</small>` : '';
    return `<div class="strip-weight-item"><span>${decimal(item.width)} мм × ${item.count}</span><strong>${stripTons(item.tons)} т</strong><small>по ${stripTons(item.tons / item.count)} т/ленту</small>${targetText}</div>`;
  }).join('')}<div class="strip-weight-total">Итого: ${stripTons(total)} т</div></div>`;
}
// Вызов встроен в calculate(): иначе перехват клика может пропустить обновление таблицы.
  ensurePurchaseButton(); setupDeliveryMonths(); bindExcelExport();

  // Инициализируем локальные позиции до необязательного Excel-модуля.
  // Если CDN ExcelJS временно недоступен, основная форма всё равно работает.
  setupBatchMode();
  document.querySelectorAll('.type-card').forEach(card => card.addEventListener('click', () => setTimeout(updateBatchVisibility, 0)));
  $('calculateButton').addEventListener('click', event => { if (!batchMode || !document.querySelector('#batchModeToggle')?.checked || !batchSupported()) return; event.stopImmediatePropagation(); if (calculateBatch()) showStep(3); }, true);

  // Финальная подготовка выгружаемого шаблона: рубли в шапке, формулы на всех
  // строках и прайс в добавленной пользователем панели справа.

  // Восстановление двух финансовых блоков по файлу «Расчёт к спецификации №104 Баксан».
  // Столбцы в шаблоне калькулятора сдвинуты на +1 относительно образца.
  // Не меняем вводы: D24 (доставка), D25 (доплата), B33/C33 (отсрочка)
  // и F26/F27 (воздух/откройник). НДС остаётся 22%, как согласовано ранее.
  function restoreFinancialBlocks(sheet) {
    const put = (cell, formula) => { sheet.getCell(cell).value = { formula }; };
    const formulas = {
      G24: 'I22*D24', F24: 'G24/Y22',
      E25: 'IF(B25="ДП за наличные",D25*1.5,IF(B25="ДП на расч.счет",D25,0))',
      G25: '$I$22*E25', F25: 'G25/($AC$8/1.22)',
      D26: 'G26/I22', G26: '-F26*M22',
      D27: 'G27/I22', G27: 'F27*M22',
      D28: 'G28/I22', G28: 'E38',
      D29: 'G29/I22', G29: 'SUM(G24:G28)',
      C38: 'SUM(C33:C37)', D38: 'SUM(D33:D37)', E38: 'SUM(E33:E37)',
      C39: 'D38*AD8',
      D61: 'D24', F61: 'G61/Y59', G61: 'I59*D61',
      B62: 'B25', D62: 'D25',
      E62: 'IF(B62="ДП за наличные",D62*1.5,IF(B62="ДП на расч.счет",D62,0))',
      F62: 'G62/(AC45/1.22)', G62: 'I59*D62',
      D63: 'G63/I59', F63: 'F26', G63: '-F63*M59',
      D64: 'G64/I59', F64: 'F27', G64: 'F64*M59',
      D65: 'G65/I59', F65: 'F28', G65: 'E75',
      D66: 'G66/I59', G66: 'SUM(G61:G65)',
      C75: 'SUM(C70:C74)', D75: 'SUM(D70:D74)', E75: 'SUM(E70:E74)',
      C76: 'D75*AD45'
    };
    Object.entries(formulas).forEach(([cell, formula]) => put(cell, formula));
    sheet.getCell('F28').value = DEFERMENT_ANNUAL_RATE;
    put('F65', 'F28');
    for (let row = 33; row <= 37; row += 1) {
      put('D' + row, 'IF(C' + row + '=0,0,IF(B' + row + '=0,182,IFERROR(365/(B' + row + '+1)*C' + row + ',0)))');
      put('E' + row, '$F$28/365*B' + row + '*C' + row + '*M22');
    }
    for (let row = 70; row <= 74; row += 1) {
      const source = row - 37;
      put('B' + row, 'B' + source);
      put('C' + row, 'C' + source);
      put('D' + row, 'IF(C' + row + '=0,0,IF(B' + row + '=0,182,IFERROR(365/(B' + row + '+1)*C' + row + ',0)))');
      put('E' + row, '$F$28/365*B' + row + '*C' + row + '*M59');
    }
  }

  const ExcelJSWorkbookWithExportFixes = ExcelJS.Workbook;
  ExcelJS.Workbook = class extends ExcelJSWorkbookWithExportFixes {
    constructor(...args) {
      super(...args);
      const workbook = this;
      const writeBuffer = this.xlsx.writeBuffer.bind(this.xlsx);
      this.xlsx.writeBuffer = async (...writeArgs) => {
        const sheet = workbook.getWorksheet('Расчет') || workbook.worksheets[0];
        if (sheet) {
          sheet.getCell('Q1').value = 'рубли';
          const selectedCurrency = $('purchaseCurrency')?.value || 'USD';
          const currencyFormat = selectedCurrency === 'CNY' ? '¥ #,##0.00' : '$ #,##0.00';
          ['I24', ...Array.from({ length: 15 }, (_, index) => `K${8 + index}`), ...Array.from({ length: 15 }, (_, index) => `K${45 + index}`)].forEach(address => {
            sheet.getCell(address).numFmt = currencyFormat;
          });
          // U (21) — введённая пользователем итоговая цена, не перезаписываем формулой.
          for (let row = 9; row <= 21; row += 1) copyFormulaRow(sheet, 8, row, [2, 3, 4, 5, 6, 7, 8, 9, 21]);
          for (let row = 46; row <= 58; row += 1) copyFormulaRow(sheet, 45, row, [2, 3, 4, 5, 6, 7, 8, 9, 11]);
          // В нижнем блоке переработка каждой строки берётся из соответствующей строки верхнего блока:
          // O46=O9, O47=O10 и далее. Шаблон содержит shared-ссылку O8, поэтому задаём их явно.
          for (let row = 46; row <= 58; row += 1) {
            if (sheet.getRow(row).getCell(2).value) sheet.getCell(`O${row}`).value = { formula: `O${row - 37}` };
          }
          for (let row = 45; row <= 58; row += 1) {
            if (sheet.getRow(row).getCell(2).value) sheet.getCell(`Q${row}`).value = { formula: `SUM(N${row}:P${row})` };
          }
          for (let row = 45; row <= 58; row += 1) {
            if (sheet.getRow(row).getCell(2).value) sheet.getCell(`U${row}`).value = { formula: `U${row - 37}` };
          }
          let priceHeader;
          sheet.eachRow(row => row.eachCell(cell => {
             if (!priceHeader && /^прайс$/i.test(String(cell.value ?? '').trim())) priceHeader = cell;
          }));
          if (priceHeader) {
            const setPrice = (rowNumber, itemIndex) => {
              if (!sheet.getRow(rowNumber).getCell(2).value) return;
              const itemPrice = lastCalculation?.batch ? Number(lastCalculation.batchItems[itemIndex]?.input?.price) || 0 : Number($('price')?.value) || lastCalculation?.best?.price || 0;
              sheet.getRow(rowNumber).getCell(priceHeader.col).value = itemPrice;
            };
            for (let row = 8; row <= 21; row += 1) setPrice(row, row - 8);
            for (let row = 45; row <= 58; row += 1) setPrice(row, row - 45);
          }
          else {
            sheet.getCell('AJ7').value = 'прайс';
            sheet.getCell('AJ8').value = Number($('price')?.value) || lastCalculation?.best?.price || 0;
          }
          for (let row = 45; row <= 58; row += 1) if (sheet.getRow(row).getCell(2).value) sheet.getRow(row).getCell(14).value = 2800;
          restoreFinancialBlocks(sheet);
          // В образце Баксан P = SUM(M:O); в шаблоне экспорта сдвиг на один столбец.
          for (const start of [8, 45]) {
            for (let row = start; row < start + 14; row += 1) {
              const active = sheet.getCell(`B${start === 8 ? row : row - 37}`).value;
              if (!active) {
                for (let column = 2; column <= 31; column += 1) {
                  const cell = sheet.getRow(row).getCell(column);
                  if (!cell.isMerged || cell.master === cell) cell.value = null;
                }
                continue;
              }
              sheet.getCell(`Q${row}`).value = { formula: `SUM(N${row}:P${row})` };
              if (start === 8) sheet.getCell(`J${row}`).value = { formula: '$J$24' };
              else sheet.getCell(`P${row}`).value = { formula: `P${row - 37}` };
              const denominators = { K: 'J', T: 'J', X: 'Y', AA: 'Y', AB: 'S' };
              for (const [column, denominator] of Object.entries(denominators)) {
                const cell = sheet.getCell(`${column}${row}`);
                if (cell.formula && !(start === 45 && column === "K")) cell.value = { formula: `IF(${denominator}${row}=0,0,${cell.formula})` };
              }
              if (start === 45) sheet.getCell(`X${row}`).value = { formula: `IF(Y${row}=0,"",(Z${row}-$D$66*I${row})/Y${row})` };
            }
          }
          const denominatorByCell = { AA22:'Y22', AB22:'S22', AA59:'Y59', AB59:'S59', AD8:'Y22', AE8:'S22', AD45:'Y59', AE45:'S59', F24:'Y22', F25:'AC8', F61:'Y59', F62:'AC45' };
          for (const [address, denominator] of Object.entries(denominatorByCell)) {
            const cell = sheet.getCell(address);
            if (cell.formula) cell.value = { formula: `IF(${denominator}=0,"",${cell.formula})` };
          }
          // НДС 22%: заменяем /1.2 на /1.22 во всех формулах расчётного
          // шаблона (цены без НДС, рентабельность, строки сводного расчёта).
          sheet.eachRow(row => row.eachCell(cell => {
            const formula = cell.formula;
            if (typeof formula !== 'string' || !/\/\s*1\.2(?!\d)/.test(formula)) return;
            cell.value = { formula: formula.replace(/\/(\s*)1\.2(?!\d)/g, (_, space) => `/${space}1.22`) };
          }));
          if (workbook.calcProperties) {
            workbook.calcProperties.fullCalcOnLoad = true;
            workbook.calcProperties.forceFullCalc = true;
          }
        }
        const originalGetCell = sheet?.getCell?.bind(sheet);
        if (sheet && originalGetCell) sheet.getCell = (address, ...cellArgs) => { const cell = originalGetCell(address, ...cellArgs); if (address === 'Q1') return new Proxy(cell, { set(target, property, value) { target[property] = property === 'value' && value === 'руб' ? 'рубли' : value; return true; } }); return cell; };
        try { return await writeBuffer(...writeArgs); } finally { if (sheet && originalGetCell) sheet.getCell = originalGetCell; }
      };
    }
  };

// Локальный режим сводной заявки для листов, карточек и рулонов.
// Ленты продолжают использовать существующий режим нескольких типоразмеров.
var batchMode = false;
function batchSupported() { return selectedType === 'sheet' || selectedType === 'card' || selectedType === 'rewind'; }
function batchRowMarkup(row = {}) {
  const lengthField = selectedType === 'sheet' || selectedType === 'card'
    ? `<label>Длина, мм<input class="batch-length" type="number" min="1" step="1" value="${row.length ?? 2500}" placeholder="Длина"></label>`
    : '';
  const grades = typeof STEEL_GRADES === 'undefined' ? ['AISI 201 J4'] : STEEL_GRADES;
  const gradeOptions = grades.map(grade => `<option value="${grade}" ${grade === (row.grade || 'AISI 201 J4') ? 'selected' : ''}>${grade}</option>`).join('');
  const surfaceOptions = [['2b', '2B'], ['1d', '1D'], ['ba', 'BA'], ['m2b', 'М2Б'], ['4n', 'Шлифовка']].map(([value, label]) => `<option value="${value}" ${value === (row.surface || '2b') ? 'selected' : ''}>${label}</option>`).join('');
  const filmOptions = [['none', 'Без плёнки'], ['pe', 'PE'], ['lpe', 'LPE']].map(([value, label]) => `<option value="${value}" ${value === (row.film || 'none') ? 'selected' : ''}>${label}</option>`).join('');
  const filmSideOptions = [['one', 'Одна сторона'], ['two', 'Две стороны']].map(([value, label]) => `<option value="${value}" ${value === (row.filmSides || 'one') ? 'selected' : ''}>${label}</option>`).join('');
  return `<div class="batch-row">
    <label>Марка<select class="batch-grade">${gradeOptions}</select></label>
    <label>Толщина, мм<input class="batch-thickness" type="number" min="0.01" step="0.01" value="${row.thickness ?? 1.2}" placeholder="Толщина"></label>
    <label>Ширина, мм<input class="batch-width" type="number" min="1" step="1" value="${row.width ?? 1250}" placeholder="Ширина"></label>
    ${lengthField}
    <label>Поверхность<select class="batch-surface">${surfaceOptions}</select></label>
    <label>Плёнка<select class="batch-film">${filmOptions}</select></label>
    <label>Стороны плёнки<select class="batch-film-sides">${filmSideOptions}</select></label>
    <label>Количество<input class="batch-quantity" type="number" min="0.001" step="0.001" value="${row.quantity ?? 1}" placeholder="Вес / штуки"></label>
    <label>Себестоимость, руб/т<input class="batch-material" type="text" inputmode="decimal" value="${row.materialCost ?? 0}" placeholder="Себестоимость"></label>
    <label>Прайс, руб/т<input class="batch-price" type="text" inputmode="decimal" value="${row.price ?? 0}" placeholder="Прайс"></label>
    <button class="button ghost batch-remove" type="button" aria-label="Удалить позицию">×</button>
  </div>`;
}
function readBatchRows() {
  return [...document.querySelectorAll('.batch-row')].map(row => ({
    width: Number(row.querySelector('.batch-width')?.value),
    length: Number(row.querySelector('.batch-length')?.value) || 0,
    thickness: Number(row.querySelector('.batch-thickness')?.value),
    quantity: Number(row.querySelector('.batch-quantity')?.value),
    materialCost: parseNumericInput(row.querySelector('.batch-material')?.value),
    price: parseNumericInput(row.querySelector('.batch-price')?.value),
    grade: row.querySelector('.batch-grade')?.value || 'AISI 201 J4',
    surface: row.querySelector('.batch-surface')?.value || '2b',
    film: row.querySelector('.batch-film')?.value || 'none',
    filmSides: row.querySelector('.batch-film-sides')?.value || 'one'
  }));
}
function updateBatchVisibility() {
  const host = $('batchPositions'), toggle = $('batchModeToggle');
  if (toggle) batchMode = toggle.checked;
  if (!host || !toggle) return;
  const supported = batchSupported();
  toggle.closest('label')?.toggleAttribute('hidden', !supported);
  if (!supported && batchMode) { batchMode = false; toggle.checked = false; }
  document.querySelectorAll('.field-grid > label').forEach(label => { label.hidden = batchMode && supported; });
  const surfaceFieldset = [...document.querySelectorAll('#paramsStep fieldset')].find(fieldset => fieldset.querySelector('legend')?.textContent.trim() === 'Поверхность');
  if (surfaceFieldset) surfaceFieldset.hidden = batchMode && supported;
  const filmFieldset = [...document.querySelectorAll('#paramsStep fieldset')].find(fieldset => fieldset.querySelector('legend')?.textContent.trim() === 'Плёнка');
  if (filmFieldset) { filmFieldset.hidden = batchMode && supported; filmFieldset.style.display = batchMode && supported ? 'none' : ''; }
  const filmSidesFieldset = document.querySelector('.film-sides-field');
  if (filmSidesFieldset) { filmSidesFieldset.hidden = batchMode && supported; filmSidesFieldset.style.display = batchMode && supported ? 'none' : ''; }
  host.hidden = !(batchMode && supported);
  if (!(batchMode && supported)) return;
  if (!host.querySelector('.batch-row')) {
    host.innerHTML = `<div class="batch-heading"><strong>Позиции заявки</strong><span>У каждой позиции свои размеры, толщина, марка, поверхность, себестоимость и прайс. Одинаковые марка + толщина + ширина + поверхность автоматически объединяются в один рулон.</span></div><div class="batch-rows"></div><button class="button ghost batch-add" type="button">+ Добавить типоразмер</button>`;
    const rows = host.querySelector('.batch-rows');
    rows.insertAdjacentHTML('beforeend', batchRowMarkup({ grade: $('materialGrade')?.value || 'AISI 201 J4', width: Number($('productWidth')?.value) || 1250, length: Number($('productLength')?.value) || 2500, thickness: Number($('thickness')?.value) || 1.2, quantity: Number($('quantity')?.value) || 1, materialCost: 0, price: 0, film: getRadio('film') || 'none', filmSides: getRadio('filmSides') || 'one' }));
    rows.querySelectorAll('.batch-material,.batch-price').forEach(bindAmountFormatting);
    host.querySelector('.batch-add').addEventListener('click', () => {
      const source = rows.lastElementChild;
      const value = selector => source?.querySelector(selector)?.value || '';
      rows.insertAdjacentHTML('beforeend', batchRowMarkup({
        grade: value('.batch-grade') || 'AISI 201 J4',
        thickness: Number(value('.batch-thickness')) || 1.2,
        width: Number(value('.batch-width')) || 1250,
        length: Number(value('.batch-length')) || 2500,
        surface: value('.batch-surface') || '2b',
        film: value('.batch-film') || 'none',
        filmSides: value('.batch-film-sides') || 'one',
        quantity: Number(value('.batch-quantity')) || 1,
        materialCost: 0,
        price: 0
      }));
      rows.lastElementChild.querySelectorAll('.batch-material,.batch-price').forEach(bindAmountFormatting);
    });
    host.addEventListener('click', event => { if (event.target.closest('.batch-remove')) { const all = host.querySelectorAll('.batch-row'); if (all.length > 1) event.target.closest('.batch-row').remove(); } });
  }
}
function setupBatchMode() {
  const fieldGrid = document.querySelector('#paramsStep .field-grid');
  if (!fieldGrid || $('batchModeToggle')) return;
  const label = document.createElement('label');
  label.className = 'batch-toggle radio';
  label.innerHTML = '<input id="batchModeToggle" type="checkbox"> Несколько типоразмеров';
  fieldGrid.before(label);
  const host = document.createElement('div'); host.id = 'batchPositions'; host.className = 'batch-positions'; host.hidden = true; fieldGrid.after(host);
  $('batchModeToggle').addEventListener('change', event => { batchMode = event.target.checked; updateBatchVisibility(); });
  updateBatchVisibility();
}
function bestCardBatchCoilWidth(widths, items) {
  return widths.map(width => {
    let cost = 0, yieldRate = 0;
    for (const item of items) {
      const row = item.calculation.rows.find(candidate => candidate.coilWidth === width);
      cost += row.total * item.orderVolume;
      yieldRate += row.yieldRate * item.orderVolume;
    }
    return { width, cost, yieldRate };
  }).sort((a, b) => a.cost - b.cost || b.yieldRate - a.yieldRate || a.width - b.width)[0]?.width;
}

function calculateBatch() {
  const rows = readBatchRows(), error = $('error');
  if (rows.length < 2) { error.textContent = 'Добавьте минимум две позиции и заполните все их параметры.'; error.hidden = false; return false; }
  const invalidIndex = rows.findIndex(row =>
    ![row.width, row.length, row.thickness, row.quantity, row.materialCost, row.price].every(Number.isFinite)
    || row.width <= 0 || row.thickness <= 0 || row.quantity <= 0
    || row.materialCost < 0 || row.price < 0
    || ((selectedType === 'sheet' || selectedType === 'card') && row.length <= 0));
  if (invalidIndex !== -1) {
    error.textContent = `Проверьте параметры позиции №${invalidIndex + 1}.`;
    error.hidden = false;
    return false;
  }
  const groups = new Map(); rows.forEach((row, index) => { const key = `${row.grade}|${row.thickness}|${row.width}|${row.surface}|${row.film}|${row.filmSides}`; if (!groups.has(key)) groups.set(key, { id: groups.size + 1, rows: [] }); groups.get(key).rows.push({ row, index }); });
  const original = { thickness: $('thickness').value, productWidth: $('productWidth').value, productLength: $('productLength').value, quantity: $('quantity').value, materialCost: $('materialCost').value, price: $('price').value, surface: getRadio('surface'), film: getRadio('film'), filmSides: getRadio('filmSides') };
  const items = [];
  for (const row of rows) {
    $('thickness').value = row.thickness; $('productWidth').value = row.width; $('productLength').value = row.length; $('quantity').value = row.quantity; $('materialCost').value = row.materialCost; $('price').value = row.price;
    document.querySelector(`input[name="surface"][value="${row.surface}"]`)?.click(); document.querySelector(`input[name="film"][value="${row.film}"]`)?.click(); document.querySelector(`input[name="filmSides"][value="${row.filmSides}"]`)?.click();
    lastCalculation = null; $('error').hidden = true;
    calculate();
    if (!$('error').hidden || !lastCalculation?.best) { error.textContent = `Позиция ${row.width} мм × ${row.thickness} мм не рассчиталась. Проверьте толщину, ширину и количество этой позиции.`; error.hidden = false; Object.entries(original).forEach(([id, value]) => { if (id === 'surface' || id === 'film' || id === 'filmSides') document.querySelector(`input[name="${id}"][value="${value}"]`)?.click(); else $(id).value = value; }); return false; }
    items.push({ input: row, orderVolume: lastCalculation.volume, groupKey: `${row.grade}|${row.thickness}|${row.width}|${row.surface}|${row.film}|${row.filmSides}`, calculation: JSON.parse(JSON.stringify(lastCalculation)) });
  }
  const groupVolumes = new Map();
  items.forEach(item => groupVolumes.set(item.groupKey, (groupVolumes.get(item.groupKey) || 0) + item.calculation.volume));
  items.forEach(item => {
    const groupVolume = groupVolumes.get(item.groupKey) || item.calculation.volume;
    const { input } = item;
    const quantity = getRadio('unit') === 'tons'
      ? groupVolume
      : getRadio('unit') === 'meters'
        ? groupVolume / (input.thickness * input.width * PRICE.density * 0.000001)
        : groupVolume / (input.thickness * (input.width / 1000) * ((input.length || 1) / 1000) * PRICE.density / 1000);
    $('thickness').value = input.thickness; $('productWidth').value = input.width; $('productLength').value = input.length; $('quantity').value = quantity; $('materialCost').value = input.materialCost; $('price').value = input.price;
    document.querySelector(`input[name="surface"][value="${input.surface}"]`)?.click();
    document.querySelector(`input[name="film"][value="${input.film}"]`)?.click();
    document.querySelector(`input[name="filmSides"][value="${input.filmSides}"]`)?.click();
    calculate();
    item.calculation = JSON.parse(JSON.stringify(lastCalculation));
    item.calculation.orderVolume = item.orderVolume;
    item.calculation.groupVolume = groupVolume;
  });
  Object.entries(original).forEach(([id, value]) => { if (id === 'surface' || id === 'film' || id === 'filmSides') document.querySelector(`input[name="${id}"][value="${value}"]`)?.click(); else $(id).value = value; });
  groups.forEach(group => {
    const groupItems = items.filter(item => item.groupKey === `${group.rows[0].row.grade}|${group.rows[0].row.thickness}|${group.rows[0].row.width}|${group.rows[0].row.surface}|${group.rows[0].row.film}|${group.rows[0].row.filmSides}`);
    const commonWidths = groupItems.reduce((common, item) => { const widths = new Set((item.calculation.rows || []).map(row => row.coilWidth)); return common ? new Set([...common].filter(width => widths.has(width))) : widths; }, null);
    const widths = [...(commonWidths || [])];
    const sharedCoilWidth = selectedType === 'card'
      ? bestCardBatchCoilWidth(widths, groupItems)
      : widths.sort((a, b) => a - b)[0];
    if (sharedCoilWidth) groupItems.forEach(item => { const sharedRow = item.calculation.rows.find(row => row.coilWidth === sharedCoilWidth); if (sharedRow) item.calculation.best = sharedRow; item.calculation.sharedCoilWidth = sharedCoilWidth; item.groupId = group.id; });
  });
  const totalVolume = items.reduce((sum, item) => sum + (item.calculation.orderVolume || item.calculation.volume), 0);
  const weighted = key => totalVolume ? items.reduce((sum, item) => sum + (item.calculation.orderVolume || item.calculation.volume) * (Number(item.calculation.best?.[key]) || 0), 0) / totalVolume : 0;
  lastCalculation = { batch: true, batchItems: items, groupCount: groups.size, volume: totalVolume, thickness: null, length: 0, unit: getRadio('unit'), paymentTerms: getRadio('paymentTerms'), stripOrders: [], stripSizeMode: 'batch', best: { total: weighted('total'), price: weighted('price'), processing: weighted('processing'), scrapCost: weighted('scrapCost'), operations: [] }, rows: [] };
  renderBatchResults(items, totalVolume, weighted);
  error.hidden = true;
  return true;
}
function renderBatchResults(items, totalVolume, weighted) {
  document.querySelector('.table-wrap').hidden = false;
  document.querySelector('#resultsStep thead').innerHTML = '<tr><th>Позиция</th><th>Размер</th><th>Толщина</th><th>Вес</th><th>Себестоимость</th><th>Прайс</th><th>Итоговая цена</th></tr>';
  $('resultsBody').innerHTML = items.map(({ input, calculation }) => `<tr class="best"><td><strong>${resultNames[selectedType]}</strong></td><td>${decimal(input.width)}${input.length ? ` × ${decimal(input.length)}` : ''} мм</td><td>${decimal(input.thickness)} мм</td><td>${decimal(calculation.volume)} т</td><td>${money(input.materialCost)} руб/т</td><td>${money(input.price)} руб/т</td><td><strong>${money(calculation.best.total)} руб/т</strong></td></tr>`).join('');
  $('recommendation').innerHTML = `Сводный расчёт: <strong>${items.length} позиции</strong><span>Общий объём: ${decimal(totalVolume)} т · цены и себестоимость рассчитаны отдельно для каждой строки</span>`;
  $('resultCaption').innerHTML = `${resultNames[selectedType]} · ${items.length} позиции · общий объём ${decimal(totalVolume)} т`;
  if (getRadio('unit') === 'pieces') $('resultCaption').innerHTML += ` · всего штук ${decimal(items.reduce((sum, item) => sum + (Number(item.input.quantity) || 0), 0))}`;
  $('priceBreakdown').innerHTML = `<h3>Итог по заявке: ${money(weighted('total'))} руб/т в среднем</h3><div class="price-lines">${items.map(({ input, calculation }) => `<div><span>${decimal(input.width)}${input.length ? `×${decimal(input.length)}` : ''} мм · ${decimal(input.thickness)} мм</span><strong>${money(calculation.best.total)} руб/т</strong></div>`).join('')}<div class="grand"><span>Средневзвешенная цена</span><strong>${money(weighted('total'))} руб/т</strong></div></div>`;
  $('note').textContent = 'Локальный сводный режим: каждая позиция рассчитана с собственными толщиной, себестоимостью и прайсом.';
}
setupBatchMode();
document.querySelectorAll('.type-card').forEach(card => card.addEventListener('click', () => setTimeout(updateBatchVisibility, 0)));
$('calculateButton').addEventListener('click', event => { if (!batchMode || !document.querySelector('#batchModeToggle')?.checked || !batchSupported()) return; event.stopImmediatePropagation(); if (calculateBatch()) showStep(3); }, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('purchaseModal')) { event.preventDefault(); $('purchaseModal').remove(); } });

async function exportBatchPurchaseCalculationToExcel(file) {
  if (!lastCalculation?.batch || !file || !window.ExcelJS) return;
  if (lastCalculation.batchItems.length > 14) throw new Error('Шаблон Excel вмещает до 14 позиций.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer()); repairBrokenSharedFormulas(workbook);
  const sheet = workbook.getWorksheet('Расчет') || workbook.worksheets[0];
  if (!sheet) throw new Error('В шаблоне не найден лист расчёта.');
  const grade = $('steelGrade')?.value || '', purchasePrice = numericInputValue($('purchasePrice')?.value);
  const groupPrices = Object.fromEntries([...document.querySelectorAll('.batch-purchase-price')].map(input => [input.dataset.group, numericInputValue(input.value)]));
  const salePrices = [...document.querySelectorAll('.batch-sale-price')].map(input => numericInputValue(input.value));
  // Экспортируем цены, реально показанные в окне после ручного редактирования.
  const finalPrices = lastCalculation.batchItems.map((_, index) => {
    const visible = document.querySelector(`#batchPurchaseSummary .batch-card-final-price[data-index="${index}"]`);
    if (visible && visible.value.trim() !== '') return numericInputValue(visible.value);
    const edited = lastCalculation.batchFinalPrices?.[index];
    if (edited !== undefined) return edited;
    const calculated = document.querySelector(`#batchFinalFields .batch-final-price[data-index="${index}"]`);
    return calculated && calculated.value.trim() !== '' ? numericInputValue(calculated.value) : undefined;
  });
  const rate = currentPurchaseRate();
  const keyRate = DEFERMENT_RATE_PERCENT;
  const delivery = Math.max(0, numericInputValue($('deliveryCost')?.value)), days = Math.max(0, numericInputValue($('defermentDays')?.value));
  const monthText = $('modalDeliveryMonth')?.selectedOptions[0]?.textContent || '', paymentText = days > 0 ? 'отсрочка' : 'предоплата';
  const typeLabel = ({ card: 'карточка', sheet: 'лист', rewind: 'рулон' })[selectedType] || selectedType;
  const items = lastCalculation.batchItems.slice(0, 14);
  sheet.getCell('Q1').value = 'рубли'; sheet.getCell('Q2').value = monthText; sheet.getCell('Q4').value = paymentText;
  items.forEach(({ input, calculation, groupKey }, index) => {
    const fill = (row, purchase = false) => {
      row.getCell(2).value = typeLabel; row.getCell(3).value = input.grade || grade; row.getCell(4).value = input.thickness; row.getCell(5).value = input.width;
      row.getCell(6).value = selectedType === 'sheet' || selectedType === 'card' ? input.length : null; row.getCell(7).value = batchSurfaceLabel(input);
      row.getCell(8).value = getRadio('unit') === 'pieces' ? input.quantity : null; row.getCell(9).value = calculation.orderVolume || calculation.volume;
      if (purchase) { const itemGroupKey = groupKey || `${input.grade}|${input.thickness}|${input.width}|${input.surface}`; row.getCell(10).value = rate; row.getCell(11).value = groupPrices[itemGroupKey] ?? purchasePrice; }
      else { row.getCell(12).value = input.materialCost; row.getCell(15).value = calculation.best.processing; row.getCell(17).value = calculation.best.processing; row.getCell(21).value = finalPrices[index] ?? salePrices[index] ?? calculation.best.total; }
    };
    const top = sheet.getRow(8 + index), bottom = sheet.getRow(45 + index); fill(top); fill(bottom, true); if (index > 0) copyFormulaRow(sheet, 45, 45 + index, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  sheet.getCell('D24').value = delivery; sheet.getCell('F28').value = DEFERMENT_ANNUAL_RATE; sheet.getCell('B25').value = paymentText === 'отсрочка' ? 'ДП на расч.счет' : 'предоплата'; sheet.getCell('B33').value = days; sheet.getCell('C33').value = days > 0 ? 1 : 0; sheet.getCell('D61').value = delivery; sheet.getCell('F65').value = { formula: 'F28' }; sheet.getCell('B70').value = days; sheet.getCell('C70').value = days > 0 ? 1 : 0;
  if (workbook.calcProperties) { workbook.calcProperties.fullCalcOnLoad = true; workbook.calcProperties.forceFullCalc = true; }
  const output = await workbook.xlsx.writeBuffer(), link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); link.download = `Расчет_сводный_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
const exportPurchaseCalculationBase3 = exportPurchaseCalculationToExcel;
exportPurchaseCalculationToExcel = async function(file) { return lastCalculation?.batch ? exportBatchPurchaseCalculationToExcel(file) : exportPurchaseCalculationBase3(file); };

// В сводной заявке каждый типоразмер показывает собственный набор раскроев.
renderBatchResults = function(items, totalVolume, weighted) {
  document.querySelector('.table-wrap').hidden = false;
  document.querySelector('#resultsStep thead').innerHTML = '<tr><th>Исходный рулон</th><th>Раскрой</th><th>Фактический вес</th><th>Откройник</th><th>Итоговая цена</th></tr>';
  $('resultsBody').innerHTML = items.map(({ input, calculation }, itemIndex) => {
    const rows = (calculation.rows || []).slice().sort((a, b) => a.total - b.total || b.yieldRate - a.yieldRate).filter((row, index, list) => list.findIndex(item => item.coilWidth === row.coilWidth) === index).slice(0, COIL_WIDTHS.length), best = rows[0] || calculation.best;
    const rowsHtml = rows.map((row, index) => `<tr class="${index === 0 ? 'best' : ''}"><td><strong>${row.coilWidth} мм</strong>${index === 0 ? ' <em>лучший</em>' : ''}</td><td>${prettyLayout(row.cardSize) || row.pieces}</td><td>${actualWeightText(row, calculation.orderVolume || calculation.volume)}</td><td>${decimal(row.scrap)} мм / ${pct((1 - row.yieldRate) * 100)}</td><td><strong>${money(row.total)} руб/т</strong></td></tr>`).join('');
    return `<tr class="batch-position-heading"><td colspan="5"><strong>${itemIndex + 1}. ${resultNames[selectedType]} · ${input.grade} · ${decimal(input.thickness)} мм · ${decimal(input.width)}${input.length ? `×${decimal(input.length)}` : ''} мм · ${surfaceLabelFor(input.surface)}</strong><span>Заказ: ${decimal(calculation.orderVolume || calculation.volume)} т · общий объём группы: ${decimal(calculation.groupVolume || calculation.volume)} т · прайс ${money(input.price)} руб/т · себестоимость ${money(input.materialCost)} руб/т</span></td></tr>${rowsHtml || `<tr><td colspan="5">Подходящий раскрой не найден</td></tr>`}`;
  }).join('');
  const groupLabel = lastCalculation.groupCount === 1 ? 'группа рулона' : (lastCalculation.groupCount < 5 ? 'группы рулонов' : 'групп рулонов');
  $('recommendation').innerHTML = `Расчёт по ${items.length} позициям · ${lastCalculation.groupCount} ${groupLabel} <span>Одинаковые марка + толщина + ширина + поверхность объединены автоматически; разные группы считаются отдельно.</span>`;
  $('resultCaption').innerHTML = `${resultNames[selectedType]} · ${items.length} типоразмера · общий объём ${decimal(totalVolume)} т`;
  $('priceBreakdown').innerHTML = `<h3>Итоги по позициям</h3><div class="price-lines">${items.map(({ input, calculation }, index) => `<div><span>${index + 1}. ${resultNames[selectedType]} · ${input.grade} · ${decimal(input.thickness)} мм · ${decimal(input.width)}${input.length ? `×${decimal(input.length)}` : ''} мм · ${surfaceLabelFor(input.surface)}<small>Объём: ${decimal(calculation.orderVolume || calculation.volume)} т · прайс: ${money(input.price)} руб/т</small></span><strong>${money(calculation.best.total)} руб/т</strong></div>`).join('')}<div class="grand"><span>Средневзвешенная цена заявки</span><strong>${money(weighted('total'))} руб/т</strong></div></div>`;
  $('note').textContent = 'Каждая позиция рассчитана отдельно. Для Excel можно выбрать раскрой для каждой строки в окне закупки.';
};

// В окне закупки выбирается раскрой отдельно для каждой позиции.
setupLayoutChoices = function() {
  const select = $('layoutSelect');
  if (!select) return;
  const layoutLabel = select.closest('.layout-choice');
  // Варианты раскроя по позициям показываем только для ленты и карточки.
  if (selectedType !== 'strip' && selectedType !== 'card') {
    if (layoutLabel) layoutLabel.hidden = true;
    select.remove();
    return;
  }
  if (layoutLabel) layoutLabel.hidden = false;
  if (lastCalculation?.batch) {
    if (layoutLabel?.dataset.batchBound === '1') return;
    layoutLabel.dataset.batchBound = '1';
    layoutLabel.innerHTML = '<span>Варианты раскроя по позициям</span>';
    lastCalculation.batchItems.forEach(({ input, calculation }, index) => {
      const label = document.createElement('label'); label.className = 'batch-export-choice'; label.textContent = `${index + 1}. ${decimal(input.width)}${input.length ? `×${decimal(input.length)}` : ''} мм · ${decimal(input.thickness)} мм`;
      const choice = document.createElement('select'); choice.className = 'batch-layout-select'; choice.dataset.index = String(index);
      (calculation.rows || []).slice(0, 5).forEach((row, rowIndex) => choice.add(new Option(`${row.coilWidth} мм — ${prettyLayout(row.cardSize) || row.pieces} — ${money(row.total)} руб/т`, String(rowIndex))));
      choice.value = '0'; label.appendChild(choice); layoutLabel.appendChild(label);
    });
    select.remove();
    return;
  }
  if (!lastCalculation?.rows) return;
  if (!select.options.length) lastCalculation.rows.forEach((row, index) => select.add(new Option(`${row.coilWidth} мм — ${prettyLayout(row.cardSize) || row.pieces} — ${money(row.total)} руб/тн`, String(index))));
  select.value = '0';
  if (select.dataset.priceBound !== '1') {
    select.dataset.priceBound = '1';
    select.addEventListener('change', () => {
      const row = lastCalculation?.rows?.[Number(select.value)] || lastCalculation?.best;
      if (!row) return;
      const price = Math.round(Number(row.total) || 0);
      lastCalculation.best = row;
      ['salePrice', 'finalPrice'].forEach(id => {
        const input = $(id);
        if (!input) return;
        input.value = price;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }
};

const exportBatchCalculationBase4 = exportBatchPurchaseCalculationToExcel;
exportBatchPurchaseCalculationToExcel = async function(file) {
  if (!lastCalculation?.batch) return exportBatchCalculationBase4(file);
  const selectedRows = [...document.querySelectorAll('.batch-layout-select')].map(select => Number(select.value) || 0);
  const originalItems = lastCalculation.batchItems;
  const chosenItems = originalItems.map((item, index) => ({ ...item, calculation: { ...item.calculation, best: item.calculation.rows?.[selectedRows[index]] || item.calculation.best } }));
  const saved = lastCalculation.batchItems; lastCalculation.batchItems = chosenItems;
  try { return await exportBatchCalculationBase4(file); } finally { lastCalculation.batchItems = saved; }
};
function surfaceLabelFor(surface) { return ({ '2b': '2B', '1d': '1D', ba: 'BA', m2b: 'М2Б', '4n': 'N4' })[surface] || '2B'; }
function batchSurfaceLabel(input) { const surface = surfaceLabelFor(input.surface), film = input.film || 'none', sides = input.filmSides === 'two' ? 2 : 1; return film === 'none' ? surface : `${surface}${Array.from({ length: sides }, () => `+${film.toUpperCase()}`).join('')}`; }
function parseNumericInput(value) { const normalized = String(value ?? '').replace(/\s/g, '').replace(',', '.'); return normalized === '' ? 0 : Number(normalized); }
function numericInputValue(value) { const number = parseNumericInput(value); return Number.isFinite(number) ? number : 0; }
// Себестоимость сохраняется при расчёте. Отформатированное значение "137 950"
// нельзя читать через Number(): получался NaN и в Excel уходил ноль.
function materialCostForExport(calculation = lastCalculation) {
  return numericInputValue(calculation?.materialCost ?? $('materialCost')?.value);
}
function formatAmountInput(input) { const value = numericInputValue(input.value); input.value = value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/\u00a0/g, ' '); }
function bindAmountFormatting(input) { if (!input || input.dataset.amountBound === '1') return; input.type = 'text'; input.inputMode = 'decimal'; input.dataset.amountBound = '1'; input.addEventListener('focus', () => { input.value = numericInputValue(input.value) === 0 ? '' : String(input.value).replace(/\s/g, ''); }); input.addEventListener('blur', () => formatAmountInput(input)); formatAmountInput(input); }
['materialCost', 'price'].forEach(id => bindAmountFormatting($(id)));

function setupBatchPurchaseWindow() {
  if (!lastCalculation?.batch || $('batchPurchaseFields')) return;
  const genericPurchase = $('purchasePrice')?.closest('label');
  if (genericPurchase) genericPurchase.remove();
  const genericGrade = $('steelGrade')?.closest('label');
  if (genericGrade) genericGrade.remove();
  const meta = document.querySelector('#purchaseModal .purchase-meta'), result = document.querySelector('#purchaseModal .purchase-result');
  if (!meta || !result) return;
  const groups = [...new Map(lastCalculation.batchItems.map(item => [item.groupKey, item])).entries()];
  const block = document.createElement('div'); block.id = 'batchPurchaseFields'; block.className = 'batch-purchase-fields';
  block.innerHTML = '<strong>Цена закупки по группам рулонов</strong><span>Одинаковые марка + толщина + ширина + поверхность используют одну цену закупки.</span>';
  const currencyLabel = $('purchaseCurrency')?.closest('label'), rateBox = $('cbrRate')?.closest('.purchase-rate');
  if (currencyLabel) block.appendChild(currencyLabel);
  if (rateBox) block.appendChild(rateBox);
  groups.forEach(([key, item], index) => { const label = document.createElement('label'); label.className = 'purchase-field'; label.innerHTML = `Группа ${index + 1}: ${item.input.grade} · ${decimal(item.input.width)} мм · ${decimal(item.input.thickness)} мм · ${surfaceLabelFor(item.input.surface)}<input class="batch-purchase-price" data-group="${key}" type="text" inputmode="decimal" min="0" placeholder="Цена закупки, валют/т" value="0">`; block.appendChild(label); });
  meta.before(block);
  const sale = $('salePrice')?.closest('label'); if (sale) sale.hidden = true;
  const final = $('finalPrice')?.closest('label'); if (final) final.hidden = true;
  const sales = document.createElement('div'); sales.id = 'batchSaleFields'; sales.className = 'batch-sale-fields'; sales.innerHTML = '<strong>Цена продажи по позициям</strong>';
  lastCalculation.batchItems.forEach(({ input, calculation }, index) => { const label = document.createElement('label'); label.className = 'purchase-field'; const initialPrice = calculation.rows?.[0]?.total || calculation.best.total || 0; label.innerHTML = `${index + 1}. ${decimal(input.width)}${input.length ? `×${decimal(input.length)}` : ''} мм · ${decimal(input.thickness)} мм · ${input.grade}<input class="batch-sale-price" data-index="${index}" type="text" inputmode="decimal" value="${Math.round(initialPrice)}">`; sales.appendChild(label); });
  meta.after(sales);
  sales.hidden = true;
  const finals = document.createElement('div'); finals.id = 'batchFinalFields'; finals.className = 'batch-final-fields'; finals.innerHTML = '<strong>Итоговая цена по позициям</strong><span>Можно изменить вручную для каждой позиции.</span>';
  const initialDelivery = Math.max(0, numericInputValue($('deliveryCost')?.value)), initialDays = Math.max(0, numericInputValue($('defermentDays')?.value)), initialKeyRate = DEFERMENT_RATE_PERCENT;
  lastCalculation.batchItems.forEach(({ input, calculation }, index) => { const label = document.createElement('label'); label.className = 'purchase-field'; const sale = calculation.rows?.[0]?.total || calculation.best.total || 0, initialFinal = sale + initialDelivery + sale * initialKeyRate / 100 * initialDays / 365; label.innerHTML = `${index + 1}. Итоговая цена, руб/тн<input class="batch-final-price" data-index="${index}" type="text" inputmode="decimal" value="${Math.round(initialFinal)}">`; finals.appendChild(label); });
  meta.after(finals);
  finals.hidden = true;
  [...block.querySelectorAll('.batch-purchase-price'), ...sales.querySelectorAll('.batch-sale-price')].forEach(bindAmountFormatting);
  finals.querySelectorAll('.batch-final-price').forEach(bindAmountFormatting);
  const summary = document.createElement('div'); summary.id = 'batchPurchaseSummary'; summary.className = 'batch-purchase-summary'; sales.after(summary); result.remove();
  $('salePriceOutput')?.closest('div')?.setAttribute('hidden', 'hidden');
  const renderBatchSummary = (rate, keyRate, delivery, days) => {
    const groupPriceInputs = new Map([...block.querySelectorAll('.batch-purchase-price')].map(input => [input.dataset.group, input]));
    summary.innerHTML = lastCalculation.batchItems.map(({ input, calculation, groupKey }, index) => {
      const groupPrice = numericInputValue(groupPriceInputs.get(groupKey)?.value);
      const purchaseRub = groupPrice * rate;
      const volume = input.orderVolume || calculation.orderVolume || calculation.volume || 0;
      const processing = Number(calculation.best?.processing) || 0;
      const scrapCost = purchaseRub * (1 - (calculation.best?.yieldRate || 1)) / Math.max(calculation.best?.yieldRate || 1, 0.000001);
      const salePrice = numericInputValue(sales.querySelector(`[data-index="${index}"]`)?.value);
      const deferment = (salePrice + delivery) * keyRate / 100 * days / 365;
      const calculatedFinalPrice = salePrice + delivery + deferment, finalPrice = lastCalculation.batchFinalPrices?.[index] ?? calculatedFinalPrice;
      return `<section class="batch-price-card"><h4>${index + 1}. ${resultNames[selectedType]} · ${input.grade} · ${decimal(input.thickness)} мм · ${decimal(input.width)}${input.length ? `×${input.length}` : ''} мм · ${surfaceLabelFor(input.surface)}</h4><p>объём ${decimal(volume)} т</p><div><span>Закупка</span><strong>${purchaseRub ? money(purchaseRub) : '—'} руб/т</strong></div><div><span>Переработка</span><strong>${money(processing)} руб/т</strong></div><div><span>Доставка</span><strong>${money(delivery)} руб/т</strong></div><div><span>Отсрочка</span><strong>${money(deferment)} руб/т</strong></div><div><span>Прайс</span><strong>${input.price ? money(input.price) : '—'} руб/т</strong></div><div class="batch-price-total"><span>Итоговая цена</span><input class="batch-card-final-price" data-index="${index}" type="text" inputmode="decimal" value="${finalPrice ? money(finalPrice) : ''}"></div></section>`;
    }).join('');
  };
  const refreshBatchSummary = () => {
    const rate = currentPurchaseRate();
    const keyRate = DEFERMENT_RATE_PERCENT;
    const days = Math.max(0, Number($('defermentDays')?.value) || 0), delivery = Math.max(0, Number($('deliveryCost')?.value) || 0);
    const groupPriceInputs = new Map([...block.querySelectorAll('.batch-purchase-price')].map(input => [input.dataset.group, input]));
    const groupVolumes = new Map(); lastCalculation.batchItems.forEach(item => groupVolumes.set(item.groupKey, (groupVolumes.get(item.groupKey) || 0) + (item.orderVolume || item.calculation.orderVolume || item.calculation.volume)));
    const totalVolume = [...groupVolumes.values()].reduce((sum, value) => sum + value, 0);
    const purchaseRub = totalVolume ? groups.reduce((sum, [key]) => sum + numericInputValue(groupPriceInputs.get(key)?.value) * rate * (groupVolumes.get(key) || 0), 0) / totalVolume : 0;
    const deferment = purchaseRub * keyRate / 100 * days / 365;
    if ($('purchaseRub')) $('purchaseRub').textContent = purchaseRub ? `${money(purchaseRub)} руб/тн` : '—';
    if ($('defermentCost')) $('defermentCost').textContent = `${money(deferment)} руб/тн`;
    if ($('deliveryOutput')) $('deliveryOutput').textContent = `${money(delivery)} руб/тн`;
    if ($('purchaseTotal')) $('purchaseTotal').textContent = purchaseRub ? `${money(purchaseRub + delivery + deferment)} руб/тн` : '—';
    [...sales.querySelectorAll('.batch-sale-price')].forEach((input, index) => { const target = summary.children[index]?.querySelector('strong'); if (target) target.textContent = `${money(numericInputValue(input.value))} руб/т`; });
    renderBatchSummary(rate, keyRate, delivery, days);
  };
  summary.addEventListener('input', event => {
    if (!event.target.classList.contains('batch-card-final-price')) return;
    const index = Number(event.target.dataset.index);
    if (!lastCalculation.batchFinalPrices) lastCalculation.batchFinalPrices = [];
    lastCalculation.batchFinalPrices[index] = numericInputValue(event.target.value);
  });
  summary.addEventListener('blur', event => {
    if (event.target.classList.contains('batch-card-final-price')) formatAmountInput(event.target);
  }, true);
  [...block.querySelectorAll('input'), ...sales.querySelectorAll('input'), ...finals.querySelectorAll('input'), $('deliveryCost'), $('defermentDays'), $('purchaseCurrency')].filter(Boolean).forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', event => { if (event.target.classList.contains('batch-final-price')) event.target.dataset.edited = '1'; refreshBatchSummary(); }));
  $('cbrRate')?.closest('.purchase-rate')?.addEventListener('DOMSubtreeModified', refreshBatchSummary);
  const ratesObserver = new MutationObserver(refreshBatchSummary);
  [$('cbrRate'), $('keyRate')].filter(Boolean).forEach(node => ratesObserver.observe(node, { childList: true, characterData: true, subtree: true }));
  [...document.querySelectorAll('.batch-layout-select')].forEach(select => select.addEventListener('change', () => {
    const index = Number(select.dataset.index), item = lastCalculation.batchItems[index], row = item?.calculation?.rows?.[Number(select.value)];
    if (!item || !row) return;
    item.calculation.best = row;
    const saleInput = sales.querySelector(`[data-index="${index}"]`);
    if (saleInput) { saleInput.value = Math.round(row.total || 0); formatAmountInput(saleInput); saleInput.dispatchEvent(new Event('input', { bubbles: true })); }
    if (lastCalculation.batchFinalPrices) lastCalculation.batchFinalPrices[index] = undefined;
    const finalInput = document.querySelector(`.batch-final-price[data-index="${index}"]`); if (finalInput) { finalInput.dataset.edited = '0'; finalInput.value = Math.round((row.total || 0) + (numericInputValue($('deliveryCost')?.value)) + (row.total || 0) * (numericInputValue($('defermentDays')?.value)) * (DEFERMENT_RATE_PERCENT) / 100 / 365); formatAmountInput(finalInput); }
    refreshBatchSummary();
  }));
  refreshBatchSummary();
}
const bindPurchaseExcelExportBase5 = bindPurchaseExcelExport;
bindPurchaseExcelExport = function() { bindPurchaseExcelExportBase5(); if (lastCalculation?.batch) { setTimeout(setupBatchPurchaseWindow, 0); setTimeout(setupBatchPurchaseWindow, 80); } };

// Марка стали выбирается на втором этапе и используется как значение по умолчанию в окне закупки.
const materialGrade = $('materialGrade');
if (materialGrade && typeof STEEL_GRADES !== 'undefined') {
  materialGrade.innerHTML = STEEL_GRADES.map(grade => `<option value="${grade}">${grade}</option>`).join('');
}
new MutationObserver(() => {
  const mainGrade = $('materialGrade'), purchaseGrade = $('steelGrade');
  if (lastCalculation?.batch && $('purchaseModal')) {
    const title = $('purchaseTitle');
    if (title && title.dataset.batchTitle !== '1') { title.replaceChildren(document.createTextNode('Расчёт цены')); title.dataset.batchTitle = '1'; }
    purchaseGrade?.closest('label')?.setAttribute('hidden', 'hidden');
    $('purchasePrice')?.closest('label')?.setAttribute('hidden', 'hidden');
    $('salePrice')?.closest('label')?.setAttribute('hidden', 'hidden');
  }
  if (mainGrade && purchaseGrade && !purchaseGrade.dataset.stageTwoSynced) {
    purchaseGrade.value = mainGrade.value;
    purchaseGrade.dataset.stageTwoSynced = '1';
  }
}).observe(document.body, { childList: true });
function applyTypeStartDefaults(type) {
  if ($('thickness')) $('thickness').value = '1.0';
  if ($('productWidth')) $('productWidth').value = '1250';
  if ($('productLength')) $('productLength').value = '2500';
  if ($('quantity')) $('quantity').value = '1';
  if ($('materialCost')) $('materialCost').value = '0';
  if ($('price')) $('price').value = '0';
  setType(type);
}
if (!localStorage.getItem('metal-cutter-values')) applyTypeStartDefaults(selectedType);
document.querySelectorAll('.type-card').forEach(card => card.addEventListener('click', () => applyTypeStartDefaults(card.dataset.type)));
['materialCost', 'price', 'purchasePrice'].forEach(id => {
  const input = $(id);
  if (input) input.addEventListener('focus', () => { if (numericInputValue(input.value) === 0) input.value = ''; });
});
new MutationObserver(() => {
  const input = $('purchasePrice');
  if (input && input.dataset.zeroFocusBound !== '1') {
    input.dataset.zeroFocusBound = '1';
    input.addEventListener('focus', () => { if (numericInputValue(input.value) === 0) input.value = ''; });
  }
}).observe(document.body, { childList: true, subtree: true });
function syncBatchLengthFields() {
  const rows = document.querySelectorAll('#batchPositions .batch-row');
  const needsLength = selectedType === 'sheet' || selectedType === 'card';
  rows.forEach(row => {
    const existing = row.querySelector('.batch-length');
    if (needsLength && !existing) {
      const widthLabel = row.querySelector('.batch-width')?.closest('label');
      if (widthLabel) widthLabel.insertAdjacentHTML('afterend', '<label>Длина, мм<input class="batch-length" type="number" min="1" step="1" value="2500" placeholder="Длина"></label>');
    }
    if (!needsLength && existing) existing.closest('label')?.remove();
  });
}
syncBatchLengthFields();
document.querySelectorAll('.type-card').forEach(card => card.addEventListener('click', () => setTimeout(syncBatchLengthFields, 0)));
const updateStripSizeControlBase = updateStripSizeControl;
updateStripSizeControl = function () {
  updateStripSizeControlBase();
  if (selectedType === 'strip') {
    const toggle = document.querySelector('#batchModeToggle');
    const mode = document.querySelector('input[name="stripSizeMode"]:checked')?.value || 'single';
    if (toggle) toggle.checked = mode === 'multiple';
  }
};
  function refreshTypeSpecificFields() {
  const hideLength = selectedType === 'strip' || selectedType === 'rewind';
  const lengthField = document.querySelector('.length-field');
  if (lengthField) { lengthField.hidden = hideLength; lengthField.style.display = hideLength ? 'none' : ''; }
  const batchToggle = document.querySelector('.batch-toggle');
  if (batchToggle) {
    batchToggle.hidden = false;
    batchToggle.style.display = '';
    if (batchToggle.dataset.stripModeBound !== '1') {
      batchToggle.dataset.stripModeBound = '1';
      batchToggle.querySelector('input')?.addEventListener('change', event => {
        if (selectedType !== 'strip') return;
        event.stopImmediatePropagation();
        const mode = batchToggle.querySelector('input')?.checked ? 'multiple' : 'single';
        const modeInput = document.querySelector(`input[name="stripSizeMode"][value="${mode}"]`);
        if (modeInput) modeInput.checked = true;
        updateStripSizeControl();
      }, true);
    }
  }
  }
  $('calculateButton').addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (batchMode && batchSupported()) {
      if (calculateBatch()) showStep(3);
      return;
    }
    calculate();
    if (!$('error').hidden) return;
    if (getRadio('unit') === 'pieces' && (selectedType === 'sheet' || selectedType === 'card')) $('resultCaption').innerHTML += ` · количество ${decimal(Number($('quantity').value) || 0)} шт`;
    showStep(3);
  }, true);
  refreshTypeSpecificFields();
document.querySelectorAll('.type-card').forEach(card => card.addEventListener('click', () => setTimeout(refreshTypeSpecificFields, 0)));
const serviceDataWithIntegratedFilm = serviceData;
serviceData = function (...args) {
  const result = serviceDataWithIntegratedFilm(...args);
  if (selectedType === 'rewind' && getRadio('surface') === '4n' && result?.operations) {
    const rewind = result.operations.find(operation => operation.name === '2. Перемотка рулона');
    if (rewind) {
      result.operations = result.operations.filter(operation => operation !== rewind);
      result.processing = Math.max(0, result.processing - rewind.price);
      result.cutting = Math.max(0, result.cutting - rewind.price);
      result.firstCut = Math.max(0, result.firstCut - rewind.price);
      result.total = Math.max(0, result.total - rewind.price);
    }
  }
  return result;
};
function placeStripSizeMode() {
  const mode = document.querySelector('.strip-size-mode'), fieldGrid = document.querySelector('#paramsStep .field-grid');
  if (!mode || !fieldGrid || mode.parentElement === fieldGrid.parentElement) return;
  fieldGrid.before(mode);
  mode.classList.add('standalone-strip-size-mode');
}
placeStripSizeMode();
new MutationObserver(placeStripSizeMode).observe(document.body, { childList: true, subtree: true });
const surfaceField = document.querySelector('#paramsStep .surface-field');
if (surfaceField && !surfaceField.querySelector('#surfaceSelect')) {
  const currentSurface = document.querySelector('input[name="surface"]:checked')?.value || '2b';
  surfaceField.insertAdjacentHTML('afterbegin', '<select id="surfaceSelect" aria-label="Поверхность"><option value="2b">2B</option><option value="1d">1D</option><option value="ba">BA</option><option value="m2b">М2Б</option><option value="4n">Шлифовка</option></select>');
  const surfaceSelect = surfaceField.querySelector('#surfaceSelect');
  surfaceSelect.value = currentSurface;
  surfaceSelect.addEventListener('change', () => document.querySelector(`input[name="surface"][value="${surfaceSelect.value}"]`)?.click());
  surfaceField.querySelectorAll('label.radio').forEach(label => { label.hidden = true; label.style.display = 'none'; });
}
