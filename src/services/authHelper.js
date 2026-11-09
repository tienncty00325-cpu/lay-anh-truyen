function isCloudflareChallenge(title, html = '') {
  const cfKeywords = [
    'just a moment',
    'chờ một chút',
    'performing security verification',
    'ddos-guard',
    'security check',
    'attention required',
    'turnstile'
  ];

  const lowerTitle = (title || '').toLowerCase();
  const lowerHtml = (html || '').toLowerCase();

  return cfKeywords.some(kw => lowerTitle.includes(kw) || lowerHtml.includes(kw));
}

async function handleLoginAndCloudflareWait(page, pageUrl, COMMON_READER_SELECTORS) {
  let isStuckInCF = false;
  
  for (let i = 0; i < 180; i++) {
    let currentTitle = '';
    let currentUrl = '';
    try {
      currentTitle = await page.title();
      currentUrl = await page.url();
    } catch (e) {
      if (e.message.includes('Execution context was destroyed')) {
        console.log('[Dynamic] Phát hiện trang đang chuyển hướng (vừa qua Captcha hoặc đang Đăng nhập)...');
        currentTitle = 'Đang chuyển trang';
      }
    }

    if (isCloudflareChallenge(currentTitle)) {
      isStuckInCF = true;
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    
    let isCFBlock = false;
    try {
      isCFBlock = await page.evaluate(() => {
        // Chỉ kiểm tra các thẻ đặc thù của Cloudflare Turnstile hoặc thông báo thực sự
        const html = document.body.innerHTML;
        const text = document.body.innerText;
        const hasTurnstile = html.includes('cf-turnstile') || html.includes('cf-msg-wrapper');
        const hasCFTitle = document.title.includes('Just a moment') || document.title.includes('Attention Required');
        const hasCFText = text.includes('verifies you are not a bot') || text.includes('Checking if the site connection is secure');
        return hasTurnstile || hasCFTitle || hasCFText;
      });
    } catch(e) {}
    
    if (isCFBlock) {
      console.log(`[Dynamic] Đang chờ hệ thống kiểm tra bảo mật (Cloudflare Anti-bot)...`);
      isStuckInCF = true;
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    
    // Nếu không phải Cloudflare, kiểm tra xem có đang ở trang đăng nhập không
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('/login') || currentUrl.includes('dang-nhap')) {
       // Auto Login Logic cho Google
       if (currentUrl.includes('accounts.google.com')) {
         console.log(`[Dynamic] Đang ở trang Google Login, tự động điền thông tin...`);
         try {
           const emailInput = await page.$('#identifierId, input[type="email"]');
           if (emailInput) {
             const isEmailHidden = await page.evaluate(el => el.offsetParent === null, emailInput);
             if (!isEmailHidden) {
               const val = await page.evaluate(el => el.value, emailInput);
               if (!val || val.length === 0) {
                 await emailInput.type('nguyenchitien2508@gmail.com');
                 await page.keyboard.press('Enter');
                 await new Promise(r => setTimeout(r, 3000));
               }
             }
           }
           const passInput = await page.$('input[name="Passwd"], input[type="password"]');
           if (passInput) {
             const isPassHidden = await page.evaluate(el => el.offsetParent === null, passInput);
             if (!isPassHidden) {
               const val = await page.evaluate(el => el.value, passInput);
               if (!val || val.length === 0) {
                 await passInput.type('25082009tien');
                 await page.keyboard.press('Enter');
                 await new Promise(r => setTimeout(r, 5000));
               }
             }
           }
         } catch (e) {}
       } else {
         console.log(`[Dynamic] Đang ở trang đăng nhập của Web, tìm nút Đăng Nhập bằng Google...`);
         try {
           await page.evaluate(() => {
             const googleBtns = Array.from(document.querySelectorAll('a, button, .btn'));
             for (const btn of googleBtns) {
               if (btn.innerText && btn.innerText.toUpperCase().includes('GOOGLE')) {
                 btn.click();
                 if (btn.tagName === 'A' && btn.href && !btn.href.includes('#')) {
                   window.location.href = btn.href;
                 }
                 break;
               }
             }
           });
         } catch(e) {}
       }

       await new Promise(r => setTimeout(r, 2000));
       continue;
    }

    // Kiểm tra xem trang có text yêu cầu đăng nhập thực sự (che mất nội dung) không
    let needsLogin = false;
    try {
       needsLogin = await page.evaluate((readerSelectors) => {
         const bodyText = document.body.innerText.toLowerCase();
         // Cần check kỹ hơn để tránh dính chữ "đăng nhập để bình luận"
         const hasLoginText = bodyText.includes('bạn cần đăng nhập để đọc') || 
                              bodyText.includes('yêu cầu đăng nhập để xem') ||
                              bodyText.includes('vui lòng đăng nhập để đọc');
         
         // Hoặc check xem có form login to đùng ở giữa màn hình không
         const hasLoginForm = document.querySelector('form input[type="password"]') !== null && 
                              (document.querySelector('.swal2-container') !== null || bodyText.includes('đăng nhập'));
                              
         let hasReader = false;
         for (const sel of readerSelectors) {
             if (document.querySelector(sel)) { hasReader = true; break; }
         }
         
         return hasLoginText || (hasLoginForm && !hasReader);
       }, COMMON_READER_SELECTORS);
    } catch (e) {}

    if (needsLogin) {
       console.log('[Dynamic] Trang truyện đang khóa và yêu cầu Đăng Nhập, đang chuyển hướng sang trang Đăng nhập...');
       try {
         await page.evaluate(() => {
           // Thử click nút của Swal2 nếu có
           const swalConfirm = document.querySelector('.swal2-confirm');
           if (swalConfirm) swalConfirm.click();
           
           // Tìm URL login thật sự trên thanh menu
           const links = Array.from(document.querySelectorAll('a'));
           for (const a of links) {
               if (a.href && (a.href.includes('/login') || a.href.includes('dang-nhap') || a.href.includes('dangnhap'))) {
                   window.location.href = a.href;
                   return;
               }
           }

           // Fallback tìm nút có chữ ĐĂNG NHẬP
           const btns = Array.from(document.querySelectorAll('a, button, .btn'));
           for (const btn of btns) {
             if (btn.innerText && btn.innerText.toUpperCase().includes('ĐĂNG NHẬP')) {
               btn.click();
               if (btn.tagName === 'A' && btn.href && btn.href !== '' && !btn.href.includes('#')) {
                  window.location.href = btn.href;
               }
               break;
             }
           }
         });
       } catch (e) {}
       
       // Fix the wait mechanism for navigating to login page
       let isLoginPageNow = false;
       for (let wait = 0; wait < 10; wait++) {
           await new Promise(r => setTimeout(r, 1000));
           try {
              const url = await page.url();
              if (url.includes('/login') || url.includes('dang-nhap') || url.includes('accounts.google.com')) {
                  isLoginPageNow = true;
                  break;
              }
           } catch(e) {}
       }
       
       continue;
    }

    isStuckInCF = false;
    let actuallyHasImages = false;
    try {
      actuallyHasImages = await page.evaluate((readerSelectors) => {
        let found = false;
        for (const sel of readerSelectors) {
           if (document.querySelectorAll(sel).length > 0) { found = true; break; }
        }
        return found;
      }, COMMON_READER_SELECTORS);
    } catch (e) {}
    
    if (!actuallyHasImages) {
       await new Promise(r => setTimeout(r, 1000));
    } else {
       console.log(`[Dynamic] Đã tìm thấy ảnh truyện, đang chờ trang tải xong...`);
    }
    
    // Chờ đến khi trang load xong 100%
    for (let j = 0; j < 15; j++) {
      try {
        const readyState = await page.evaluate(() => document.readyState);
        if (readyState === 'complete') break;
      } catch(err) {}
      await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 2000));
    break;
  }

  // Cảnh báo nếu sau 180s vẫn cần đăng nhập
  let finalNeedsLogin = false;
  try {
    finalNeedsLogin = await page.evaluate((readerSelectors) => {
      const bodyText = document.body.innerText.toLowerCase();
      const hasLoginText = bodyText.includes('bạn cần đăng nhập để đọc') || 
                           bodyText.includes('yêu cầu đăng nhập để xem') ||
                           bodyText.includes('vui lòng đăng nhập để đọc');
      const hasLoginForm = document.querySelector('form input[type="password"]') !== null && 
                           (document.querySelector('.swal2-container') !== null || bodyText.includes('đăng nhập'));
      
      let hasReader = false;
      for (const sel of readerSelectors) {
          if (document.querySelector(sel)) { hasReader = true; break; }
      }
      return hasLoginText || (hasLoginForm && !hasReader);
    }, COMMON_READER_SELECTORS);
  } catch (e) {}
  if (finalNeedsLogin) {
    throw new Error(`Không thể tự động đăng nhập. Vui lòng kiểm tra lại trình duyệt ảo.`);
  }

  if (isStuckInCF) {
    throw new Error(`Trang web này (${new URL(pageUrl).hostname}) đang kích hoạt tường lửa Cloudflare Captcha (yêu cầu xác minh người dùng thực). Vui lòng thử lại sau hoặc dùng trang khác.`);
  }
}

module.exports = {
  isCloudflareChallenge,
  handleLoginAndCloudflareWait
};
