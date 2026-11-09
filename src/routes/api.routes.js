const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');

const { scrapeManga } = require('../services/scrapeService');
const {
  DOWNLOADS_DIR,
  downloadSingleImage,
  downloadAllImages,
  saveToLocalFolder,
  createZipArchive,
  createPdfDocument,
  getDownloadHistory
} = require('../utils/downloader');
const { jobProgress, setJobProgress } = require('../services/jobService');

// Hàng đợi để giới hạn số luồng tải ảnh proxy cùng lúc (Tránh bị chặn bởi Anti-DDoS)
const PROXY_CONCURRENCY_LIMIT = 5;
let activeProxyRequests = 0;
const proxyQueue = [];

async function processProxyQueue() {
  if (activeProxyRequests >= PROXY_CONCURRENCY_LIMIT || proxyQueue.length === 0) {
    return;
  }

  activeProxyRequests++;
  const { url, referer, resolve, reject } = proxyQueue.shift();

  try {
    const result = await downloadSingleImage(url, referer, 3);
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    activeProxyRequests--;
    processProxyQueue();
  }
}

function queueProxyRequest(url, referer) {
  return new Promise((resolve, reject) => {
    proxyQueue.push({ url, referer, resolve, reject });
    processProxyQueue();
  });
}

/**
 * 1. API trích xuất ảnh từ URL
 */
router.post('/scrape', async (req, res) => {
  const { url, forceDynamic } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp link URL!' });
  }

  try {
    console.log(`[Scrape Request] URL: ${url} | Force Dynamic: ${Boolean(forceDynamic)}`);
    const result = await scrapeManga(url, Boolean(forceDynamic));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error(`[Scrape Error] ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể cào dữ liệu từ trang web này.'
    });
  }
});

/**
 * 2. Proxy ảnh để hiển thị preview mượt mà trên UI tránh lỗi CORS / 403 Hotlinking
 */
router.get('/proxy-image', async (req, res) => {
  const { url, referer } = req.query;

  if (!url) {
    return res.status(400).send('Missing image URL');
  }

  try {
    const { buffer, contentType } = await queueProxyRequest(url, referer);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(buffer);
  } catch (err) {
    console.warn(`[Proxy Error] URL: ${url.substring(0, 50)}... | Lỗi: ${err.message}`);
    res.redirect(url);
  }
});

/**
 * 3. Server-Sent Events (SSE) để truyền dữ liệu tiến trình (Job Progress) theo thời gian thực
 */
router.get('/stream-progress', (req, res) => {
  const jobId = req.query.jobId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const interval = setInterval(() => {
    if (jobId && jobProgress.has(jobId)) {
      const data = jobProgress.get(jobId);
      res.write(`data: ${JSON.stringify(data)}\n\n`);

      if (data.status === 'completed' || data.status === 'error') {
        clearInterval(interval);
        res.end();
      }
    }
  }, 300);

  req.on('close', () => {
    clearInterval(interval);
  });
});

/**
 * 4. API Tải ảnh và đóng gói (ZIP, PDF, Thư mục)
 */
router.post('/download', async (req, res) => {
  const {
    url,
    mangaTitle,
    chapterTitle,
    imageUrls,
    exportTypes = ['zip', 'folder'],
    savePath
  } = req.body;

  if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách ảnh trống!' });
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  setJobProgress(jobId, {
    jobId,
    status: 'downloading',
    completed: 0,
    total: imageUrls.length,
    percent: 0,
    message: 'Đang chuẩn bị tải các trang ảnh...'
  });

  (async () => {
    try {
      const downloadedImages = await downloadAllImages(
        imageUrls,
        url,
        (progress) => {
          setJobProgress(jobId, {
            jobId,
            status: 'downloading',
            completed: progress.completed,
            total: progress.total,
            percent: progress.percent,
            message: `Đang tải ảnh ${progress.completed}/${progress.total} (${progress.percent}%)`
          });
        }
      );

      if (downloadedImages.length === 0) {
        throw new Error('Không tải được bất kỳ hình ảnh nào từ máy chủ nguồn!');
      }

      setJobProgress(jobId, {
        jobId,
        status: 'packaging',
        completed: imageUrls.length,
        total: imageUrls.length,
        percent: 100,
        message: 'Đang đóng gói file theo yêu cầu...'
      });

      const outputs = {};

      if (exportTypes.includes('folder')) {
        const folderResult = await saveToLocalFolder(mangaTitle, chapterTitle, downloadedImages, savePath);
        outputs.folder = folderResult;
      }

      if (exportTypes.includes('zip')) {
        const zipResult = await createZipArchive(mangaTitle, chapterTitle, downloadedImages, savePath);
        outputs.zip = {
          filename: zipResult.filename,
          size: zipResult.size,
          downloadUrl: `/api/files?path=${encodeURIComponent(zipResult.filePath)}`
        };
      }

      if (exportTypes.includes('pdf')) {
        const pdfResult = await createPdfDocument(mangaTitle, chapterTitle, downloadedImages, savePath);
        outputs.pdf = {
          filename: pdfResult.filename,
          size: pdfResult.size,
          downloadUrl: `/api/files?path=${encodeURIComponent(pdfResult.filePath)}`
        };
      }

      setJobProgress(jobId, {
        jobId,
        status: 'completed',
        completed: imageUrls.length,
        total: imageUrls.length,
        percent: 100,
        message: 'Đã tải và đóng gói thành công!',
        outputs
      });
    } catch (err) {
      console.error(`[Job Error] ${err.message}`);
      setJobProgress(jobId, {
        jobId,
        status: 'error',
        message: err.message
      });
    }
  })();

  res.json({
    success: true,
    jobId,
    message: 'Bắt đầu quá trình tải ảnh...'
  });
});

/**
 * 4.5. API Tải nhiều chương truyện cùng lúc
 */
router.post('/download-batch', async (req, res) => {
  const {
    mangaTitle,
    chapters,
    exportTypes = ['zip', 'folder'],
    savePath,
    forceDynamic
  } = req.body;

  if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách chương trống!' });
  }

  const jobId = `job_${Date.now()}_batch_${Math.random().toString(36).substring(2, 7)}`;
  setJobProgress(jobId, {
    jobId,
    status: 'downloading',
    completed: 0,
    total: chapters.length,
    percent: 0,
    message: 'Đang chuẩn bị tải danh sách chương...'
  });

  (async () => {
    try {
      let chaptersCompleted = 0;
      for (const chapter of chapters) {
        setJobProgress(jobId, {
          jobId,
          status: 'downloading',
          completed: chaptersCompleted,
          total: chapters.length,
          percent: Math.round((chaptersCompleted / chapters.length) * 100),
          message: `Đang phân tích chương: ${chapter.title}...`
        });

        try {
          const scrapeResult = await scrapeManga(chapter.url, Boolean(forceDynamic));
          const imageUrls = scrapeResult.images;

          if (!imageUrls || imageUrls.length === 0) {
            console.warn(`[Batch Download] Không tìm thấy ảnh trong ${chapter.title}`);
            chaptersCompleted++;
            continue;
          }

          const downloadedImages = await downloadAllImages(
            imageUrls,
            chapter.url,
            (progress) => {
              setJobProgress(jobId, {
                jobId,
                status: 'downloading',
                completed: chaptersCompleted,
                total: chapters.length,
                percent: Math.round((chaptersCompleted / chapters.length) * 100),
                message: `Đang tải [${chapter.title}] - Ảnh ${progress.completed}/${progress.total} (${progress.percent}%)`
              });
            }
          );

          if (downloadedImages.length > 0) {
            if (exportTypes.includes('folder')) {
              await saveToLocalFolder(mangaTitle, chapter.title, downloadedImages, savePath);
            }
            if (exportTypes.includes('zip')) {
              await createZipArchive(mangaTitle, chapter.title, downloadedImages, savePath);
            }
            if (exportTypes.includes('pdf')) {
              await createPdfDocument(mangaTitle, chapter.title, downloadedImages, savePath);
            }
          }
        } catch (chapterErr) {
          console.warn(`[Batch Download] Lỗi khi tải ${chapter.title}:`, chapterErr.message);
        }
        
        chaptersCompleted++;
      }

      setJobProgress(jobId, {
        jobId,
        status: 'completed',
        completed: chapters.length,
        total: chapters.length,
        percent: 100,
        message: 'Đã tải xong toàn bộ chương bạn chọn!',
        outputs: {} 
      });
    } catch (err) {
      console.error(`[Batch Job Error] ${err.message}`);
      setJobProgress(jobId, {
        jobId,
        status: 'error',
        message: err.message
      });
    }
  })();

  res.json({
    success: true,
    jobId,
    message: 'Bắt đầu quá trình tải hàng loạt chương...'
  });
});

/**
 * 5. Tải trực tiếp file ZIP/PDF
 */
router.get('/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(DOWNLOADS_DIR, filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath, filename);
  } else {
    res.status(404).json({ success: false, message: 'File không tồn tại!' });
  }
});

router.get('/files', (req, res) => {
  const filepath = req.query.path;
  if (!filepath || !fs.existsSync(filepath)) {
    return res.status(404).json({ success: false, message: 'File không tồn tại!' });
  }
  const filename = path.basename(filepath);
  res.download(filepath, filename);
});

/**
 * Mở hộp thoại chọn thư mục (Chỉ Windows)
 */
router.get('/choose-folder', (req, res) => {
  if (process.platform === 'win32') {
    const psScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      Add-Type -AssemblyName System.windows.forms;
      $form = New-Object System.Windows.Forms.Form;
      $form.TopMost = $true;
      $f = New-Object System.Windows.Forms.FolderBrowserDialog;
      $f.Description = 'Chon thu muc luu anh';
      $f.ShowNewFolderButton = $true;
      if($f.ShowDialog($form) -eq 'OK'){
          Write-Output $f.SelectedPath
      }
      $form.Dispose();
    `;
    exec(`powershell -sta -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { encoding: 'utf8' }, (err, stdout) => {
      if (err) return res.json({ success: false, message: 'Lỗi khi mở hộp thoại chọn thư mục' });
      res.json({ success: true, path: stdout.trim() });
    });
  } else {
    res.json({ success: false, message: 'Chỉ hỗ trợ chọn thư mục qua giao diện trên Windows.' });
  }
});

/**
 * 6. Lấy lịch sử tải
 */
router.get('/history', (req, res) => {
  try {
    const history = getDownloadHistory();
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 7. Xóa file khỏi lịch sử
 */
router.delete('/history/*', (req, res) => {
  const filename = decodeURIComponent(req.params[0]);
  const filePath = path.join(DOWNLOADS_DIR, filename);

  try {
    if (fs.existsSync(filePath)) {
      if (fs.lstatSync(filePath).isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      res.json({ success: true, message: 'Đã xóa thành công!' });
    } else {
      res.status(404).json({ success: false, message: 'Không tìm thấy file hoặc thư mục!' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 8. Mở thư mục Downloads trong File Explorer trên máy người dùng
 */
router.post('/open-folder', (req, res) => {
  const subPath = req.body.subPath;
  let targetPath = DOWNLOADS_DIR;
  
  if (subPath) {
    const safeSubPath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '');
    targetPath = path.join(DOWNLOADS_DIR, safeSubPath);
  } else if (req.body.absolutePath) {
    targetPath = req.body.absolutePath;
  }

  if (process.platform === 'win32') {
    const psScript = `
      $path = '${targetPath}';
      $shell = New-Object -ComObject Shell.Application;
      $windows = $shell.Windows();
      $found = $false;
      foreach ($win in $windows) {
        if ($win.Name -match 'Explorer') {
          $win.Navigate2('file:///' + $path.Replace('\\', '/'));
          $found = $true;
          break;
        }
      }
      if (-not $found) {
        Invoke-Item $path;
      }
    `;
    exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${targetPath}"`);
  } else {
    exec(`xdg-open "${targetPath}"`);
  }

  res.json({ success: true, message: 'Đã mở thư mục Downloads', path: targetPath });
});

/**
 * 9. Lấy danh sách ảnh trong 1 thư mục đã tải để đọc trực tiếp
 */
router.get('/chapter-images', (req, res) => {
  const subPath = req.query.path;
  if (!subPath) return res.status(400).json({ success: false, message: 'Thiếu đường dẫn' });
  
  const safeSubPath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const targetPath = path.join(DOWNLOADS_DIR, safeSubPath);

  try {
    if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isDirectory()) {
      const files = fs.readdirSync(targetPath)
        .filter(f => /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(f))
        .sort();
      
      const imageUrls = files.map(f => `/downloads/${safeSubPath}/${f}`.replace(/\\/g, '/'));
      res.json({ success: true, images: imageUrls });
    } else {
      res.status(404).json({ success: false, message: 'Thư mục không tồn tại' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
