export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type, code, ym, date, codes } = req.query;

  const now = new Date();
  const twDate = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  // ── 盤中即時報價 ─────────────────────────────────────────────
  if (type === 'realtime') {
    try {
      const codeList = (codes || '').split(',').filter(Boolean);
      if (!codeList.length) return res.status(400).json({ error: 'no codes' });

      // 分離上市/上櫃代號
      const tseList = codeList.filter(c => c.startsWith('tse_')).map(c => c.replace('tse_','').replace('.tw',''));
      const otcList = codeList.filter(c => c.startsWith('otc_')).map(c => c.replace('otc_','').replace('.tw',''));

      const result = [];

      // 上市：用 TWSE MIS getStockInfo (多試幾個 Referer)
      if (tseList.length > 0) {
        // 分批，每批最多20檔避免 URL 過長
        for (let i = 0; i < tseList.length; i += 20) {
          const batch = tseList.slice(i, i + 20);
          const exCh = batch.map(c => `tse_${c}.tw`).join('|');
          const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0&_=${Date.now()}`;
          try {
            const r = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://mis.twse.com.tw/',
                'Accept': '*/*',
                'Origin': 'https://mis.twse.com.tw',
              }
            });
            if (r.ok) {
              const data = await r.json();
              (data.msgArray || []).forEach(s => {
                const close  = parseFloat(s.z !== '-' ? s.z : s.y) || 0;
                const prev   = parseFloat(s.y) || 0;
                const chg    = Math.round((close - prev) * 100) / 100;
                const chgPct = prev ? Math.round(chg / prev * 10000) / 100 : 0;
                result.push({
                  code: s.c, name: s.n, close, prev, chg, chgPct,
                  open: parseFloat(s.o)||0, high: parseFloat(s.h)||0, low: parseFloat(s.l)||0,
                  vol: parseInt(s.v)||0, time: s.t||'', isRT: true,
                });
              });
            }
          } catch(e) { /* 批次失敗繼續 */ }
          await new Promise(r => setTimeout(r, 200)); // 避免過快
        }
      }

      // 上櫃：TPEx 即時
      if (otcList.length > 0) {
        for (let i = 0; i < otcList.length; i += 20) {
          const batch = otcList.slice(i, i + 20);
          const exCh = batch.map(c => `otc_${c}.tw`).join('|');
          const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0&_=${Date.now()}`;
          try {
            const r = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://mis.twse.com.tw/',
                'Accept': '*/*',
              }
            });
            if (r.ok) {
              const data = await r.json();
              (data.msgArray || []).forEach(s => {
                const close  = parseFloat(s.z !== '-' ? s.z : s.y) || 0;
                const prev   = parseFloat(s.y) || 0;
                const chg    = Math.round((close - prev) * 100) / 100;
                const chgPct = prev ? Math.round(chg / prev * 10000) / 100 : 0;
                result.push({
                  code: s.c, name: s.n, close, prev, chg, chgPct,
                  open: parseFloat(s.o)||0, high: parseFloat(s.h)||0, low: parseFloat(s.l)||0,
                  vol: parseInt(s.v)||0, time: s.t||'', isRT: true,
                });
              });
            }
          } catch(e) { /* 繼續 */ }
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (result.length === 0) throw new Error('無即時資料，可能非交易時間');

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ stocks: result, ts: Date.now() });
    } catch(e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── 處置股 ───────────────────────────────────────────────────
  if (type === 'disposition') {
    try {
      const results = [];
      const r1 = await fetch('https://www.twse.com.tw/announcement/punish?response=html', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
          'Accept': 'text/html,application/xhtml+xml,application/xml',
          'Referer': 'https://www.twse.com.tw/zh/announcement/punish.html',
        }
      });
      if (r1.ok) {
        const html = await r1.text();
        const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        rows.forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
            .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').trim());
          if (cells.length >= 7) {
            const rawCode = cells[2]?.trim();
            const code = rawCode?.match(/^\d{4,5}$/)?.[0];
            if (code) {
              const rocToAD = (rocDate) => {
                const m = rocDate.match(/(\d+)\/(\d+)\/(\d+)/);
                if (!m) return rocDate;
                return `${parseInt(m[1])+1911}/${m[2]}/${m[3]}`;
              };
              const dateRange = cells[6] || '';
              const parts = dateRange.split(/[～~]/);
              results.push({
                code, name: cells[3] || '',
                startDate: rocToAD(parts[0]?.trim() || ''),
                endDate:   rocToAD(parts[1]?.trim() || ''),
                market: 'tse'
              });
            }
          }
        });
      }
      const r2 = await fetch('https://www.tpex.org.tw/web/bulletin/disposal_information/disposal_information.php?l=zh-tw', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://www.tpex.org.tw/',
        }
      });
      if (r2.ok) {
        const html = await r2.text();
        const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        rows.forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
            .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').trim());
          if (cells.length >= 5) {
            const rawCode = cells[1]?.trim() || cells[0]?.trim();
            const code = rawCode?.match(/^\d{4,5}$/)?.[0];
            if (code) {
              const rocToAD = (rocDate) => {
                const m = rocDate.match(/(\d+)\/(\d+)\/(\d+)/);
                if (!m) return rocDate;
                return `${parseInt(m[1])+1911}/${m[2]}/${m[3]}`;
              };
              const dateCell = cells.find(c => c.includes('/') && c.includes('～')) || '';
              const parts = dateCell.split(/[～~]/);
              results.push({
                code, name: cells[2] || cells[1] || '',
                startDate: rocToAD(parts[0]?.trim() || ''),
                endDate:   rocToAD(parts[1]?.trim() || ''),
                market: 'otc'
              });
            }
          }
        });
      }
      const seen = new Set();
      const unique = results.filter(r => { if(seen.has(r.code)) return false; seen.add(r.code); return true; });
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json({ stocks: unique, count: unique.length });
    } catch(e) {
      return res.status(502).json({ error: e.message, stocks: [] });
    }
  }

  // ── 其他端點 ─────────────────────────────────────────────────
  const targets = {
    tse:         'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    otc:         'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    tse_day:     `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym||twDate}&stockNo=${code}&response=json`,
    revenue_tse: `https://www.twse.com.tw/rwd/zh/cgData/t21sc04?date=${date||twDate}&response=json`,
    chip_tse:    `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date||twDate}&selectType=ALL&response=json`,
    chip_otc:    `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_3major_investors_daily`,
  };
  const referers = {
    tse: 'https://www.twse.com.tw/', otc: 'https://www.tpex.org.tw/',
    tse_day: 'https://www.twse.com.tw/', revenue_tse: 'https://www.twse.com.tw/',
    chip_tse: 'https://www.twse.com.tw/', chip_otc: 'https://www.tpex.org.tw/',
  };
  const url = targets[type];
  if (!url) return res.status(400).json({ error: 'invalid type' });
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
        'Referer': referers[type] || 'https://www.twse.com.tw/',
      }
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch(e) {
    return res.status(502).json({ error: e.message });
  }
}

  const now = new Date();
  const twDate = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  // 處置股：抓 TWSE HTML 公告頁面解析
  if (type === 'disposition') {
    try {
      const results = [];

      // 上市處置股 - 正確端點
      const r1 = await fetch('https://www.twse.com.tw/announcement/punish?response=html', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
          'Accept': 'text/html,application/xhtml+xml,application/xml',
          'Referer': 'https://www.twse.com.tw/zh/announcement/punish.html',
        }
      });
      if (r1.ok) {
        const html = await r1.text();
        // 解析 <tr> rows，每行有10欄：編號|公布日期|證券代號|證券名稱|累計|處置條件|處置起迄時間|處置措施|處置內容|備註
        const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        rows.forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
            .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').trim());
          // 代號在第3格(index 2)，名稱第4格(index 3)，起迄時間第7格(index 6)
          if (cells.length >= 7) {
            const rawCode = cells[2]?.trim();
            const code = rawCode?.match(/^\d{4,6}$/)?.[0];
            if (code && code.length <= 5) { // 排除ETF代號過長
              const dateRange = cells[6] || '';
              // 格式: 115/04/15～115/04/28 → 轉換為西元
              const rocToAD = (rocDate) => {
                const m = rocDate.match(/(\d+)\/(\d+)\/(\d+)/);
                if (!m) return rocDate;
                return `${parseInt(m[1])+1911}/${m[2]}/${m[3]}`;
              };
              const parts = dateRange.split(/[～~]/);
              results.push({
                code,
                name: cells[3] || '',
                startDate: rocToAD(parts[0]?.trim() || ''),
                endDate:   rocToAD(parts[1]?.trim() || ''),
                market: 'tse'
              });
            }
          }
        });
      }

      // 上櫃處置股
      const r2 = await fetch('https://www.tpex.org.tw/web/bulletin/disposal_information/disposal_information.php?l=zh-tw', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://www.tpex.org.tw/',
        }
      });
      if (r2.ok) {
        const html = await r2.text();
        const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        rows.forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
            .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').trim());
          if (cells.length >= 5) {
            const rawCode = cells[1]?.trim() || cells[0]?.trim();
            const code = rawCode?.match(/^\d{4,5}$/)?.[0];
            if (code) {
              const rocToAD = (rocDate) => {
                const m = rocDate.match(/(\d+)\/(\d+)\/(\d+)/);
                if (!m) return rocDate;
                return `${parseInt(m[1])+1911}/${m[2]}/${m[3]}`;
              };
              // 找日期欄位
              const dateCell = cells.find(c => c.includes('/') && c.includes('～')) || '';
              const parts = dateCell.split(/[～~]/);
              results.push({
                code,
                name: cells[2] || cells[1] || '',
                startDate: rocToAD(parts[0]?.trim() || ''),
                endDate:   rocToAD(parts[1]?.trim() || ''),
                market: 'otc'
              });
            }
          }
        });
      }

      // 去除重複
      const seen = new Set();
      const unique = results.filter(r => {
        if (seen.has(r.code)) return false;
        seen.add(r.code);
        return true;
      });

      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json({ stocks: unique, count: unique.length });
    } catch(e) {
      return res.status(502).json({ error: e.message, stocks: [] });
    }
  }

  const targets = {
    tse: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    otc: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    tse_day: `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym||twDate}&stockNo=${code}&response=json`,
    revenue_tse: `https://www.twse.com.tw/rwd/zh/cgData/t21sc04?date=${date||twDate}&response=json`,
    revenue_otc: `https://www.tpex.org.tw/openapi/v1/tpex_revenue`,
    chip_tse: `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date||twDate}&selectType=ALL&response=json`,
    chip_otc: `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_3major_investors_daily`,
    chip_stock: `https://www.twse.com.tw/rwd/zh/fund/TWT38U?date=${date||twDate}&stockNo=${code}&response=json`,
  };

  const referers = {
    tse: 'https://www.twse.com.tw/',
    otc: 'https://www.tpex.org.tw/',
    tse_day: 'https://www.twse.com.tw/',
    revenue_tse: 'https://www.twse.com.tw/',
    revenue_otc: 'https://www.tpex.org.tw/',
    chip_tse: 'https://www.twse.com.tw/',
    chip_otc: 'https://www.tpex.org.tw/',
    chip_stock: 'https://www.twse.com.tw/',
  };

  const url = targets[type];
  if (!url) return res.status(400).json({ error: 'invalid type' });

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
        'Referer': referers[type] || 'https://www.twse.com.tw/',
      }
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
