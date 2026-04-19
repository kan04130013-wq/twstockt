export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type, code, ym, date } = req.query;

  const now = new Date();
  const twDate = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const rocYear = now.getFullYear() - 1911;
  const rocMon = String(now.getMonth()+1).padStart(2,'0');

  const targets = {
    // 股價
    tse: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    otc: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    tse_day: `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym||twDate}&stockNo=${code}&response=json`,
    // 月營收 (上市)
    revenue_tse: `https://www.twse.com.tw/rwd/zh/cgData/t21sc04?date=${date||twDate}&response=json`,
    // 月營收 (上櫃)
    revenue_otc: `https://www.tpex.org.tw/openapi/v1/tpex_revenue`,
    // 三大法人 (上市)
    chip_tse: `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date||twDate}&selectType=ALL&response=json`,
    // 三大法人 (上櫃)
    chip_otc: `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_3major_investors_daily`,
    // 個股法人
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
