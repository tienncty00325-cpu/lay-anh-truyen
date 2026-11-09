// Xác định API Host: Tự động kết nối tới port 3000 ngay cả khi mở bằng VS Code Live Server (port 5500)
const API_BASE = (window.location.port === '3000') ? '' : 'http://localhost:3000';

// State Management
const state = {
  currentUrl: '',
  mangaTitle: '',
  chapterTitle: '',
  images: [], // List of { url, selected: boolean }
  chapterList: [], // List of { title, url, selected: boolean }
  lightboxIndex: 0,
  history: [],
  isScraping: false,
  isDownloading: false
};

// DOM Elements
const inputUrl = document.getElementById('input-url');
const btnPaste = document.getElementById('btn-paste');
const btnDirectDownload = document.getElementById('btn-direct-download');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnScrape = document.getElementById('btn-scrape');
const chkDynamicMode = document.getElementById('chk-dynamic-mode');
const chkExportZip = document.getElementById('chk-export-zip');
const chkExportPdf = document.getElementById('chk-export-pdf');
const chkExportFolder = document.getElementById('chk-export-folder');
const chkShowPreview = document.getElementById('chk-show-preview');
const inputSavePath = document.getElementById('input-save-path');
const btnChooseFolder = document.getElementById('btn-choose-folder');

const statusCard = document.getElementById('status-card');
const statusTitle = document.getElementById('status-title');
const statusDesc = document.getElementById('status-desc');

const progressCard = document.getElementById('progress-card');
const progressTitle = document.getElementById('progress-title');
const progressMessage = document.getElementById('progress-message');
const progressPercent = document.getElementById('progress-percent');
const progressBarFill = document.getElementById('progress-bar-fill');
const downloadResultsActions = document.getElementById('download-results-actions');

const batchCard = document.getElementById('batch-card');
const chapterListGrid = document.getElementById('chapter-list-grid');
const btnSelectAllChapters = document.getElementById('btn-select-all-chapters');
const btnDeselectAllChapters = document.getElementById('btn-deselect-all-chapters');
const statSelectedChapters = document.getElementById('stat-selected-chapters');
const btnDownloadSelectedChapters = document.getElementById('btn-download-selected-chapters');

const resultToolbar = document.getElementById('result-toolbar');
const metaMangaTitle = document.getElementById('meta-manga-title');
const metaChapterTitle = document.getElementById('meta-chapter-title');
const statTotalImages = document.getElementById('stat-total-images');
const statSelectedImages = document.getElementById('stat-selected-images');
const btnToggleSelectImages = document.getElementById('btn-toggle-select-images');
const btnStartDownload = document.getElementById('btn-start-download');

const galleryContainer = document.getElementById('gallery-container');
const imageGrid = document.getElementById('image-grid');

const historyList = document.getElementById('history-list');
const historyBadge = document.getElementById('history-badge');
const btnRefreshHistory = document.getElementById('btn-refresh-history');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnOpenFolderTab = document.getElementById('btn-open-folder-tab');

const lightboxModal = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const btnCloseLightbox = document.getElementById('btn-close-lightbox');
const btnPrevImage = document.getElementById('btn-prev-image');
const btnNextImage = document.getElementById('btn-next-image');

const toastContainer = document.getElementById('toast-container');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  loadHistory();
});

// Safe Fetch JSON helper
async function safeFetchJson(endpoint, options = {}) {
  try {
    const fullUrl = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const res = await fetch(fullUrl, options);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Máy chủ trả về phản hồi không hợp lệ (${res.status}). Đảm bảo Server Node.js (cổng 3000) đang chạy!`);
    }

    if (!res.ok) {
      throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Yêu cầu đã bị hủy hoặc hết thời gian.');
    }
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      throw new Error('Không thể kết nối đến máy chủ Node.js tại http://localhost:3000. Hãy kiểm tra server đã được bật chưa!');
    }
    throw err;
  }
}

// Tab Switcher
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.getElementById(target)?.classList.add('active');

      if (tab.id === 'tab-mode-single') {
        if (btnDirectDownload) btnDirectDownload.style.display = 'inline-flex';
        if (btnDownloadAll) btnDownloadAll.style.display = 'none';
        if (inputUrl) inputUrl.placeholder = 'Dán link chapter truyện tại đây (VD: TruyenQQ, NetTruyen...)';
      } else if (tab.id === 'tab-mode-batch') {
        if (btnDirectDownload) btnDirectDownload.style.display = 'none';
        if (btnDownloadAll) btnDownloadAll.style.display = 'inline-flex';
        if (inputUrl) inputUrl.placeholder = 'Dán link TRANG CHỦ bộ truyện tại đây (Để lấy tất cả chapter)';
      }

      if (target === 'tab-history') {
        loadHistory();
      }
    });
  });
}

// Event Listeners
function setupEventListeners() {
  // Paste button
  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        inputUrl.value = text.trim();
        showToast('Đã dán link từ clipboard', 'success');
      }
    } catch {
      inputUrl.focus();
    }
  });

  // Enter in input -> Direct download
  inputUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      startDirectDownload(false);
    }
  });

  // Direct Download button (No Web Rendering lag)
  btnDirectDownload.addEventListener('click', () => startDirectDownload(false));
  if (btnDownloadAll) {
    btnDownloadAll.addEventListener('click', () => startDirectDownload(true));
  }

  // Scrape / Preview button
  btnScrape.addEventListener('click', () => startScrape(true));

  // Toggle select/deselect all images
  btnToggleSelectImages.addEventListener('click', () => {
    const hasUnselected = state.images.some(img => !img.selected);
    const newStatus = hasUnselected;
    state.images.forEach(img => img.selected = newStatus);
    if (!galleryContainer.classList.contains('hidden')) {
      renderImageGrid();
    }
    updateStats();
  });

  // Start Download button (from toolbar)
  btnStartDownload.addEventListener('click', () => executeDownload(state.images.filter(i => i.selected).map(i => i.url)));

  // Batch chapter actions
  btnSelectAllChapters?.addEventListener('click', () => {
    state.chapterList.forEach(c => c.selected = true);
    renderChapterList();
  });

  btnDeselectAllChapters?.addEventListener('click', () => {
    state.chapterList.forEach(c => c.selected = false);
    renderChapterList();
  });

  btnDownloadSelectedChapters?.addEventListener('click', () => {
    const selectedChapters = state.chapterList.filter(c => c.selected);
    if (selectedChapters.length > 0) {
      executeBatchDownload(selectedChapters);
    }
  });

  // Open Folder actions
  const openFolderHandler = async () => {
    try {
      const data = await safeFetchJson('/api/open-folder', { method: 'POST' });
      if (data.success) {
        showToast('Đã mở thư mục Downloads trên máy tính', 'success');
      }
    } catch (err) {
      showToast('Không thể mở thư mục: ' + err.message, 'error');
    }
  };
  btnOpenFolder.addEventListener('click', openFolderHandler);
  btnOpenFolderTab.addEventListener('click', openFolderHandler);

  btnRefreshHistory.addEventListener('click', loadHistory);

  // Quick sample pill buttons
  document.querySelectorAll('.pill-sample').forEach(btn => {
    btn.addEventListener('click', () => {
      inputUrl.value = btn.dataset.url;
      startDirectDownload();
    });
  });

  // Lightbox navigation
  btnCloseLightbox.addEventListener('click', closeLightbox);
  lightboxModal.querySelector('.lightbox-overlay').addEventListener('click', closeLightbox);
  btnPrevImage.addEventListener('click', () => navigateLightbox(-1));
  btnNextImage.addEventListener('click', () => navigateLightbox(1));

  document.addEventListener('keydown', (e) => {
    if (!lightboxModal.classList.contains('hidden')) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
    }
  });

  // Choose folder handler
  if (btnChooseFolder) {
    btnChooseFolder.addEventListener('click', async () => {
      try {
        const data = await safeFetchJson('/api/choose-folder');
        if (data.success && data.path) {
          inputSavePath.value = data.path;
        } else if (data.message) {
          showToast(data.message, 'error');
        }
      } catch (err) {
        showToast('Không thể mở hộp thoại chọn thư mục: ' + err.message, 'error');
      }
    });
  }
}

// 1. DIRECT DOWNLOAD: Cào link và tải thẳng về máy không tải ảnh lên web
async function startDirectDownload(isDownloadAll = false) {
  const url = inputUrl.value.trim();
  if (!url || !url.startsWith('http')) {
    showToast('Vui lòng nhập đường link URL hợp lệ (bắt đầu bằng http:// hoặc https://)', 'error');
    inputUrl.focus();
    return;
  }

  // Early validation: ensure at least one export format is selected
  const hasExportFolder = chkExportFolder && chkExportFolder.checked;
  const hasExportZip = chkExportZip && chkExportZip.checked;
  const hasExportPdf = chkExportPdf && chkExportPdf.checked;
  
  if (!hasExportFolder && !hasExportZip && !hasExportPdf) {
    showToast('Vui lòng chọn ít nhất 1 định dạng xuất (Lưu Thư mục, Nén ZIP hoặc Xuất PDF)!', 'error');
    return;
  }

  if (state.isDownloading || state.isScraping) return;

  state.currentUrl = url;
  state.isScraping = true;
  showStatus(true, 'Đang phân tích link truyện...', 'Đang trích xuất dữ liệu để tải về...');

  btnDirectDownload.disabled = true;
  if (btnDownloadAll) btnDownloadAll.disabled = true;
  btnScrape.disabled = true;
  resultToolbar.classList.add('hidden');
  galleryContainer.classList.add('hidden');
  batchCard.classList.add('hidden');
  progressCard.classList.add('hidden');

  try {
    const result = await safeFetchJson('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        forceDynamic: chkDynamicMode.checked
      })
    });

    if (!result.success) {
      throw new Error(result.message || 'Không thể cào dữ liệu từ trang này');
    }

    const { mangaTitle, chapterTitle, images, chapterList } = result.data;
    state.mangaTitle = mangaTitle || 'Truyện Tranh';
    state.chapterTitle = chapterTitle || 'Chương 1';
    state.images = (images || []).map((imgUrl, i) => ({
      index: i + 1,
      url: imgUrl,
      selected: true
    }));
    state.chapterList = (chapterList || []).map(ch => ({
      ...ch,
      selected: false
    }));

    metaMangaTitle.value = state.mangaTitle;
    metaChapterTitle.value = state.chapterTitle;

    showStatus(false);
    state.isScraping = false;

    // Kiểm tra xem đây có phải là trang chủ không (ít ảnh trang truyện nhưng có nhiều link chap)
    const isHomepage = state.images.length === 0 || (state.images.length <= 3 && state.chapterList.length > 0);

    if (isHomepage) {
      if (state.chapterList.length > 0) {
        if (isDownloadAll) {
          showToast(`Trang chủ truyện. Đang tải tự động toàn bộ ${state.chapterList.length} chương...`, 'success');
          state.chapterList.forEach(c => c.selected = true);
          renderChapterList();
          batchCard.classList.remove('hidden');
          // Tự động kích hoạt tải hàng loạt
          await executeBatchDownload(state.chapterList);
        } else {
          renderChapterList();
          batchCard.classList.remove('hidden');
          showToast(`Đây là Trang chủ truyện. Đã tìm thấy ${state.chapterList.length} chương. Vui lòng chọn các chương muốn tải ở bên dưới!`, 'info');
        }
      } else {
        showToast('Không tìm thấy ảnh hoặc danh sách chương!', 'error');
      }
      return;
    }

    if (isDownloadAll && !isHomepage) {
      showToast('Lưu ý: Link này là của một chapter cụ thể. Sẽ tiến hành tải chapter này.', 'info');
    }

    // Nếu người dùng chọn hiện ảnh xem trước thì hiển thị
    if (chkShowPreview.checked) {
      renderImageGrid();
      updateStats();
      resultToolbar.classList.remove('hidden');
      galleryContainer.classList.remove('hidden');
    }

    showToast(`Tìm thấy ${state.images.length} ảnh. Đang tiến hành tải thẳng về máy tính...`, 'success');

    // Tiến hành tải thẳng toàn bộ ảnh về máy tính ngay lập tức
    await executeDownload(state.images.map(i => i.url));

  } catch (err) {
    showStatus(false);
    showToast('Lỗi: ' + err.message, 'error');
  } finally {
    state.isScraping = false;
    btnDirectDownload.disabled = false;
    if (btnDownloadAll) btnDownloadAll.disabled = false;
    btnScrape.disabled = false;
  }
}

// 2. Scrape & Preview Only
async function startScrape(showPreviewForce = false) {
  const url = inputUrl.value.trim();
  if (!url || !url.startsWith('http')) {
    showToast('Vui lòng nhập đường link URL hợp lệ', 'error');
    inputUrl.focus();
    return;
  }

  if (state.isScraping) return;

  state.currentUrl = url;
  state.isScraping = true;
  showStatus(true, 'Đang quét dữ liệu...', 'Đang phân tích cấu trúc HTML trang web...');

  resultToolbar.classList.add('hidden');
  galleryContainer.classList.add('hidden');
  batchCard.classList.add('hidden');
  progressCard.classList.add('hidden');
  btnScrape.disabled = true;

  try {
    const result = await safeFetchJson('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        forceDynamic: chkDynamicMode.checked
      })
    });

    if (!result.success) {
      throw new Error(result.message || 'Không thể cào dữ liệu');
    }

    const { mangaTitle, chapterTitle, images, chapterList, mode } = result.data;
    state.mangaTitle = mangaTitle || 'Truyện Tranh';
    state.chapterTitle = chapterTitle || 'Chương 1';
    state.images = (images || []).map((imgUrl, i) => ({
      index: i + 1,
      url: imgUrl,
      selected: true
    }));
    state.chapterList = (chapterList || []).map(ch => ({
      ...ch,
      selected: false
    }));

    metaMangaTitle.value = state.mangaTitle;
    metaChapterTitle.value = state.chapterTitle;

    if (state.chapterList.length > 0) {
      renderChapterList();
      batchCard.classList.remove('hidden');
    }

    if (state.images.length > 0) {
      if (showPreviewForce || chkShowPreview.checked) {
        renderImageGrid();
        galleryContainer.classList.remove('hidden');
      }
      updateStats();
      resultToolbar.classList.remove('hidden');
      showToast(`Đã tìm thấy ${state.images.length} ảnh (${mode === 'dynamic' ? 'Trình duyệt ảo' : 'Quét nhanh'})`, 'success');
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  } finally {
    state.isScraping = false;
    showStatus(false);
    btnScrape.disabled = false;
  }
}

// 3. Execute Download Engine
async function executeDownload(selectedUrls) {
  if (!selectedUrls || selectedUrls.length === 0) {
    showToast('Vui lòng chọn ít nhất 1 ảnh để tải!', 'error');
    return;
  }

  const exportTypes = [];
  if (chkExportFolder.checked) exportTypes.push('folder');
  if (chkExportZip.checked) exportTypes.push('zip');
  if (chkExportPdf.checked) exportTypes.push('pdf');

  if (exportTypes.length === 0) {
    showToast('Vui lòng chọn ít nhất 1 định dạng xuất (Lưu Thư mục, Nén ZIP hoặc Xuất PDF)!', 'error');
    return;
  }

  const mangaTitle = metaMangaTitle.value.trim() || state.mangaTitle;
  const chapterTitle = metaChapterTitle.value.trim() || state.chapterTitle;
  const savePath = inputSavePath ? inputSavePath.value.trim() : '';

  state.isDownloading = true;
  btnDirectDownload.disabled = true;
  if (btnDownloadAll) btnDownloadAll.disabled = true;
  btnStartDownload.disabled = true;

  // Show Progress Card
  progressCard.classList.remove('hidden');
  progressTitle.textContent = `Đang tải: ${mangaTitle} - ${chapterTitle}`;
  progressMessage.textContent = `Chuẩn bị tải ${selectedUrls.length} ảnh trực tiếp về ổ đĩa...`;
  progressPercent.textContent = '0%';
  progressBarFill.style.width = '0%';
  downloadResultsActions.innerHTML = '';
  downloadResultsActions.classList.add('hidden');

  try {
    const data = await safeFetchJson('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: state.currentUrl,
        mangaTitle,
        chapterTitle,
        imageUrls: selectedUrls,
        exportTypes,
        savePath
      })
    });

    if (!data.success) {
      throw new Error(data.message || 'Không thể bắt đầu tác vụ tải ảnh');
    }

    const eventSource = new EventSource(`${API_BASE}/api/progress/${data.jobId}`);

    eventSource.onmessage = (event) => {
      const progress = JSON.parse(event.data);

      if (progress.percent !== undefined) {
        progressBarFill.style.width = `${progress.percent}%`;
        progressPercent.textContent = `${progress.percent}%`;
      }

      if (progress.message) {
        progressMessage.textContent = progress.message;
      }

      if (progress.status === 'completed') {
        eventSource.close();
        state.isDownloading = false;
        btnDirectDownload.disabled = false;
        if (btnDownloadAll) btnDownloadAll.disabled = false;
        btnStartDownload.disabled = false;
        showToast('Đã hoàn tất tải toàn bộ ảnh thẳng về máy tính!', 'success');
        renderDownloadResults(progress.outputs);
        loadHistory();
      } else if (progress.status === 'error') {
        eventSource.close();
        state.isDownloading = false;
        btnDirectDownload.disabled = false;
        if (btnDownloadAll) btnDownloadAll.disabled = false;
        btnStartDownload.disabled = false;
        showToast('Lỗi tải ảnh: ' + progress.message, 'error');
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      state.isDownloading = false;
      btnDirectDownload.disabled = false;
      if (btnDownloadAll) btnDownloadAll.disabled = false;
      btnStartDownload.disabled = false;
    };

  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
    state.isDownloading = false;
    btnDirectDownload.disabled = false;
    if (btnDownloadAll) btnDownloadAll.disabled = false;
    btnStartDownload.disabled = false;
  }
}

// 3.5. Execute Batch Download Engine
async function executeBatchDownload(selectedChapters) {
  if (!selectedChapters || selectedChapters.length === 0) {
    showToast('Vui lòng chọn ít nhất 1 chương để tải!', 'error');
    return;
  }

  const exportTypes = [];
  if (chkExportFolder.checked) exportTypes.push('folder');
  if (chkExportZip.checked) exportTypes.push('zip');
  if (chkExportPdf.checked) exportTypes.push('pdf');

  if (exportTypes.length === 0) {
    showToast('Vui lòng chọn ít nhất 1 định dạng xuất (Lưu Thư mục, Nén ZIP hoặc Xuất PDF)!', 'error');
    return;
  }

  const mangaTitle = metaMangaTitle.value.trim() || state.mangaTitle;
  const savePath = inputSavePath ? inputSavePath.value.trim() : '';

  state.isDownloading = true;
  btnDirectDownload.disabled = true;
  if (btnDownloadAll) btnDownloadAll.disabled = true;
  btnStartDownload.disabled = true;
  if (btnDownloadSelectedChapters) btnDownloadSelectedChapters.disabled = true;

  // Show Progress Card
  progressCard.classList.remove('hidden');
  progressTitle.textContent = `Đang tải hàng loạt: ${mangaTitle}`;
  progressMessage.textContent = `Chuẩn bị cào dữ liệu ${selectedChapters.length} chương...`;
  progressPercent.textContent = '0%';
  progressBarFill.style.width = '0%';
  downloadResultsActions.innerHTML = '';
  downloadResultsActions.classList.add('hidden');

  try {
    const data = await safeFetchJson('/api/download-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mangaTitle,
        chapters: selectedChapters,
        exportTypes,
        savePath,
        forceDynamic: chkDynamicMode.checked
      })
    });

    if (!data.success) {
      throw new Error(data.message || 'Không thể bắt đầu tác vụ tải hàng loạt');
    }

    const eventSource = new EventSource(`${API_BASE}/api/progress/${data.jobId}`);

    eventSource.onmessage = (event) => {
      const progress = JSON.parse(event.data);

      if (progress.percent !== undefined) {
        progressBarFill.style.width = `${progress.percent}%`;
        progressPercent.textContent = `${progress.percent}%`;
      }

      if (progress.message) {
        progressMessage.textContent = progress.message;
      }

      if (progress.status === 'completed') {
        eventSource.close();
        state.isDownloading = false;
        btnDirectDownload.disabled = false;
        if (btnDownloadAll) btnDownloadAll.disabled = false;
        btnStartDownload.disabled = false;
        if (btnDownloadSelectedChapters) btnDownloadSelectedChapters.disabled = false;
        showToast('Đã hoàn tất tải toàn bộ các chương đã chọn!', 'success');
        
        // Show result action (Open Folder)
        const pathInfoBox = document.createElement('div');
        pathInfoBox.className = 'download-path-box';
        pathInfoBox.innerHTML = `
          <div class="path-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>TẢI XONG ${selectedChapters.length} CHƯƠNG! BẠN CÓ THỂ XEM TẠI TAB LỊCH SỬ</span>
          </div>
        `;
        downloadResultsActions.appendChild(pathInfoBox);
        downloadResultsActions.classList.remove('hidden');
        
        loadHistory();
      } else if (progress.status === 'error') {
        eventSource.close();
        state.isDownloading = false;
        btnDirectDownload.disabled = false;
        if (btnDownloadAll) btnDownloadAll.disabled = false;
        btnStartDownload.disabled = false;
        if (btnDownloadSelectedChapters) btnDownloadSelectedChapters.disabled = false;
        showToast('Lỗi tải hàng loạt: ' + progress.message, 'error');
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      state.isDownloading = false;
      btnDirectDownload.disabled = false;
      if (btnDownloadAll) btnDownloadAll.disabled = false;
      btnStartDownload.disabled = false;
      if (btnDownloadSelectedChapters) btnDownloadSelectedChapters.disabled = false;
    };

  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
    state.isDownloading = false;
    btnDirectDownload.disabled = false;
    if (btnDownloadAll) btnDownloadAll.disabled = false;
    btnStartDownload.disabled = false;
    if (btnDownloadSelectedChapters) btnDownloadSelectedChapters.disabled = false;
  }
}

// 4. Render Image Grid Preview (Chỉ khi người dùng bật xem trước)
function renderImageGrid() {
  imageGrid.innerHTML = '';

  state.images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = `image-card ${img.selected ? '' : 'deselected'}`;
    card.dataset.index = idx;

    const proxySrc = `${API_BASE}/api/proxy-image?url=${encodeURIComponent(img.url)}&referer=${encodeURIComponent(state.currentUrl)}`;

    card.innerHTML = `
      <span class="image-badge-number">#${img.index}</span>
      <input type="checkbox" class="image-checkbox" ${img.selected ? 'checked' : ''}>
      <img src="${proxySrc}" alt="Trang ${img.index}" loading="lazy" onerror="this.src='${img.url}'">
      <div class="image-zoom-overlay">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
      </div>
    `;

    const chk = card.querySelector('.image-checkbox');
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
      img.selected = chk.checked;
      card.classList.toggle('deselected', !img.selected);
      updateStats();
    });

    card.addEventListener('click', () => {
      openLightbox(idx);
    });

    imageGrid.appendChild(card);
  });
}

// 5. Render Batch Chapters
function renderChapterList() {
  chapterListGrid.innerHTML = '';
  
  let selectedCount = 0;
  
  state.chapterList.forEach((ch) => {
    const item = document.createElement('div');
    item.className = `chapter-item ${ch.selected ? 'selected' : ''}`;
    item.innerHTML = `
      <input type="checkbox" class="chapter-checkbox" ${ch.selected ? 'checked' : ''}>
      <span title="${ch.title}">${ch.title}</span>
    `;

    if (ch.selected) selectedCount++;

    const chk = item.querySelector('.chapter-checkbox');
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
      ch.selected = chk.checked;
      renderChapterList(); // Re-render to update selected count and styles
    });

    item.addEventListener('click', () => {
      // Toggle selection on item click instead of direct download, better for batching
      ch.selected = !ch.selected;
      renderChapterList();
    });

    chapterListGrid.appendChild(item);
  });
  
  if (statSelectedChapters) {
    statSelectedChapters.textContent = selectedCount;
  }
  
  if (btnDownloadSelectedChapters) {
    btnDownloadSelectedChapters.disabled = selectedCount === 0;
  }
}

function updateStats() {
  const total = state.images.length;
  const selected = state.images.filter(i => i.selected).length;

  statTotalImages.textContent = total;
  statSelectedImages.textContent = selected;

  btnToggleSelectImages.textContent = selected === total ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
  btnStartDownload.disabled = selected === 0;
}

// 6. Render Download Result Buttons & Auto-open Folder + Browser Download
function renderDownloadResults(outputs) {
  if (!outputs) return;
  downloadResultsActions.innerHTML = '';

  // 1. Hiển thị thông báo vị trí lưu rõ ràng trên máy tính
  const pathInfoBox = document.createElement('div');
  pathInfoBox.className = 'download-path-box';
  const folderPath = outputs.folder?.targetDir || 'C:\\Users\\PC\\Downloads\\toollaytruyen\\downloads';
  pathInfoBox.innerHTML = `
    <div class="path-title">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>ĐÃ LƯU THÀNH CÔNG VÀO Ổ ĐĨA MÁY TÍNH CỦA BẠN!</span>
    </div>
    <div class="path-code">
      <code>${folderPath}</code>
    </div>
  `;
  downloadResultsActions.appendChild(pathInfoBox);

  // 2. Nút Mở Thư Mục Trên Máy Tính
  const btnFolder = document.createElement('button');
  btnFolder.className = 'btn btn-primary btn-lg';
  btnFolder.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>
    <span>📁 Mở Thư Mục Ảnh Trên Máy Tính</span>
  `;
  btnFolder.addEventListener('click', async () => {
    const relativeSubPath = outputs.folder?.targetDir 
      ? outputs.folder.targetDir.replace(/\\/g, '/').split('/downloads/')[1] || ''
      : '';
    await safeFetchJson('/api/open-folder', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subPath: relativeSubPath })
    });
    showToast('Đã mở thư mục lưu trữ trên máy tính', 'success');
  });
  downloadResultsActions.appendChild(btnFolder);

  // 3. Nút Tải ZIP (và tự động kích hoạt tải về qua trình duyệt)
  if (outputs.zip) {
    const zipUrl = outputs.zip.downloadUrl.startsWith('http') ? outputs.zip.downloadUrl : `${API_BASE}${outputs.zip.downloadUrl}`;
    const btnZip = document.createElement('a');
    btnZip.href = zipUrl;
    btnZip.download = outputs.zip.filename;
    btnZip.className = 'btn btn-secondary';
    btnZip.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      <span>⬇ Tải file ZIP (${formatBytes(outputs.zip.size)})</span>
    `;
    downloadResultsActions.appendChild(btnZip);
  }

  // 4. Nút Tải PDF
  if (outputs.pdf) {
    const pdfUrl = outputs.pdf.downloadUrl.startsWith('http') ? outputs.pdf.downloadUrl : `${API_BASE}${outputs.pdf.downloadUrl}`;
    const btnPdf = document.createElement('a');
    btnPdf.href = pdfUrl;
    btnPdf.download = outputs.pdf.filename;
    btnPdf.className = 'btn btn-secondary';
    btnPdf.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      <span>📄 Tải file PDF (${formatBytes(outputs.pdf.size)})</span>
    `;
    downloadResultsActions.appendChild(btnPdf);
  }

  downloadResultsActions.classList.remove('hidden');

  // Tự động bật mở thư mục File Explorer trên máy tính tới đúng thư mục vừa tải
  const relativeSubPath = outputs.folder?.targetDir 
    ? outputs.folder.targetDir.replace(/\\/g, '/').split('/downloads/')[1] || ''
    : '';

  safeFetchJson('/api/open-folder', { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subPath: relativeSubPath })
  }).catch(() => {});
}

// 7. Download History Management
async function loadHistory() {
  try {
    const data = await safeFetchJson('/api/history');
    if (data.success) {
      state.history = data.data || [];
      renderHistory();
    }
  } catch (err) {
    console.error('Lỗi lấy lịch sử:', err);
  }
}

function renderHistory() {
  historyBadge.textContent = state.history.length;

  if (state.history.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <p>Chưa có file tải về nào. Hãy nhập link truyện để tải ngay!</p>
      </div>
    `;
    return;
  }

  historyList.innerHTML = '';
  state.history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';

    const isFolder = item.type === 'folder';
    const isZip = item.name.endsWith('.zip');
    const isPdf = item.name.endsWith('.pdf');
    
    let iconSvg = '';
    if (isFolder) {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    } else if (isZip) {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    } else if (isPdf) {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
    } else {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    }

    const timeAgo = new Date(item.createdAt).toLocaleString('vi-VN');
    const metaText = isFolder 
      ? `📁 Đã tải ${item.imageCount} ảnh • ${timeAgo}` 
      : `${formatBytes(item.size)} • ${timeAgo}`;
      
    const downloadLink = `${API_BASE}/api/files/${encodeURIComponent(item.relativePath || item.name)}`;

    row.innerHTML = `
      <div class="history-item-info">
        <div class="history-icon">${iconSvg}</div>
        <div>
          <div class="history-title">${item.name}</div>
          <div class="history-meta">${metaText}</div>
        </div>
      </div>
      <div class="history-actions">
        ${isFolder 
          ? `<button class="btn btn-sm btn-primary btn-read-chapter" data-path="${item.relativePath}">Đọc Trực Tiếp</button>`
          : `<a href="${downloadLink}" class="btn btn-sm btn-primary" download>Tải Về</a>`
        }
        <button class="btn btn-sm btn-secondary btn-delete-file" title="Xóa file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    if (isFolder) {
      row.querySelector('.btn-read-chapter').addEventListener('click', async (e) => {
        const path = e.target.getAttribute('data-path');
        try {
          const d = await safeFetchJson(`/api/chapter-images?path=${encodeURIComponent(path)}`);
          if (d.success && d.images && d.images.length > 0) {
            state.images = d.images.map((url, i) => ({
              index: i + 1,
              url: url,
              selected: true
            }));
            state.currentUrl = 'http://localhost:3000'; // local
            openLightbox(0);
          } else {
            showToast('Không tìm thấy ảnh nào trong thư mục này', 'error');
          }
        } catch (err) {
          showToast('Lỗi khi tải truyện: ' + err.message, 'error');
        }
      });
    }

    row.querySelector('.btn-delete-file').addEventListener('click', async () => {
      const deletePath = item.relativePath || item.name;
      if (confirm(`Bạn có chắc muốn xóa "${item.name}"?`)) {
        try {
          const encodedPath = deletePath.split('/').map(encodeURIComponent).join('/');
          const d = await safeFetchJson(`/api/history/${encodedPath}`, { method: 'DELETE' });
          if (d.success) {
            showToast('Đã xóa file thành công', 'success');
            loadHistory();
          }
        } catch (err) {
          showToast('Lỗi khi xóa: ' + err.message, 'error');
        }
      }
    });

    historyList.appendChild(row);
  });
}

// 8. Lightbox Zoom
function openLightbox(index) {
  state.lightboxIndex = index;
  const currentImg = state.images[index];
  if (!currentImg) return;

  const isLocal = currentImg.url.startsWith('/downloads/');
  const proxySrc = isLocal
    ? currentImg.url
    : `${API_BASE}/api/proxy-image?url=${encodeURIComponent(currentImg.url)}&referer=${encodeURIComponent(state.currentUrl || '')}`;

  lightboxImg.src = proxySrc;
  lightboxCaption.textContent = `Trang ${index + 1} / ${state.images.length}`;
  lightboxModal.classList.remove('hidden');
}

function closeLightbox() {
  lightboxModal.classList.add('hidden');
  lightboxImg.src = '';
}

function navigateLightbox(step) {
  let newIdx = state.lightboxIndex + step;
  if (newIdx < 0) newIdx = state.images.length - 1;
  if (newIdx >= state.images.length) newIdx = 0;
  openLightbox(newIdx);
}

// 9. Helpers
function showStatus(show, title = '', desc = '') {
  if (show) {
    statusTitle.textContent = title;
    statusDesc.textContent = desc;
    statusCard.classList.remove('hidden');
  } else {
    statusCard.classList.add('hidden');
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
