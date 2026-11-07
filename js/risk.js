// 下跌預警 2.0 風險引擎(六因子)
// 這個檔案由 index.html 載入。修改後到 GitHub 直接 Commit 即可。

// ═══════════════════════════════════════════════════════════════
// 台股下跌預警系統 2.0:六因子風險引擎(F1~F6,總分 0~100)
// R = Σ w_k·F_k,另算大盤系統風險 M(不重複計入個股總分以外)
// ═══════════════════════════════════════════════════════════════
const RISK_W = {F1:.20, F2:.15, F3:.20, F4:.15, F5:.15, F6:.15};
const RISK_NAMES = {F1:'趨勢破壞', F2:'動能衰竭', F3:'量價異常', F4:'波動與尾端', F5:'市場與籌碼', F6:'流動性與事件'};
const RISK_LV = [
  {min:80, name:'極高風險', cls:'rk5', act:'可能趨勢反轉,執行風控'},
  {min:60, name:'高風險',   cls:'rk4', act:'風險訊號密集,重新評估部位'},
  {min:40, name:'警戒',     cls:'rk3', act:'多項風險轉弱,檢查部位'},
  {min:20, name:'留意',     cls:'rk2', act:'出現部分弱化訊號'},
  {min:0,  name:'低風險',   cls:'rk1', act:'正常,持續觀察'},
];
function riskLevel(score){ return RISK_LV.find(l => score >= l.min); }

const _rkSma = (a, n, i) => { if(i < n-1 || i >= a.length) return null; let s = 0; for(let j=i-n+1; j<=i; j++) s += a[j]; return s/n; };
const _rkEma = (a, n) => { const k = 2/(n+1), o = []; a.forEach((v,i) => o.push(i ? v*k + o[i-1]*(1-k) : v)); return o; };
const _rkMax = a => Math.max(...a), _rkMin = a => Math.min(...a);
const _rkMean = a => a.reduce((x,y)=>x+y,0) / (a.length||1);
const _rkSd = a => { const m = _rkMean(a); return Math.sqrt(_rkMean(a.map(x => (x-m)*(x-m)))); };
const _rkMedian = a => { const b = [...a].sort((x,y)=>x-y), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m-1]+b[m])/2) : 0; };

// 每檔 OHLC 預先計算指標序列(快取)
const _rkPrepCache = {};
function riskPrep(code){
  const cd = OHLC[code];
  if(!cd || cd.length < 30) return null;
  const hit = _rkPrepCache[code];
  if(hit && hit.ref === cd && hit.n === cd.length) return hit.P;
  const C = cd.map(x=>x.close), H = cd.map(x=>x.high), L = cd.map(x=>x.low), O = cd.map(x=>x.open), V = cd.map(x=>x.vol||0);
  const e12 = _rkEma(C,12), e26 = _rkEma(C,26);
  const dif = C.map((_,i) => e12[i]-e26[i]), dea = _rkEma(dif,9), hist = dif.map((v,i) => v-dea[i]);
  // RSI(14) Wilder
  const rsi = new Array(C.length).fill(null); let g=0, l=0;
  for(let i=1; i<C.length; i++){
    const d = C[i]-C[i-1], up = Math.max(d,0), dn = Math.max(-d,0);
    if(i <= 14){ g += up; l += dn; if(i === 14){ g/=14; l/=14; rsi[i] = l===0 ? 100 : 100-100/(1+g/l); } }
    else { g = (g*13+up)/14; l = (l*13+dn)/14; rsi[i] = l===0 ? 100 : 100-100/(1+g/l); }
  }
  // KD(9)
  const K = [], D = [];
  for(let i=0; i<C.length; i++){
    const lo = _rkMin(L.slice(Math.max(0,i-8), i+1)), hi = _rkMax(H.slice(Math.max(0,i-8), i+1));
    const rsv = hi > lo ? (C[i]-lo)/(hi-lo)*100 : 50;
    K.push(i ? K[i-1]*2/3 + rsv/3 : 50); D.push(i ? D[i-1]*2/3 + K[i]/3 : 50);
  }
  // OBV、真實波幅
  const obv = [0], tr = [H[0]-L[0]];
  for(let i=1; i<C.length; i++){
    obv.push(obv[i-1] + (C[i]>C[i-1] ? V[i] : C[i]<C[i-1] ? -V[i] : 0));
    tr.push(Math.max(H[i]-L[i], Math.abs(H[i]-C[i-1]), Math.abs(L[i]-C[i-1])));
  }
  const P = {cd, C, H, L, O, V, dif, dea, hist, rsi, K, D, obv, tr};
  _rkPrepCache[code] = {ref:cd, n:cd.length, P};
  return P;
}

// F1~F4:純技術面(可對歷史任一天 e 計算,供回測使用)
function riskTech(P, e){
  const s = {F1:0, F2:0, F3:0, F4:0}, hits = [];
  const add = (f, pts, txt) => { s[f] += pts; hits.push({f, pts, txt}); };
  const C = P.C, c = C[e];

  // F1 趨勢破壞
  const ma20 = _rkSma(C,20,e), ma60 = _rkSma(C,60,e), ma20p = _rkSma(C,20,e-5);
  if(ma20 && c < ma20) add('F1', 30, '收盤跌破月線(MA20)');
  if(ma60 && c < ma60) add('F1', 25, '收盤跌破季線(MA60)');
  if(ma20 && ma20p && ma20 < ma20p) add('F1', 20, '月線斜率由正轉負');
  if(ma20 && ma60 && ma20 < ma60) add('F1', 10, '月線位於季線之下');
  if(c < _rkMin(P.L.slice(e-20, e))) add('F1', 15, '跌破近 20 日支撐');

  // F2 動能衰竭
  const winMax = _rkMax(C.slice(e-19, e+1));
  if(_rkMax(C.slice(e-4, e+1)) >= winMax){
    const prevR = P.rsi.slice(e-19, e-4).filter(x => x != null), nowR = _rkMax(P.rsi.slice(e-4, e+1).filter(x => x != null));
    if(prevR.length && _rkMax(prevR) > 60 && nowR < _rkMax(prevR) - 5) add('F2', 30, 'RSI 頂背離');
  }
  const h = P.hist;
  if(h[e] > 0 && h[e] < h[e-1] && h[e-1] < h[e-2]) add('F2', 20, 'MACD 紅柱連續縮短');
  else if(h[e] < 0 && h[e] < h[e-1]) add('F2', 15, 'MACD 綠柱擴大');
  if(P.dif[e] < P.dea[e] && P.dif[e-3] >= P.dea[e-3]) add('F2', 20, 'DIF 下穿訊號線');
  const roc = (c/C[e-10]-1)*100;
  if(roc < 0) add('F2', 15, `10 日 ROC 轉負(${roc.toFixed(1)}%)`);
  if(P.K[e] < P.D[e] && P.K[e-1] >= P.D[e-1] && P.K[e-1] > 70) add('F2', 20, '高檔 KD 死叉');

  // F3 量價異常
  const V = P.V, vma = _rkMean(V.slice(e-20, e));
  const rg = P.H[e]-P.L[e], pos = rg > 0 ? (c-P.L[e])/rg : .5;
  if(vma && V[e] > 2*vma && pos < .3 && c < P.O[e]) add('F3', 35, '爆量長黑、收在低檔');
  else if(vma && V[e] > 2*vma && c < C[e-1]) add('F3', 20, '爆量下跌');
  if(c >= _rkMax(C.slice(e-19, e)) && P.obv[e] < _rkMax(P.obv.slice(e-19, e))) add('F3', 25, '股價創高但 OBV 未創高');
  let upV=0, upN=0, dnV=0, dnN=0;
  for(let i=e-9; i<=e; i++){ if(C[i] > C[i-1]){ upV += V[i]; upN++; } else if(C[i] < C[i-1]){ dnV += V[i]; dnN++; } }
  if(upN && dnN && dnV/dnN > 1.3*upV/upN) add('F3', 25, '上漲量縮、下跌量增');
  const vsd = _rkSd(V.slice(e-20, e));
  if(vsd > 0 && (V[e]-vma)/vsd > 3) add('F3', 15, '成交量極端異常');

  // F4 波動與尾端風險
  const atrPct = i => _rkMean(P.tr.slice(i-13, i+1)) / C[i];
  if(e-20 >= 14 && atrPct(e) > 1.3*atrPct(e-20)) add('F4', 30, 'ATR/股價 明顯上升');
  const rets = []; for(let i=e-19; i<=e; i++) rets.push(C[i]/C[i-1]-1);
  const vol = _rkSd(rets)*Math.sqrt(250)*100;
  if(vol > 60) add('F4', 25, `20 日年化波動 ${vol.toFixed(0)}%`);
  else if(vol > 40) add('F4', 15, `20 日年化波動 ${vol.toFixed(0)}%`);
  const r5 = (c/C[e-5]-1)*100;
  if(r5 < -8) add('F4', 25, `5 日跌幅 ${r5.toFixed(1)}%`);
  const dd = (c/winMax-1)*100;
  if(dd < -15) add('F4', 20, `距 20 日高點回落 ${dd.toFixed(1)}%`);
  const neg = rets.filter(x => x < 0), sq = a => a.reduce((x,y)=>x+y*y, 0), tot = sq(rets);
  if(tot > 0 && sq(neg)/tot > .65) add('F4', 15, '下行波動占比偏高');

  Object.keys(s).forEach(k => s[k] = Math.min(100, s[k]));
  return {s, hits};
}

// 大盤與產業背景(3 秒快取)
let _rkCtx = null, _rkCtxT = 0;
function riskCtx(){
  if(_rkCtx && Date.now()-_rkCtxT < 3000) return _rkCtx;
  let up=0, dn=0, below=0, withMA=0;
  const ind = {};
  STOCKS.forEach(s => {
    const p = PD[s.code], P = riskPrep(s.code);
    const g = ind[s.ind] = ind[s.ind] || {chg:[], below:0, n:0, r20:[]};
    if(p){ if(p.chgPct > 0) up++; else if(p.chgPct < 0) dn++; g.chg.push(p.chgPct); }
    if(P){
      const e = P.C.length-1, ma = _rkSma(P.C,20,e);
      if(ma){ withMA++; g.n++; if(P.C[e] < ma){ below++; g.below++; } }
      g.r20.push((P.C[e]/P.C[e-20]-1)*100);
    }
  });
  const dnRatio = (up+dn) ? dn/(up+dn) : 0, belowRatio = withMA ? below/withMA : 0;
  const clamp = v => Math.max(0, Math.min(100, v));
  const M = Math.round(clamp((dnRatio-.4)/.4*50) + clamp((belowRatio-.4)/.4*50));
  const indStat = {};
  Object.entries(ind).forEach(([k,g]) => indStat[k] = {
    chgMed: g.chg.length ? _rkMedian(g.chg) : 0,
    belowRatio: g.n ? g.below/g.n : 0,
    r20Med: g.r20.length ? _rkMedian(g.r20) : 0,
  });
  _rkCtx = {dnRatio, belowRatio, M, indStat, up, dn};
  _rkCtxT = Date.now();
  return _rkCtx;
}

// 個股完整風險(F1~F6)
function calcRisk(code){
  const P = riskPrep(code);
  if(!P) return null;
  const s = STOCKS.find(x => x.code === code);
  const e = P.C.length-1;
  const t = riskTech(P, e);
  const F = {...t.s, F5:0, F6:0}, hits = [...t.hits];
  const add = (f, pts, txt) => { F[f] += pts; hits.push({f, pts, txt}); };

  // F5 市場與籌碼
  const ctx = riskCtx(), is = ctx.indStat[s?.ind] || {};
  if(ctx.dnRatio > .6) add('F5', 20, `大盤寬度惡化(下跌家數 ${(ctx.dnRatio*100).toFixed(0)}%)`);
  if(ctx.belowRatio > .6) add('F5', 15, `多數個股跌破月線(${(ctx.belowRatio*100).toFixed(0)}%)`);
  if(is.chgMed < -1) add('F5', 20, `${s.ind} 產業同步走弱(中位數 ${is.chgMed.toFixed(1)}%)`);
  if(is.belowRatio > .6) add('F5', 15, `${s.ind} 產業過半跌破月線`);
  const r20 = (P.C[e]/P.C[e-20]-1)*100;
  if(is.r20Med != null && r20 - is.r20Med < -10) add('F5', 15, `20 日報酬落後產業 ${(r20-is.r20Med).toFixed(1)}%`);
  const ch = (typeof chipData !== 'undefined') ? chipData[code] : null;
  if(ch){
    if(ch.foreign < 0 && ch.trust < 0) add('F5', 25, '外資、投信同步賣超');
    else if(ch.total < 0) add('F5', 10, '三大法人合計賣超');
  }

  // F6 流動性與事件
  const avgV = _rkMean(P.V.slice(-20));
  if(avgV < 300) add('F6', 30, `流動性不足(日均 ${Math.round(avgV)} 張)`);
  else if(avgV < 1000) add('F6', 15, `成交偏淡(日均 ${Math.round(avgV)} 張)`);
  const avgRg = _rkMean(P.H.slice(-20).map((h,i) => (h - P.L.slice(-20)[i]) / P.C.slice(-20)[i]));
  if(avgRg > .06) add('F6', 15, `日內振幅偏大(均 ${(avgRg*100).toFixed(1)}%)`);
  if(typeof DISP !== 'undefined' && DISP.has(code)) add('F6', 40, '處置股');
  const ei = (typeof epsInfo === 'function') ? epsInfo(code) : null;
  if(ei){
    if(ei.drop) add('F6', 25, 'EPS 衰退');
    if(ei.latest < 0) add('F6', 15, '最新一季虧損');
  }
  const rv = (typeof revenueData !== 'undefined') ? revenueData[code] : null;
  if(rv && rv.yoy != null && rv.yoy < -20) add('F6', 20, `月營收年減 ${rv.yoy.toFixed(1)}%`);

  Object.keys(F).forEach(k => F[k] = Math.min(100, F[k]));
  const score = Math.round(Object.keys(RISK_W).reduce((a,k) => a + RISK_W[k]*F[k], 0));
  const techScore = Math.round((F.F1*RISK_W.F1 + F.F2*RISK_W.F2 + F.F3*RISK_W.F3 + F.F4*RISK_W.F4) / .7);
  hits.forEach(h => h.w = h.pts*RISK_W[h.f]);
  hits.sort((a,b) => b.w - a.w);
  return {
    score, F, hits, techScore, level: riskLevel(score), date: P.cd[e].date,
    data: { tech:true, chip:!!ch, eps:!!ei, rev:!!rv },
  };
}

// 歷史回測:以技術分數(F1~F4)分級,統計未來 5/10/20 日內曾跌 ≥5% 的比例
let _rkCal = null, _rkCalKey = '';
function riskCalibrate(){
  const key = Object.keys(OHLC).length + ':' + Object.values(OHLC).reduce((a,c) => a+(c?.length||0), 0);
  if(_rkCal && _rkCalKey === key) return _rkCal;
  const HZ = [5,10,20], mk = () => ({n:0, hit:0});
  const by = {}, all = {};
  RISK_LV.forEach(l => { by[l.name] = {}; HZ.forEach(h => by[l.name][h] = mk()); });
  HZ.forEach(h => all[h] = mk());
  Object.keys(OHLC).forEach(code => {
    const P = riskPrep(code);
    if(!P) return;
    const n = P.C.length;
    for(let e=29; e<n-5; e++){
      const t = riskTech(P, e).s;
      const ts = (t.F1*.20 + t.F2*.15 + t.F3*.20 + t.F4*.15) / .7;
      const lv = riskLevel(ts).name;
      HZ.forEach(h => {
        if(e+h >= n) return;
        const fall = _rkMin(P.C.slice(e+1, e+h+1)) / P.C[e] - 1 <= -.05;
        by[lv][h].n++; all[h].n++;
        if(fall){ by[lv][h].hit++; all[h].hit++; }
      });
    }
  });
  _rkCal = {by, all, HZ};
  _rkCalKey = key;
  return _rkCal;
}

// ── 表格徽章 ──
function riskCell(code){
  const r = calcRisk(code);
  if(!r) return '<span style="color:#cbd5e0">—</span>';
  const top = r.hits.slice(0,3).map(h => h.txt).join('、') || '無明顯風險訊號';
  return `<span class="rk-badge ${r.level.cls}" title="${top}">${r.score} ${r.level.name}</span>`;
}

// ── 市場總覽上方的風險摘要列 ──
function renderRiskBar(){
  const el = document.getElementById('riskBar');
  if(!el) return;
  const ctx = riskCtx();
  const cnt = {}; RISK_LV.forEach(l => cnt[l.name] = 0);
  let n = 0;
  STOCKS.forEach(s => { const r = calcRisk(s.code); if(r){ cnt[r.level.name]++; n++; } });
  if(!n){ el.innerHTML = '<span class="rk-bar-note">風險分數計算中(需等技術指標歷史載入)…</span>'; return; }
  const mLv = riskLevel(ctx.M);
  const cur = document.getElementById('riskSel')?.value || '';
  el.innerHTML = `
    <span class="rk-bar-m">大盤系統風險 <span class="rk-badge ${mLv.cls}">${ctx.M} ${mLv.name}</span></span>
    <span class="rk-bar-note">下跌家數 ${(ctx.dnRatio*100).toFixed(0)}% · 跌破月線 ${(ctx.belowRatio*100).toFixed(0)}%</span>
    <span class="rk-bar-chips">${[...RISK_LV].reverse().map(l => `<button class="rk-chip ${l.cls} ${cur===String(l.min)?'on':''}" onclick="setRiskFilter('${l.min}')">${l.name} ${cnt[l.name]}</button>`).join('')}</span>`;
}
function setRiskFilter(min){
  const sel = document.getElementById('riskSel');
  sel.value = (sel.value === String(min)) ? '' : String(min);
  curPage = 1; applyFilt();
}

// ── 深度分析面板 ──
function riskGaugeSVG(score){
  const cx = 110, cy = 100, r = 78;
  const pt = (v, rr) => { const a = Math.PI*(1 - v/100); return [cx + rr*Math.cos(a), cy - rr*Math.sin(a)]; };
  const cols = ['#16a34a','#ca8a04','#ea580c','#dc2626','#991b1b'];
  const segs = [0,20,40,60,80].map((a,i) => {
    const [x1,y1] = pt(a+.6, r), [x2,y2] = pt(a+19.4, r);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${cols[i]}" stroke-width="14" fill="none"/>`;
  }).join('');
  const [nx,ny] = pt(score, r-22);
  const ticks = [0,20,40,60,80,100].map(v => { const [x,y] = pt(v, r+16); return `<text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="middle" class="rk-g-tick">${v}</text>`; }).join('');
  return `<svg viewBox="0 0 220 122" class="rk-gauge" role="img" aria-label="風險分數 ${score}">
    ${segs}${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="rk-g-needle" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="5" class="rk-g-hub"/>
  </svg>`;
}
function renderDashRisk(code){
  const el = document.getElementById('dash-risk');
  if(!el) return;
  const r = calcRisk(code);
  if(!r){ el.innerHTML = '<div class="rk-empty">需要至少 30 日 K 線歷史才能計算風險分數,請稍候技術指標載入後再開啟。</div>'; return; }
  const ctx = riskCtx(), mLv = riskLevel(ctx.M);
  const factors = Object.keys(RISK_NAMES).map(k => {
    const v = r.F[k], lv = riskLevel(v);
    return `<div class="rk-f">
      <span class="rk-f-name">${k} ${RISK_NAMES[k]}<small>${Math.round(RISK_W[k]*100)}%</small></span>
      <span class="rk-f-track"><span class="rk-f-bar ${lv.cls}" style="width:${Math.max(2,v)}%"></span></span>
      <span class="rk-f-val">${v}</span>
    </div>`;
  }).join('');
  const hits = r.hits.length
    ? r.hits.slice(0,6).map(h => `<li><span class="rk-tag">${h.f}</span>${h.txt}<span class="rk-pts">+${h.w.toFixed(1)}</span></li>`).join('')
    : '<li>目前無明顯風險訊號</li>';
  const cal = riskCalibrate(), tLv = riskLevel(r.techScore), row = cal.by[tLv.name];
  const pct = o => o.n >= 30 ? (o.hit/o.n*100).toFixed(0)+'%' : '<span style="opacity:.6">樣本不足</span>';
  const calRows = cal.HZ.map(h => `<tr><td>${h} 日內</td><td><b>${pct(row[h])}</b></td><td>${pct(cal.all[h])}</td><td>${row[h].n}</td></tr>`).join('');
  const ok = v => v ? '✓' : '✗';
  el.innerHTML = `
    <div class="rk-top">
      <div class="rk-gauge-box">
        ${riskGaugeSVG(r.score)}
        <div class="rk-score">${r.score}<small>/100</small></div>
        <div class="rk-badge ${r.level.cls} rk-lv">${r.level.name}</div>
        <div class="rk-act">${r.level.act}</div>
      </div>
      <div class="rk-factors">${factors}</div>
    </div>
    <div class="rk-cols">
      <div>
        <div class="rk-sub">主要觸發原因(依對總分貢獻排序)</div>
        <ul class="rk-hits">${hits}</ul>
      </div>
      <div>
        <div class="rk-sub">歷史回測:技術分數同為「${tLv.name}」時,未來曾下跌 ≥5% 的比例</div>
        <table class="rk-cal"><thead><tr><th>期間</th><th>同等級</th><th>全體基準</th><th>樣本數</th></tr></thead><tbody>${calRows}</tbody></table>
        <div class="rk-note">大盤系統風險 ${ctx.M}(${mLv.name}) · 資料:技術 ${ok(r.data.tech)} 籌碼 ${ok(r.data.chip)} EPS ${ok(r.data.eps)} 營收 ${ok(r.data.rev)} · 資料日 ${r.date}</div>
        <div class="rk-note">回測只用本站追蹤股近幾個月的 K 線,樣本有限,用來看「這個等級過去準不準」,不是預測。籌碼未載入時 F5 只計大盤與產業。</div>
      </div>
    </div>`;
}
function riskPromptText(code){
  const r = calcRisk(code);
  if(!r) return '資料不足,未計算';
  return `總分 ${r.score}/100(${r.level.name})| ` +
    Object.keys(RISK_NAMES).map(k => `${RISK_NAMES[k]} ${r.F[k]}`).join(' / ') +
    ` | 主要原因:${r.hits.slice(0,4).map(h => h.txt).join('、') || '無'}`;
}
