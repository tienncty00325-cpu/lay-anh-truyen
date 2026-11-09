const fs = require('fs');
const path = require('path');
const request = require('request-promise');
const { connect } = require('puppeteer-real-browser');

const domainJars = {};
function getJarForDomain(domain) {
  if (!domainJars[domain]) {
    domainJars[domain] = request.jar();
  }
  return domainJars[domain];
}

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

function getSystemChromePath() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser'
  ];

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

let globalBrowser = null;
let browserLaunchPromise = null;

async function getGlobalBrowser() {
  if (globalBrowser) return globalBrowser;
  if (browserLaunchPromise) return browserLaunchPromise;

  const chromePath = getSystemChromePath();
  console.log(`[Dynamic Crawler] Khởi chạy trình duyệt chống phát hiện (Anti-Detect Browser)...`);
  
  browserLaunchPromise = connect({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,900',
      '--disable-blink-features=AutomationControlled'
    ],
    customConfig: {
      executablePath: chromePath,
      userDataDir: path.join(__dirname, '..', '..', 'chrome-profile')
    },
    turnstile: true,
    disableXvfb: false,
    ignoreAllFlags: false
  }).then(async ({ browser }) => {
    globalBrowser = browser;
    browser.on('disconnected', () => {
      globalBrowser = null;
      browserLaunchPromise = null;
    });

    try {
      const tempPage = await browser.newPage();
      const realUA = await tempPage.evaluate(() => navigator.userAgent);
      DEFAULT_HEADERS['User-Agent'] = realUA.replace('HeadlessChrome', 'Chrome');
      await tempPage.close();
      console.log('[Puppeteer] Đã đồng bộ User-Agent thật sang Cloudscraper:', DEFAULT_HEADERS['User-Agent']);
    } catch (e) {
      console.log('[Puppeteer] Lỗi khi đồng bộ User-Agent:', e.message);
    }

    return browser;
  });

  return browserLaunchPromise;
}

module.exports = {
    getGlobalBrowser,
    getSystemChromePath,
    getJarForDomain,
    DEFAULT_HEADERS
};
