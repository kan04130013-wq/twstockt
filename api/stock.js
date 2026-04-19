export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type, code, ym, date } = req.query;

  const now = new Date();
  const twDate = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  // 處置股：直接抓 TWSE HTML 公告頁面解析
  if (type === 'disposition') {
    try {
      const results = [];

      // 上市處置股公告頁
      const r1 = await fetch('https://www.twse.com.tw/zh/markets/regular/punish.html', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://www.twse.com.tw/',
        }
      });
      if (r1.ok) {
        const html = await r1.text();
        // 解析 table rows: 找股票代號(4碼數字)、起訖日期
        const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
        rows.forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
            .map(td => td.replace(/<[^>]+>/g, '').trim());
          if (cells.length >= 3) {
            const code = cells[0]?.match(/^\d{4}$/)?.[0];
            if (code) {
              results.push({
                code,
                name: cells[1] || '',
                startDate: cells[2] || '',
                endDate: cells[3] || '',
                market: 'tse'
              });
            }
          }
        });
      }

      // 上櫃處置股公告頁
      const r2 = await fetch('https://www.tpex.org.tw/web/bulletin/announcement/punish/punish_list.php?l=zh-tw', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://www.tpex.org.tw/',
        }
      });
      if (r2.ok) {
        const html = await r2.text();
        const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
        rows.forEach(row => {
          const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
            .map(td => td.replace(/<[^>]+>/g, '').trim());
          if (cells.length >= 3) {
            const code = cells[0]?.match(/^\d{4,5}$/)?.[0];
            if (code) {
              results.push({
                code,
                name: cells[1] || '',
                startDate: cells[2] || '',
                endDate: cells[3] || '',
                market: 'otc'
              });
            }
          }
        });
      }

      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json({ stocks: results, count: results.length });
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
