export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type, code, ym, date } = req.query;
  const now = new Date();
  const twDate = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const rocToAD = s => { const m=s?.match(/(\d+)\/(\d+)\/(\d+)/); return m?`${+m[1]+1911}/${m[2]}/${m[3]}`:s||''; };

  // ── 處置股（上市 + 上櫃）─────────────────────────────────────
  if (type === 'disposition') {
    const results = [];
    const seen = new Set();

    // 上市處置股（TWSE HTML）
    try {
      const r = await fetch('https://www.twse.com.tw/announcement/punish?response=html', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
          'Accept': 'text/html',
          'Referer': 'https://www.twse.com.tw/zh/announcement/punish.html',
        }
      });
      if (r.ok) {
        const html = await r.text();
        (html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)||[]).forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi)||[])
            .map(td => td.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
          if (cells.length >= 7) {
            const c = cells[2]?.trim().match(/^\d{4,5}$/)?.[0];
            if (c && !seen.has(c)) {
              seen.add(c);
              const parts = (cells[6]||'').split(/[～~]/);
              results.push({ code:c, name:cells[3]||'', startDate:rocToAD(parts[0]?.trim()), endDate:rocToAD(parts[1]?.trim()), market:'tse' });
            }
          }
        });
      }
    } catch(e) {}

    // 上櫃處置股（TPEx HTML - Vercel IP 可存取）
    try {
      const r = await fetch('https://www.tpex.org.tw/web/bulletin/disposal_information/disposal_information.php?l=zh-tw', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'zh-TW,zh;q=0.9',
          'Referer': 'https://www.tpex.org.tw/',
          'Cache-Control': 'no-cache',
        }
      });
      if (r.ok) {
        const html = await r.text();
        (html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)||[]).forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi)||[])
            .map(td => td.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());
          if (cells.length >= 3) {
            const c = cells[0]?.match(/^\d{4,5}$/)?.[0];
            if (c && !seen.has(c)) {
              seen.add(c);
              const rocToAD2 = s => { const m=s?.match(/(\d+)[\/\-](\d+)[\/\-](\d+)/); return m?`${+m[1]+1911}/${m[2]}/${m[3]}`:s||''; };
              results.push({ code:c, name:cells[1]||'', startDate:rocToAD2(cells[2]), endDate:rocToAD2(cells[3]), market:'otc' });
            }
          }
        });
      }
    } catch(e) {}

    res.setHeader('Cache-Control', 's-maxage=1800');
    return res.status(200).json({ stocks: results, count: results.length, otc: results.filter(r=>r.market==='otc').length });
  }

  // ── 一般端點 ─────────────────────────────────────────────────
  const targets = {
    tse:         'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    otc:         'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    tse_day:     `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym||twDate}&stockNo=${code}&response=json`,
    revenue_tse: `https://www.twse.com.tw/rwd/zh/cgData/t21sc04?date=${date||twDate}&response=json`,
    chip_tse:    `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date||twDate}&selectType=ALL&response=json`,
    chip_otc:    'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_3major_investors_daily',
    quarterly:   `https://www.twse.com.tw/rwd/zh/finance/t163sb05?year=${req.query.year||now.getFullYear()}&season=${req.query.q||1}&response=json`,
  };
  const referers = {
    tse:'https://www.twse.com.tw/', otc:'https://www.tpex.org.tw/',
    tse_day:'https://www.twse.com.tw/', revenue_tse:'https://www.twse.com.tw/',
    chip_tse:'https://www.twse.com.tw/', chip_otc:'https://www.tpex.org.tw/',
    quarterly:'https://www.twse.com.tw/',
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
