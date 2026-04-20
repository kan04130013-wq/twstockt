export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type, code, ym, date } = req.query;
  const now = new Date();
  const twDate = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  // 處置股
  if (type === 'disposition') {
    try {
      const results = [];
      const r1 = await fetch('https://www.twse.com.tw/announcement/punish?response=html', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
          'Accept': 'text/html,application/xhtml+xml',
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
            const c = cells[2]?.trim().match(/^\d{4,5}$/)?.[0];
            if (c) {
              const rocToAD = s => { const m=s.match(/(\d+)\/(\d+)\/(\d+)/); return m?`${+m[1]+1911}/${m[2]}/${m[3]}`:s; };
              const parts = (cells[6]||'').split(/[～~]/);
              results.push({ code:c, name:cells[3]||'', startDate:rocToAD(parts[0]?.trim()||''), endDate:rocToAD(parts[1]?.trim()||''), market:'tse' });
            }
          }
        });
      }
      const seen = new Set();
      const unique = results.filter(r => { if(seen.has(r.code)) return false; seen.add(r.code); return true; });
      res.setHeader('Cache-Control', 's-maxage=1800');
      return res.status(200).json({ stocks: unique, count: unique.length });
    } catch(e) {
      return res.status(502).json({ error: e.message, stocks: [] });
    }
  }

  // 一般端點
  const targets = {
    tse:         'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    otc:         'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    tse_day:     `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym||twDate}&stockNo=${code}&response=json`,
    revenue_tse: `https://www.twse.com.tw/rwd/zh/cgData/t21sc04?date=${date||twDate}&response=json`,
    chip_tse:    `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date||twDate}&selectType=ALL&response=json`,
    chip_otc:    'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_3major_investors_daily',
  };
  const referers = {
    tse:'https://www.twse.com.tw/', otc:'https://www.tpex.org.tw/',
    tse_day:'https://www.twse.com.tw/', revenue_tse:'https://www.twse.com.tw/',
    chip_tse:'https://www.twse.com.tw/', chip_otc:'https://www.tpex.org.tw/',
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
