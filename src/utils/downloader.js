const fs = require('fs');
const path = require('path');
const cloudscraper = require('cloudscraper');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const mime = require('mime-types');
const sanitize = require('sanitize-filename');
const { DEFAULT_HEADERS, getJarForDomain } = require('../services/browserService');

const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'downloads');

// Đảm bảo thư mục lưu trữ luôn tồn tại
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Tải 1 ảnh duy nhất kèm theo cơ chế thử lại (Retry) và xử lý Header chống 403
 */
async function downloadSingleImage(url, refererUrl, retries = 3) {
  const urlObj = new URL(url);
  const refObj = refererUrl ? new URL(refererUrl) : urlObj;

  const headers = {
    'Referer': `${refObj.protocol}//${refObj.host}/`,
    'Origin': `${refObj.protocol}//${refObj.host}`
  };

  const jar = getJarForDomain(refObj.host);
  const scraper = cloudscraper.defaults({ jar });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await scraper.get({
        uri: url,
        headers,
        encoding: null, // Nhận dữ liệu dạng Buffer thay vì String
        timeout: 15000,
        resolveWithFullResponse: true
      });

      const buffer = response.body;
      const expectedLength = parseInt(response.headers['content-length'] || '0', 10);
      
      // Nếu server báo dung lượng lớn hơn số byte thực tế tải về -> Lỗi tải thiếu (bị đứt kết nối)
      if (expectedLength > 0 && buffer.length < expectedLength) {
        throw new Error(`File bị tải thiếu (${buffer.length}/${expectedLength} bytes)`);
      }

      const contentType = response.headers['content-type'] || 'image/jpeg';
      let ext = mime.extension(contentType) || 'jpg';
      if (ext === 'bin' || ext === 'octet-stream') {
        const urlExtMatch = url.split('?')[0].match(/\.(jpg|jpeg|png|webp|gif|avif)$/i);
        ext = urlExtMatch ? urlExtMatch[1].toLowerCase() : 'jpg';
      }

      return {
        buffer,
        ext,
        contentType
      };
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Lỗi tải ảnh sau ${retries} lần thử: ${err.message} (${url})`);
      }
      // Chờ tăng dần trước khi thử lại
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Tải toàn bộ danh sách ảnh với kiểm soát luồng (Concurrency Pool) và báo cáo tiến trình
 */
async function downloadAllImages(imageUrls, refererUrl, onProgress = () => {}, concurrency = 4) {
  const results = new Array(imageUrls.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < imageUrls.length) {
      const index = cursor++;
      const url = imageUrls[index];

      try {
        const imageData = await downloadSingleImage(url, refererUrl);
        results[index] = {
          index: index + 1,
          url,
          ...imageData,
          success: true
        };
      } catch (err) {
        console.error(`[Download Error] Ảnh ${index + 1}: ${err.message}`);
        results[index] = {
          index: index + 1,
          url,
          success: false,
          error: err.message
        };
      }

      completed++;
      onProgress({
        completed,
        total: imageUrls.length,
        percent: Math.round((completed / imageUrls.length) * 100),
        currentIndex: index + 1,
        currentUrl: url,
        success: results[index].success
      });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, imageUrls.length) }, () => worker());
  await Promise.all(workers);

  return results.filter(r => r && r.success);
}

/**
 * Lưu danh sách ảnh trực tiếp vào thư mục máy tính
 */
async function saveToLocalFolder(mangaTitle, chapterTitle, downloadedImages, customPath = null) {
  const safeManga = sanitize(mangaTitle || 'Manga');
  const safeChapter = sanitize(chapterTitle || 'Chapter');
  
  const baseDir = customPath && fs.existsSync(customPath) ? customPath : DOWNLOADS_DIR;
  const targetDir = path.join(baseDir, safeManga, safeChapter);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const savedFiles = [];
  for (const img of downloadedImages) {
    const padIndex = String(img.index).padStart(3, '0');
    const filename = `${padIndex}.${img.ext}`;
    const filePath = path.join(targetDir, filename);

    await fs.promises.writeFile(filePath, img.buffer);
    savedFiles.push({
      filename,
      filePath,
      size: img.buffer.length
    });
  }

  return {
    targetDir,
    savedFiles,
    totalSaved: savedFiles.length
  };
}

/**
 * Đóng gói ảnh thành file ZIP
 */
async function createZipArchive(mangaTitle, chapterTitle, downloadedImages, customPath = null) {
  const safeManga = sanitize(mangaTitle || 'Manga');
  const safeChapter = sanitize(chapterTitle || 'Chapter');
  const zipFilename = `${safeManga} - ${safeChapter}.zip`;
  
  const baseDir = customPath && fs.existsSync(customPath) ? customPath : DOWNLOADS_DIR;
  const zipPath = path.join(baseDir, zipFilename);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 6 } // Mức nén cân bằng tốc độ và dung lượng
  });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      resolve({
        filename: zipFilename,
        filePath: zipPath,
        size: archive.pointer()
      });
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    for (const img of downloadedImages) {
      const padIndex = String(img.index).padStart(3, '0');
      const filename = `${padIndex}.${img.ext}`;
      archive.append(img.buffer, { name: filename });
    }

    archive.finalize();
  });
}

/**
 * Đóng gói ảnh thành file PDF chất lượng cao
 */
async function createPdfDocument(mangaTitle, chapterTitle, downloadedImages, customPath = null) {
  const safeManga = sanitize(mangaTitle || 'Manga');
  const safeChapter = sanitize(chapterTitle || 'Chapter');
  const pdfFilename = `${safeManga} - ${safeChapter}.pdf`;
  
  const baseDir = customPath && fs.existsSync(customPath) ? customPath : DOWNLOADS_DIR;
  const pdfPath = path.join(baseDir, pdfFilename);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ autoFirstPage: false });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      for (const img of downloadedImages) {
        try {
          // Mở trang mới tương ứng với kích thước ảnh
          const imgRef = doc.openImage(img.buffer);
          doc.addPage({
            size: [imgRef.width, imgRef.height],
            margin: 0
          });
          doc.image(imgRef, 0, 0, { width: imgRef.width, height: imgRef.height });
        } catch (imgErr) {
          console.warn(`[PDF Warning] Bỏ qua ảnh ${img.index} không tương thích PDF:`, imgErr.message);
        }
      }

      doc.end();

      stream.on('finish', () => {
        const stats = fs.statSync(pdfPath);
        resolve({
          filename: pdfFilename,
          filePath: pdfPath,
          size: stats.size
        });
      });

      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Lấy danh sách các file đã tải về trong thư mục downloads
 */
function getDownloadHistory() {
  const items = [];

  function scanDir(dir, relativePath = '') {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    let imageCount = 0;
    let latestTime = null;

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath, rel);
      } else {
        const stats = fs.statSync(fullPath);
        const time = stats.birthtime || stats.mtime;
        
        if (/\.(zip|pdf)$/i.test(entry.name)) {
          items.push({
            name: entry.name,
            relativePath: rel.replace(/\\/g, '/'),
            size: stats.size,
            createdAt: time,
            isArchive: true,
            isImage: false,
            type: 'file'
          });
        } else if (/\.(jpg|jpeg|png|webp|gif|avif)$/i.test(entry.name)) {
          imageCount++;
          if (!latestTime || time > latestTime) {
            latestTime = time;
          }
        }
      }
    }

    if (imageCount > 0 && relativePath !== '') {
      items.push({
        name: relativePath.replace(/\\/g, ' / '),
        relativePath: relativePath.replace(/\\/g, '/'),
        size: 0,
        createdAt: latestTime || new Date(),
        isArchive: false,
        isImage: false,
        type: 'folder',
        imageCount: imageCount
      });
    }
  }

  scanDir(DOWNLOADS_DIR);
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  DOWNLOADS_DIR,
  downloadSingleImage,
  downloadAllImages,
  saveToLocalFolder,
  createZipArchive,
  createPdfDocument,
  getDownloadHistory
};
