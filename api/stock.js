export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type, code, ym, date } = req.query;

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
