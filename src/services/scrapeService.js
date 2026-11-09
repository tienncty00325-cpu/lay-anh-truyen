const axios = require('axios');
const cheerio = require('cheerio');
const sanitize = require('sanitize-filename');
const { URL } = require('url');
const cloudscraper = require('cloudscraper');
const { 
  getGlobalBrowser, 
  DEFAULT_HEADERS, 
  getJarForDomain 
} = require('./browserService');
const { isCloudflareChallenge, handleLoginAndCloudflareWait } = require('./authHelper');


// Danh sách các selector phổ biến của các web truyện
const COMMON_READER_SELECTORS = [
  '.reading-detail img',
  '.page-chapter img',
  '.box_doc img',
  '.chapter-content img',
  '.reading-content img',
  '#chapter-c img',
  '.container-chapter-reader img',
  '.vung-doc img',
  '.content-doc img',
  '.comic-image img',
  'img.wp-manga-chapter-img',
  '.chapter-image img',
  '.chapter-img img',
  '.reader-container img',
  '.entry-content img',
  '.main-reading-area img',
  '#viewer img',
  '#image-container img',
  '#chapter_content img',
  '.viewer-cnt img',
  '.read-container img',
  '.manga-container img',
  '.images-list img',
  '.chapter-body img',
  '.page-break img',
  '.reading-box img',
  '#chapter_box img'
];

const JUNK_URL_PATTERNS = [
  /logo/i,
  /banner/i,
  /advert/i,
  /ads?\./i,
  /facebook/i,
  /telegram/i,
  /discord/i,
  /avatar/i,
  /icon/i,
  /button/i,
  /loading/i,
  /spinner/i,
  /placeholder/i,
  /1x1/i,
  /favicon/i,
  /social/i,
  /donate/i,
  /watermark/i,
  /cloudflare/i,
  /spacer/i,
  /blank/i,
  /transparent/i,
  /gap/i,
  /bg/i,
  /line/i,
  /emoji/i,
  /reaction/i,
  /rating/i,
  /star/i,
  /like/i,
  /dislike/i,
  /heart/i,
  /angry/i,
  /laugh/i,
  /cry/i,
  /sad/i,
  /wow/i,
  /s\.w\.org/i,
  /wp-includes/i,
  /\.ico$/i
];

function extractImageUrl($, el, baseUrl) {
  const $el = $(el);
  const rawUrl =
    $el.attr('data-src') ||
    $el.attr('data-original') ||
    $el.attr('data-cdn') ||
    $el.attr('data-url') ||
    $el.attr('data-lazy-src') ||
    $el.attr('data-pagespeed-lazy-src') ||
    $el.attr('data-echo') ||
    $el.attr('data-full-url') ||
    $el.attr('src');

  if (!rawUrl) return null;

  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:image/')) return null;

  try {
    if (trimmed.startsWith('//')) {
      const baseProto = new URL(baseUrl).protocol;
      return `${baseProto}${trimmed}`;
    }
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

function isValidMangaImage(url) {
  if (!url || !url.startsWith('http')) return false;
  if (url.match(/\.(jpg|jpeg|png|webp|avif)(\?.*)?$/i) || url.includes('/uploads/') || url.includes('/chapter/') || url.includes('/image/') || url.includes('img.truyen')) {
    for (const pattern of JUNK_URL_PATTERNS) {
      if (pattern.test(url)) return false;
    }
    return true;
  }
  return false;
}



function extractMetadata($, pageUrl) {
  let mangaTitle = '';
  let chapterTitle = '';

  const titleText = $('title').text().trim();
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';

  const breadcrumbItems = $(
    '.breadcrumb a, .breadcrumbs a, .breadcrumb-item a, nav.breadcrumb a, .breadcrumb-list a'
  );
  if (breadcrumbItems.length >= 2) {
    mangaTitle = $(breadcrumbItems[breadcrumbItems.length - 2]).text().trim();
  }

  const h1 = $('h1').first().text().trim();
  if (!mangaTitle && h1) {
    mangaTitle = h1;
  }

  if (!mangaTitle && (ogTitle || titleText)) {
    const raw = ogTitle || titleText;
    const parts = raw.split(/[-|–—»]/);
    if (parts.length > 0) {
      mangaTitle = parts[0].trim();
    }
  }

  const chapterMatch = (titleText + ' ' + ogTitle + ' ' + h1).match(/(chapter|chương|chap|tập|vol|episode)\s*[\d.]+/i);
  if (chapterMatch) {
    chapterTitle = chapterMatch[0].trim();
  } else {
    const urlParts = pageUrl.split('/').filter(Boolean);
    const lastPart = urlParts[urlParts.length - 1] || 'Chapter';
    chapterTitle = decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
  }

  if (!mangaTitle) {
    const urlParts = pageUrl.split('/').filter(Boolean);
    mangaTitle = urlParts.length >= 2 ? urlParts[urlParts.length - 2] : 'Manga';
    mangaTitle = decodeURIComponent(mangaTitle).replace(/[-_]/g, ' ');
  }

  return {
    mangaTitle: sanitize(mangaTitle || 'Truyện Tranh'),
    chapterTitle: sanitize(chapterTitle || 'Chương Chưa Đặt Tên')
  };
}

function extractChapterList($, baseUrl) {
  const chapters = [];
  const selectors = [
    '.list-chapter a',
    '#list-chapter a',
    '.chapter-list a',
    'ul.list-chapters a',
    '.list-chapters a',
    '.chapter a',
    '.wp-manga-chapter a',
    '.chapters-list a',
    '.row-content-chapter a',
    '.works-chapter-item a',
    '.works-chapter-list a',
    '.item-chapter a'
  ];

  const seenUrls = new Set();

  for (const sel of selectors) {
    const elements = $(sel);
    if (elements.length > 0) {
      elements.each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim();
        if (href && !seenUrls.has(href)) {
          try {
            const absoluteUrl = new URL(href, baseUrl).href;
            seenUrls.add(href);
            chapters.push({
              title: title || 'Chapter',
              url: absoluteUrl
            });
          } catch {}
        }
      });
      if (chapters.length > 0) break;
    }
  }

  return chapters;
}

/**
 * Cào ảnh bằng Cheerio + Axios (Chế độ quét nhanh)
 */
async function scrapeImagesFast(pageUrl) {
  const urlObj = new URL(pageUrl);
  const domain = urlObj.host;
  const rootUrl = `${urlObj.protocol}//${domain}/`;
  
  const headers = {
    ...DEFAULT_HEADERS,
    'Referer': rootUrl
  };

  const jar = getJarForDomain(domain);
  const scraper = cloudscraper.defaults({ jar });

  let html = '';
  try {
    // Thử ping trang chủ trước để lấy cookie Cloudflare nếu chưa có
    try {
      await scraper.get({ uri: rootUrl, headers, timeout: 10000 });
    } catch(e) {}

    html = await scraper.get({
      uri: pageUrl,
      headers,
      timeout: 15000
    });
  } catch (error) {
    let msg = error.message;
    if (msg.includes('403') || msg.includes('Cloudflare') || msg.includes('Just a moment')) {
      throw new Error('Trang web đang bật tường lửa bảo vệ. Vui lòng BẬT công tắc "Chế độ Trình duyệt ảo" để tải!');
    }
    // Truncate long HTML errors
    if (msg.length > 200) msg = msg.substring(0, 150) + '...';
    throw new Error('Không thể kết nối đến trang: ' + msg);
  }

  const $ = cheerio.load(html);
  const title = $('title').text();

  if (isCloudflareChallenge(title, html)) {
    throw new Error('Trang web đang bật bảo vệ Cloudflare/Captcha');
  }

  const metadata = extractMetadata($, pageUrl);
  const chapterList = extractChapterList($, pageUrl);

  const images = [];
  const seenUrls = new Set();

  // 1. Thử các selector đặc thù trước
  for (const selector of COMMON_READER_SELECTORS) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, el) => {
        if ($(el).closest('#comments, .comments, .comment-list, .comment-box, #disqus_thread, .fb-comments, .sidebar, .widget, .banner, .ads, .journalPage, .list-comment, .cm-list').length > 0) {
          return;
        }
        
        const imgUrl = extractImageUrl($, el, pageUrl);
        if (imgUrl && isValidMangaImage(imgUrl) && !seenUrls.has(imgUrl)) {
          // Kiểm tra kích thước (nếu có trên thẻ HTML) để lọc icon/emoji
          const w = parseInt($(el).attr('width') || '0', 10);
          const h = parseInt($(el).attr('height') || '0', 10);
          if ((w > 0 && w < 300) || (h > 0 && h < 300)) {
            return;
          }
          
          seenUrls.add(imgUrl);
          images.push(imgUrl);
        }
      });
    }
  }

  // 2. Nếu chưa tìm thấy ảnh, quét toàn bộ thẻ <img> trong body
  if (images.length === 0) {
    $('img').each((_, el) => {
      // Bỏ qua ảnh nằm trong comment, sidebar, quảng cáo
      if ($(el).closest('#comments, .comments, .comment-list, .comment-box, #disqus_thread, .fb-comments, .sidebar, .widget, .banner, .ads, .journalPage, .list-comment, .cm-list').length > 0) {
        return;
      }

      const imgUrl = extractImageUrl($, el, pageUrl);
      if (imgUrl && isValidMangaImage(imgUrl) && !seenUrls.has(imgUrl)) {
        const width = parseInt($(el).attr('width') || '0', 10);
        const height = parseInt($(el).attr('height') || '0', 10);
        // Kích thước tối thiểu lớn hơn để lọc avatar và meme
        if ((width > 0 && width < 300) || (height > 0 && height < 300)) {
          return;
        }

        seenUrls.add(imgUrl);
        images.push(imgUrl);
      }
    });
  }

  return {
    url: pageUrl,
    mangaTitle: metadata.mangaTitle,
    chapterTitle: metadata.chapterTitle,
    images,
    chapterList,
    mode: 'fast'
  };
}



/**
 * Tải danh sách ảnh bằng Puppeteer (Xử lý trang dùng JS / Anti-bot)
 */
async function scrapeImagesDynamic(pageUrl) {
  const browser = await getGlobalBrowser();
  const page = await browser.newPage();
  
  try {
    await page.setViewport({ width: 1280, height: 900 });

    const interceptedImages = new Set();
    page.on('response', async (res) => {
      const req = res.request();
      if (req.resourceType() === 'image') {
        const url = res.url();
        if (isValidMangaImage(url)) {
          interceptedImages.add(url);
        }
      }
    });

    try {
      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (e) {
      if (e.message.includes('Execution context was destroyed') || e.message.includes('net::ERR_ABORTED') || e.message.includes('Navigation failed')) {
        console.log('[Dynamic] Bỏ qua lỗi điều hướng ban đầu (do Cloudflare redirect):', e.message);
      } else {
        console.log('[Dynamic] Lỗi khi goto:', e.message);
      }
    }

    // Chờ xử lý Cloudflare và Auto-Login
    await handleLoginAndCloudflareWait(page, pageUrl, COMMON_READER_SELECTORS);

    // ĐỒNG BỘ COOKIES: Lấy cookies (đặc biệt là cf_clearance) từ Puppeteer truyền cho Cloudscraper/Downloader
    try {
      const pageCookies = await page.cookies();
      const hostname = new URL(pageUrl).hostname;
      if (!domainJars[hostname]) {
        domainJars[hostname] = request.jar();
      }
      pageCookies.forEach(c => {
        const cookieStr = `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}`;
        domainJars[hostname].setCookie(cookieStr, pageUrl);
      });
      console.log(`[Dynamic] Đã đồng bộ ${pageCookies.length} cookies từ Puppeteer sang hệ thống tải ảnh.`);
    } catch (e) {
      console.warn('[Dynamic] Lỗi khi đồng bộ cookies:', e.message);
    }

    // Cuộn trang xuống từ từ để kích hoạt tất cả lazy-load
    try {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 400;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight || totalHeight >= 200000) {
              clearInterval(timer);
              resolve();
            }
          }, 150);
        });
      });
    } catch (e) {
      console.log('[Dynamic] Bỏ qua lỗi cuộn trang:', e.message);
    }

    await new Promise(r => setTimeout(r, 1000));

    // Trích xuất DOM và ảnh
    let pageData = { images: [], chapterList: [], title: '', h1: '' };
    try {
      pageData = await page.evaluate((junkPatterns, readerSelectors) => {
      const junkRegexes = junkPatterns.map(p => new RegExp(p.source, p.flags));
      const title = document.title || '';
      const h1 = document.querySelector('h1')?.innerText || '';

      const images = [];
      const seen = new Set();
      const chapterList = [];

      // Extract chapter list just in case it's a Manga Home Page
      const chapterEls = document.querySelectorAll('.wp-manga-chapter a, .chapter-list a, .list-chapter a, #chapter-list a, .row-content-chapter a, ul.list-chapters a, .chapter a');
      chapterEls.forEach(el => {
        const title = el.innerText.trim();
        const url = el.getAttribute('href');
        if (title && url) {
          chapterList.push({ title, url });
        }
      });

      const checkAndAdd = (img) => {
        // Bỏ qua ảnh nằm trong vùng bình luận hoặc quảng cáo bất kể selector nào
        const closestComment = img.closest('#comments, .comments, .comment-list, .comment-box, #disqus_thread, .fb-comments, .sidebar, .widget, .banner, .ads, .journalPage, .list-comment, .cm-list');
        if (closestComment) return;

        const src = img.currentSrc || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-cdn') || img.src;
        if (src && src.startsWith('http') && !src.includes('data:image/gif')) {
          let isJunk = false;
          for (const rx of junkRegexes) {
            if (rx.test(src)) {
              isJunk = true;
              break;
            }
          }
          if (!isJunk && !seen.has(src)) {
            // Lọc avatar, icon, meme nhỏ
            if (img.naturalWidth > 0 && img.naturalWidth < 300) return;
            if (img.naturalHeight > 0 && img.naturalHeight < 300) return;
            seen.add(src);
            images.push(src);
          }
        }
      };

      // 1. Thử các selector đặc thù trước
      for (const sel of readerSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          els.forEach(checkAndAdd);
        }
      }

      // 2. Nếu vẫn không tìm thấy, quét toàn bộ img
      if (images.length === 0) {
        const imgElements = document.querySelectorAll('img');
        imgElements.forEach(checkAndAdd);
      }

      // 3. Nếu không tìm thấy ảnh, kiểm tra xem có phải do chưa đăng nhập không (phòng hờ)
      if (images.length === 0) {
        const bodyText = document.body.innerText.toLowerCase();
        if (bodyText.includes('bạn cần đăng nhập') || (bodyText.includes('đăng nhập') && (bodyText.includes('để đọc') || bodyText.includes('yêu cầu')))) {
          return { error: 'REQUIRES_LOGIN' };
        }
      }

      return { title, h1, images, chapterList };
    }, JUNK_URL_PATTERNS.map(r => ({ source: r.source, flags: r.flags })), COMMON_READER_SELECTORS);
    } catch (e) {
      console.log('[Dynamic] Lỗi khi trích xuất dữ liệu:', e.message);
    }

    if (pageData && pageData.error === 'REQUIRES_LOGIN') {
      throw new Error(`Quá thời gian chờ đăng nhập. Vui lòng bấm tải lại và đăng nhập vào trang web để đọc truyện.`);
    }

    const combinedImages = [...pageData.images];
    
    // Chỉ gộp ảnh bắt được từ Network Request nếu DOM không lấy được ảnh (để phòng web xài canvas/blob ẩn HTML)
    // Nếu DOM đã lấy được nhiều ảnh thì bỏ qua để tránh rác (emoji, icon, banner...)
    if (combinedImages.length < 5) {
      for (const url of interceptedImages) {
        if (!combinedImages.includes(url)) {
          combinedImages.push(url);
        }
      }
    }

    const { mangaTitle, chapterTitle } = extractMetadata(cheerio.load(`<h1>${pageData.h1}</h1><title>${pageData.title}</title>`), pageUrl);

    return {
      url: pageUrl,
      mangaTitle,
      chapterTitle,
      images: combinedImages,
      chapterList: pageData.chapterList || [],
      mode: 'dynamic'
    };
  } catch (error) {
    throw new Error('Puppeteer failed: ' + error.message);
  } finally {
    try {
      await page.close();
    } catch (e) {}
  }
}

/**
 * Hàm phân tích link chính
 */
async function scrapeManga(pageUrl, forceDynamic = false) {
  if (!pageUrl || typeof pageUrl !== 'string' || !pageUrl.startsWith('http')) {
    throw new Error('Đường link URL không hợp lệ! Vui lòng cung cấp link dạng https://...');
  }

  try {
    const fastResult = await scrapeImagesFast(pageUrl);
    
    // Nếu tìm thấy chapterList nhiều nhưng không có ảnh (đây là trang chủ truyện)
    // Trả về luôn kết quả Fast để giao diện hiển thị danh sách chương!
    if (fastResult.chapterList && fastResult.chapterList.length > 0 && (!fastResult.images || fastResult.images.length <= 3)) {
      console.log(`[Fast Scraper] Đã nhận diện đây là trang chủ truyện với ${fastResult.chapterList.length} chương.`);
      return fastResult;
    }

    if (!forceDynamic && fastResult.images && fastResult.images.length > 0) {
      return fastResult;
    }
    
    console.log(`[Dynamic] Bắt đầu Trình duyệt ảo cho: ${pageUrl}`);
    const dynamicResult = await scrapeImagesDynamic(pageUrl);
    
    // Gộp chapterList từ Fast nếu Dynamic không có
    if (!dynamicResult.chapterList || dynamicResult.chapterList.length === 0) {
      dynamicResult.chapterList = fastResult.chapterList;
    }
    return dynamicResult;
  } catch (err) {
    if (forceDynamic) {
      return await scrapeImagesDynamic(pageUrl);
    }
    throw err;
  }
}

module.exports = {
  scrapeManga,
  scrapeImagesFast,
  scrapeImagesDynamic
};
