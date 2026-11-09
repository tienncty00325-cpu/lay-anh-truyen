const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
const { DOWNLOADS_DIR } = require('./src/utils/downloader');
const apiRoutes = require('./src/routes/api.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(DOWNLOADS_DIR));

// API Routes
app.use('/api', apiRoutes);

// Khởi chạy server với tính năng tự động tìm port trống
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`=======================================================`);
    console.log(`  MANGA & COMIC IMAGE DOWNLOADER TOOL`);
    console.log(`  Server đang chạy tại: http://localhost:${port}`);
    console.log(`  Thư mục lưu trữ: ${DOWNLOADS_DIR}`);
    console.log(`=======================================================`);
    
    // Tự động mở trình duyệt web
    const url = `http://localhost:${port}`;
    const startCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    exec(`${startCmd} ${url}`, (err) => {
      if (err) console.error('Không thể tự động mở trình duyệt:', err);
    });
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`[Cảnh báo] Cổng ${port} đã được sử dụng. Đang thử cổng ${port + 1}...`);
      setTimeout(() => {
        startServer(port + 1);
      }, 500);
    } else {
      console.error(e);
    }
  });
}

startServer(PORT);
