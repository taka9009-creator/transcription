/**
 * Receipt PDF Studio - メインアプリケーション
 * 司令塔 kohal による設計原則 (mem_003: 44pxタッチターゲット, mem_004: XSS防止 textContent徹底) を準拠
 */

document.addEventListener('DOMContentLoaded', () => {
  // アプリケーション状態
  const state = {
    pages: [],               // PageItem[]
    selectedIds: new Set(),  // Set<string>
    isProcessing: false,
    enhancingPageId: null,   // 現在画像補正中のページID
    pdfEngine: new PDFEngine()
  };

  // DOM要素の参照
  const elements = {
    // ヘッダー & ドキュメント情報
    docTitleInput: document.getElementById('docTitleInput'),
    pageCountBadge: document.getElementById('pageCountBadge'),
    
    // 取り込みトリガー
    cameraInput: document.getElementById('cameraInput'),
    btnCamera: document.getElementById('btnCamera'),
    imageInput: document.getElementById('imageInput'),
    btnSelectImage: document.getElementById('btnSelectImage'),
    pdfInput: document.getElementById('pdfInput'),
    btnSelectPdf: document.getElementById('btnSelectPdf'),
    dropZone: document.getElementById('dropZone'),

    // ワークスペース
    emptyState: document.getElementById('emptyState'),
    workspaceGrid: document.getElementById('workspaceGrid'),

    // 一括アクションバー
    bulkActionBar: document.getElementById('bulkActionBar'),
    selectedCountText: document.getElementById('selectedCountText'),
    btnSelectAll: document.getElementById('btnSelectAll'),
    btnDeselectAll: document.getElementById('btnDeselectAll'),
    btnRotateSelected: document.getElementById('btnRotateSelected'),
    btnShareSelected: document.getElementById('btnShareSelected'),
    btnExtractSelected: document.getElementById('btnExtractSelected'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),

    // メイン出力ボタン
    btnExportPdf: document.getElementById('btnExportPdf'),
    btnSplitPdf: document.getElementById('btnSplitPdf'),
    btnClearAll: document.getElementById('btnClearAll'),

    // 画像補正モーダル
    enhanceModal: document.getElementById('enhanceModal'),
    enhanceCanvas: document.getElementById('enhanceCanvas'),
    enhancePresetRadios: document.getElementsByName('enhancePreset'),
    enhanceBrightness: document.getElementById('enhanceBrightness'),
    valBrightness: document.getElementById('valBrightness'),
    enhanceContrast: document.getElementById('enhanceContrast'),
    valContrast: document.getElementById('valContrast'),
    btnEnhanceRotate: document.getElementById('btnEnhanceRotate'),
    btnEnhanceApply: document.getElementById('btnEnhanceApply'),
    btnEnhanceCancel: document.getElementById('btnEnhanceCancel'),

    // 分割モーダル
    splitModal: document.getElementById('splitModal'),
    splitPreviewList: document.getElementById('splitPreviewList'),
    btnConfirmSplit: document.getElementById('btnConfirmSplit'),
    btnConfirmSplitAll: document.getElementById('btnConfirmSplitAll'),
    btnCancelSplit: document.getElementById('btnCancelSplit'),

    // プレビュー・ダウンロードモーダル
    exportModal: document.getElementById('exportModal'),
    exportPdfFrame: document.getElementById('exportPdfFrame'),
    exportPageSizeSelect: document.getElementById('exportPageSizeSelect'),
    btnDownloadPdf: document.getElementById('btnDownloadPdf'),
    btnOpenShareModal: document.getElementById('btnOpenShareModal'),
    btnCloseExportModal: document.getElementById('btnCloseExportModal'),

    // 共有モーダル
    shareModal: document.getElementById('shareModal'),
    btnCloseShareModal: document.getElementById('btnCloseShareModal'),
    btnCancelShareModal: document.getElementById('btnCancelShareModal'),
    btnNativeShare: document.getElementById('btnNativeShare'),
    btnShareGmail: document.getElementById('btnShareGmail'),
    btnCopyChatworkText: document.getElementById('btnCopyChatworkText'),
    btnOpenChatwork: document.getElementById('btnOpenChatwork'),
    btnOpenGoogleDrive: document.getElementById('btnOpenGoogleDrive'),
    webShareSection: document.getElementById('webShareSection'),

    // ローディング & トースト
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toastContainer: document.getElementById('toastContainer')
  };

  // ==========================================
  // ユーティリティ
  // ==========================================

  // 安全なトースト通知表示 (XSS防止 textContent徹底)
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    elements.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ローディング表示切替
  function setLoading(show, text = '処理中...') {
    state.isProcessing = show;
    if (show) {
      elements.loadingText.textContent = text;
      elements.loadingOverlay.classList.remove('hidden');
    } else {
      elements.loadingOverlay.classList.add('hidden');
    }
  }

  // ページ数の更新
  function updateCounts() {
    const total = state.pages.length;
    elements.pageCountBadge.textContent = `${total} ページ`;

    if (total === 0) {
      elements.emptyState.classList.remove('hidden');
      elements.workspaceGrid.classList.add('hidden');
      elements.bulkActionBar.classList.add('hidden');
      elements.btnExportPdf.disabled = true;
      elements.btnSplitPdf.disabled = true;
    } else {
      elements.emptyState.classList.add('hidden');
      elements.workspaceGrid.classList.remove('hidden');
      elements.btnExportPdf.disabled = false;
      elements.btnSplitPdf.disabled = false;

      // 選択状態の更新
      const selCount = state.selectedIds.size;
      if (selCount > 0) {
        elements.bulkActionBar.classList.remove('hidden');
        elements.selectedCountText.textContent = `${selCount} 件選択中`;
      } else {
        elements.bulkActionBar.classList.add('hidden');
      }
    }
  }

  // ==========================================
  // ファイル取り込み処理
  // ==========================================

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    setLoading(true, 'ファイルを読み込み・解析中...');

    try {
      let addedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          setLoading(true, `PDF解析中 (${i + 1}/${files.length}): ${file.name}`);
          const pdfPages = await state.pdfEngine.loadPdfPages(file);
          state.pages.push(...pdfPages);
          addedCount += pdfPages.length;
        } else if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) {
          setLoading(true, `画像処理中 (${i + 1}/${files.length}): ${file.name}`);
          const imgPage = await state.pdfEngine.createImagePage(file);
          state.pages.push(imgPage);
          addedCount += 1;
        } else {
          showToast(`非対応ファイルのためスキップしました: ${file.name}`, 'warning');
        }
      }

      renderWorkspace();
      updateCounts();
      showToast(`${addedCount} ページを追加しました！`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`ファイルの読み込みに失敗しました: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // ワークスペース描画 (DOM構築 - textContent原則徹底)
  // ==========================================

  function renderWorkspace() {
    elements.workspaceGrid.textContent = ''; // 安全にクリア

    state.pages.forEach((page, index) => {
      const card = document.createElement('div');
      card.className = `page-card ${state.selectedIds.has(page.id) ? 'selected' : ''}`;
      card.dataset.id = page.id;
      card.dataset.index = index;
      card.draggable = true;

      // 1. ヘッダー (チェックボックス + ページ番号バッジ + ドラッグハンドル)
      const header = document.createElement('div');
      header.className = 'card-header';

      const checkLabel = document.createElement('label');
      checkLabel.className = 'checkbox-wrapper';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selectedIds.has(page.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedIds.add(page.id);
        } else {
          state.selectedIds.delete(page.id);
        }
        card.classList.toggle('selected', checkbox.checked);
        updateCounts();
      });
      checkLabel.appendChild(checkbox);

      const pageBadge = document.createElement('span');
      pageBadge.className = 'page-num-badge';
      pageBadge.textContent = `#${index + 1}`;

      const typeBadge = document.createElement('span');
      typeBadge.className = `type-badge ${page.sourceType}`;
      typeBadge.textContent = page.sourceType === 'image' ? '📸 レシート' : `📄 PDF p.${page.displayNumber}`;

      header.appendChild(checkLabel);
      header.appendChild(pageBadge);
      header.appendChild(typeBadge);

      // 2. サムネイル画像コンテナ
      const thumbContainer = document.createElement('div');
      thumbContainer.className = 'thumb-container';

      const img = document.createElement('img');
      img.src = page.thumbnailUrl;
      img.alt = `ページ ${index + 1}`;
      img.style.transform = `rotate(${page.rotation}deg)`;
      img.loading = 'lazy';
      thumbContainer.appendChild(img);

      // 3. アクションツールバー (mem_003: 44pxタップ領域)
      const toolbar = document.createElement('div');
      toolbar.className = 'card-toolbar';

      // 回転ボタン (+90°)
      const btnRotate = document.createElement('button');
      btnRotate.type = 'button';
      btnRotate.className = 'icon-btn';
      btnRotate.title = '90度右回転';
      btnRotate.textContent = '🔄 90°';
      btnRotate.addEventListener('click', (e) => {
        e.stopPropagation();
        rotatePage(page.id, 90);
      });

      // 前へ移動ボタン
      const btnMovePrev = document.createElement('button');
      btnMovePrev.type = 'button';
      btnMovePrev.className = 'icon-btn';
      btnMovePrev.title = '前へ移動';
      btnMovePrev.textContent = '⬅️';
      btnMovePrev.disabled = index === 0;
      btnMovePrev.addEventListener('click', (e) => {
        e.stopPropagation();
        movePage(index, index - 1);
      });

      // 次へ移動ボタン
      const btnMoveNext = document.createElement('button');
      btnMoveNext.type = 'button';
      btnMoveNext.className = 'icon-btn';
      btnMoveNext.title = '次へ移動';
      btnMoveNext.textContent = '➡️';
      btnMoveNext.disabled = index === state.pages.length - 1;
      btnMoveNext.addEventListener('click', (e) => {
        e.stopPropagation();
        movePage(index, index + 1);
      });

      // 削除ボタン
      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'icon-btn delete-btn';
      btnDelete.title = 'このページを削除';
      btnDelete.textContent = '🗑️';
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePage(page.id);
      });

      toolbar.appendChild(btnRotate);
      toolbar.appendChild(btnMovePrev);
      toolbar.appendChild(btnMoveNext);

      // 画像の場合のみ「レシート補正」ボタンを追加
      if (page.sourceType === 'image') {
        const btnEnhance = document.createElement('button');
        btnEnhance.type = 'button';
        btnEnhance.className = 'icon-btn enhance-btn';
        btnEnhance.title = 'レシートくっきり補正';
        btnEnhance.textContent = '✨ 補正';
        btnEnhance.addEventListener('click', (e) => {
          e.stopPropagation();
          openEnhanceModal(page.id);
        });
        toolbar.appendChild(btnEnhance);
      }

      toolbar.appendChild(btnDelete);

      // 組み立て
      card.appendChild(header);
      card.appendChild(thumbContainer);
      card.appendChild(toolbar);

      // ドラッグ＆ドロップイベント (並べ替え)
      setupCardDragAndDrop(card, index);

      elements.workspaceGrid.appendChild(card);
    });
  }

  // ==========================================
  // ページ操作ロジック
  // ==========================================

  function movePage(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= state.pages.length) return;
    const [moved] = state.pages.splice(fromIndex, 1);
    state.pages.splice(toIndex, 0, moved);
    renderWorkspace();
    updateCounts();
  }

  function rotatePage(pageId, deltaAngle = 90) {
    const page = state.pages.find(p => p.id === pageId);
    if (!page) return;
    page.rotation = (page.rotation + deltaAngle) % 360;
    renderWorkspace();
  }

  function deletePage(pageId) {
    state.pages = state.pages.filter(p => p.id !== pageId);
    state.selectedIds.delete(pageId);
    renderWorkspace();
    updateCounts();
    showToast('ページを削除しました', 'info');
  }

  // ==========================================
  // ドラッグ＆ドロップ並べ替え
  // ==========================================

  let draggedItemIndex = null;

  function setupCardDragAndDrop(card, index) {
    card.addEventListener('dragstart', (e) => {
      draggedItemIndex = index;
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      draggedItemIndex = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.page-card').forEach(c => c.classList.remove('drag-over'));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (draggedItemIndex === null || draggedItemIndex === index) return;
      movePage(draggedItemIndex, index);
    });
  }

  // ==========================================
  // 一括操作バー
  // ==========================================

  elements.btnSelectAll.addEventListener('click', () => {
    state.pages.forEach(p => state.selectedIds.add(p.id));
    renderWorkspace();
    updateCounts();
  });

  elements.btnDeselectAll.addEventListener('click', () => {
    state.selectedIds.clear();
    renderWorkspace();
    updateCounts();
  });

  elements.btnRotateSelected.addEventListener('click', () => {
    if (state.selectedIds.size === 0) return;
    state.pages.forEach(p => {
      if (state.selectedIds.has(p.id)) {
        p.rotation = (p.rotation + 90) % 360;
      }
    });
    renderWorkspace();
    showToast('選択したページを90度回転しました', 'success');
  });

  elements.btnDeleteSelected.addEventListener('click', () => {
    if (state.selectedIds.size === 0) return;
    const count = state.selectedIds.size;
    state.pages = state.pages.filter(p => !state.selectedIds.has(p.id));
    state.selectedIds.clear();
    renderWorkspace();
    updateCounts();
    showToast(`${count} ページを削除しました`, 'info');
  });

  elements.btnClearAll.addEventListener('click', () => {
    if (state.pages.length === 0) return;
    if (confirm('すべてのページを削除してワークスペースをクリアしますか？')) {
      state.pages = [];
      state.selectedIds.clear();
      renderWorkspace();
      updateCounts();
      showToast('ワークスペースをクリアしました', 'info');
    }
  });

  // ==========================================
  // 領収書画像補正モーダル (レシートスキャン)
  // ==========================================

  let currentEnhanceImg = null;
  let currentEnhanceRotation = 0;

  async function openEnhanceModal(pageId) {
    const page = state.pages.find(p => p.id === pageId);
    if (!page || page.sourceType !== 'image') return;

    state.enhancingPageId = pageId;
    setLoading(true, '補正プレビューを準備中...');

    try {
      currentEnhanceImg = await ImageEnhancer.loadImage(page.rawImageFile || page.thumbnailUrl);
      currentEnhanceRotation = page.rotation || 0;

      // 初期値リセット
      const preset = page.filters?.preset || 'receipt_bw';
      for (const radio of elements.enhancePresetRadios) {
        radio.checked = (radio.value === preset);
      }
      elements.enhanceBrightness.value = page.filters?.brightness || 0;
      elements.valBrightness.textContent = elements.enhanceBrightness.value;
      elements.enhanceContrast.value = page.filters?.contrast || 20;
      elements.valContrast.textContent = elements.enhanceContrast.value;

      updateEnhanceCanvasPreview();
      elements.enhanceModal.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showToast('画像の読み込みに失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  }

  function getSelectedPreset() {
    for (const radio of elements.enhancePresetRadios) {
      if (radio.checked) return radio.value;
    }
    return 'receipt_bw';
  }

  function updateEnhanceCanvasPreview() {
    if (!currentEnhanceImg) return;

    const preset = getSelectedPreset();
    const brightness = parseInt(elements.enhanceBrightness.value, 10);
    const contrast = parseInt(elements.enhanceContrast.value, 10);

    const processed = ImageEnhancer.processImage(currentEnhanceImg, {
      preset,
      brightness,
      contrast,
      rotation: currentEnhanceRotation,
      maxWidth: 800 // プレビュー用高速化
    });

    const canvas = elements.enhanceCanvas;
    canvas.width = processed.width;
    canvas.height = processed.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(processed, 0, 0);
  }

  // プリセット変更イベント
  for (const radio of elements.enhancePresetRadios) {
    radio.addEventListener('change', updateEnhanceCanvasPreview);
  }
  // スライダー変更イベント
  elements.enhanceBrightness.addEventListener('input', () => {
    elements.valBrightness.textContent = elements.enhanceBrightness.value;
    updateEnhanceCanvasPreview();
  });
  elements.enhanceContrast.addEventListener('input', () => {
    elements.valContrast.textContent = elements.enhanceContrast.value;
    updateEnhanceCanvasPreview();
  });
  // 90度回転ボタン
  elements.btnEnhanceRotate.addEventListener('click', () => {
    currentEnhanceRotation = (currentEnhanceRotation + 90) % 360;
    updateEnhanceCanvasPreview();
  });

  // 補正適用
  elements.btnEnhanceApply.addEventListener('click', async () => {
    const page = state.pages.find(p => p.id === state.enhancingPageId);
    if (!page) return;

    setLoading(true, '補正を適用中...');
    try {
      const preset = getSelectedPreset();
      const brightness = parseInt(elements.enhanceBrightness.value, 10);
      const contrast = parseInt(elements.enhanceContrast.value, 10);

      page.filters = { preset, brightness, contrast };
      page.rotation = currentEnhanceRotation;

      // フル解像度キャンバスから新しいBlobとサムネイルを再生成
      const fullCanvas = ImageEnhancer.processImage(currentEnhanceImg, {
        preset,
        brightness,
        contrast,
        rotation: 0 // rotationはPDFLibで適用するため原寸Blob側は0で保持
      });
      page.imageBlob = await ImageEnhancer.canvasToBlob(fullCanvas, 'image/jpeg', 0.92);

      // サムネイル再生成
      const thumbCanvas = ImageEnhancer.processImage(currentEnhanceImg, {
        preset,
        brightness,
        contrast,
        rotation: 0,
        maxWidth: 400
      });
      page.thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);

      elements.enhanceModal.classList.add('hidden');
      renderWorkspace();
      showToast('領収書の補正を適用しました！', 'success');
    } catch (err) {
      console.error(err);
      showToast('補正の適用に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  });

  elements.btnEnhanceCancel.addEventListener('click', () => {
    elements.enhanceModal.classList.add('hidden');
  });

  // ==========================================
  // PDF書き出し & プレビュー
  // ==========================================

  let currentExportBlob = null;

  async function generateExportPdf() {
    if (state.pages.length === 0) {
      showToast('出力するページがありません', 'warning');
      return;
    }

    setLoading(true, 'PDFを結合・生成中...');
    try {
      const pageSize = elements.exportPageSizeSelect.value;
      const pdfBytes = await state.pdfEngine.buildPdf(state.pages, { pageSize });
      currentExportBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(currentExportBlob);

      elements.exportPdfFrame.src = blobUrl;
      elements.exportModal.classList.remove('hidden');
      showToast('PDFの生成が完了しました！', 'success');
    } catch (err) {
      console.error(err);
      showToast(`PDF生成エラー: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  elements.btnExportPdf.addEventListener('click', generateExportPdf);

  elements.exportPageSizeSelect.addEventListener('change', () => {
    if (!elements.exportModal.classList.contains('hidden')) {
      generateExportPdf();
    }
  });

  elements.btnDownloadPdf.addEventListener('click', () => {
    if (!currentExportBlob) return;
    const title = (elements.docTitleInput.value.trim() || '領収書まとめ') + '.pdf';
    downloadBlob(currentExportBlob, title);
    showToast(`「${title}」をダウンロードしました`, 'success');
  });

  elements.btnCloseExportModal.addEventListener('click', () => {
    elements.exportModal.classList.add('hidden');
  });

  // 選択ページの抽出
  elements.btnExtractSelected.addEventListener('click', async () => {
    if (state.selectedIds.size === 0) return;
    setLoading(true, '選択ページを抽出してPDF生成中...');

    try {
      const pageSize = elements.exportPageSizeSelect.value;
      const pdfBytes = await state.pdfEngine.extractPages(
        state.pages,
        Array.from(state.selectedIds),
        { pageSize }
      );
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const title = `${elements.docTitleInput.value.trim() || '領収書'}_抽出_${state.selectedIds.size}枚.pdf`;
      downloadBlob(blob, title);
      showToast(`選択した${state.selectedIds.size}枚を抽出・保存しました！`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`抽出エラー: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  // ==========================================
  // 共有・送信処理 (Web Share API, Gmail, Chatwork, Google Drive)
  // ==========================================

  let currentShareTarget = {
    blob: null,
    title: '領収書まとめ.pdf',
    pageCount: 1
  };

  function openShareDialog(blob, title, pageCount) {
    currentShareTarget = { blob, title, pageCount };

    // Web Share API のファイル共有対応確認
    if (navigator.share) {
      elements.webShareSection.classList.remove('hidden');
    } else {
      elements.webShareSection.classList.add('hidden');
    }

    elements.shareModal.classList.remove('hidden');
  }

  // プレビューモーダル内の「共有」ボタン
  elements.btnOpenShareModal.addEventListener('click', () => {
    if (!currentExportBlob) return;
    const title = (elements.docTitleInput.value.trim() || '領収書まとめ') + '.pdf';
    openShareDialog(currentExportBlob, title, state.pages.length);
  });

  // 一括バーの「選択分を共有」ボタン
  elements.btnShareSelected.addEventListener('click', async () => {
    if (state.selectedIds.size === 0) return;
    setLoading(true, '選択ページをPDF化して共有準備中...');

    try {
      const pageSize = elements.exportPageSizeSelect.value;
      const pdfBytes = await state.pdfEngine.extractPages(
        state.pages,
        Array.from(state.selectedIds),
        { pageSize }
      );
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const title = `${elements.docTitleInput.value.trim() || '領収書'}_抽出_${state.selectedIds.size}枚.pdf`;
      openShareDialog(blob, title, state.selectedIds.size);
    } catch (err) {
      console.error(err);
      showToast(`共有準備エラー: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  // モーダル閉じる
  elements.btnCloseShareModal.addEventListener('click', () => elements.shareModal.classList.add('hidden'));
  elements.btnCancelShareModal.addEventListener('click', () => elements.shareModal.classList.add('hidden'));

  // 1. スマホネイティブ共有 (Web Share API - Gmail/Chatwork/Drive等へ直接添付)
  elements.btnNativeShare.addEventListener('click', async () => {
    if (!currentShareTarget.blob) return;

    try {
      const file = new File([currentShareTarget.blob], currentShareTarget.title, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: currentShareTarget.title,
          text: `領収書PDF（${currentShareTarget.title}）を送付します。`
        });
        showToast('共有が完了しました！', 'success');
      } else if (navigator.share) {
        await navigator.share({
          title: currentShareTarget.title,
          text: `領収書PDF（${currentShareTarget.title}）を作成しました。`
        });
      } else {
        showToast('お使いのブラウザはネイティブ共有に対応していません', 'warning');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        showToast('共有がキャンセルまたは失敗しました', 'info');
      }
    }
  });

  // 2. Gmail作成画面
  elements.btnShareGmail.addEventListener('click', () => {
    const subject = `【領収書PDF提出】${currentShareTarget.title}`;
    const body = `ご担当者様\n\nお疲れ様です。\n領収書（全${currentShareTarget.pageCount}枚）のPDFを作成いたしました。\n\nドキュメント名: ${currentShareTarget.title}\n作成日: ${new Date().toLocaleDateString('ja-JP')}\n\nPDFファイルをダウンロード・添付の上、ご確認のほどよろしくお願いいたします。`;

    // Gmail Web作成URL
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');

    // PDFダウンロードも同時に実行
    if (currentShareTarget.blob) {
      downloadBlob(currentShareTarget.blob, currentShareTarget.title);
      showToast('Gmailを開きました！ダウンロードされたPDFを添付してください', 'success');
    }
  });

  // 3. Chatwork報告文コピー & 起動
  elements.btnCopyChatworkText.addEventListener('click', async () => {
    const chatworkText = `[info][title]領収書PDF提出[/title]お疲れ様です。\n領収書PDF（全${currentShareTarget.pageCount}枚）を作成しました。\nファイル名: ${currentShareTarget.title}\n作成日: ${new Date().toLocaleDateString('ja-JP')}\n添付ファイルのご確認よろしくお願いいたします。[/info]`;

    try {
      await navigator.clipboard.writeText(chatworkText);
      showToast('Chatwork用の提出文をクリップボードにコピーしました！', 'success');
    } catch (err) {
      showToast('テキストのコピーに失敗しました', 'error');
    }
  });

  elements.btnOpenChatwork.addEventListener('click', () => {
    window.open('https://www.chatwork.com/', '_blank');
    if (currentShareTarget.blob) {
      downloadBlob(currentShareTarget.blob, currentShareTarget.title);
      showToast('Chatworkを開きました！PDFをドラッグして送信してください', 'info');
    }
  });

  // 4. Google Drive
  elements.btnOpenGoogleDrive.addEventListener('click', () => {
    window.open('https://drive.google.com/drive/my-drive', '_blank');
    if (currentShareTarget.blob) {
      downloadBlob(currentShareTarget.blob, currentShareTarget.title);
      showToast('Googleドライブを開きました！PDFをドラッグして保存してください', 'info');
    }
  });

  // ==========================================
  // PDF分割モーダル
  // ==========================================

  elements.btnSplitPdf.addEventListener('click', () => {
    if (state.pages.length <= 1) {
      showToast('分割するには2ページ以上必要です', 'warning');
      return;
    }
    renderSplitPreview();
    elements.splitModal.classList.remove('hidden');
  });

  function renderSplitPreview() {
    elements.splitPreviewList.textContent = '';
    state.pages.forEach((page, idx) => {
      const item = document.createElement('div');
      item.className = 'split-page-row';

      const label = document.createElement('span');
      label.textContent = `ページ ${idx + 1} (${page.sourceType === 'image' ? 'レシート' : 'PDF'})`;
      item.appendChild(label);

      if (idx < state.pages.length - 1) {
        const splitToggle = document.createElement('button');
        splitToggle.type = 'button';
        splitToggle.className = 'btn btn-outline btn-split-toggle';
        splitToggle.textContent = '✂️ ここで前後に分割';
        splitToggle.addEventListener('click', async () => {
          elements.splitModal.classList.add('hidden');
          await executeSplitAt([idx]);
        });
        item.appendChild(splitToggle);
      }

      elements.splitPreviewList.appendChild(item);
    });
  }

  async function executeSplitAt(splitIndices) {
    setLoading(true, 'PDFを分割中...');
    try {
      const pageSize = elements.exportPageSizeSelect.value;
      const parts = await state.pdfEngine.splitPdf(state.pages, splitIndices, { pageSize });
      for (const part of parts) {
        const blob = new Blob([part.bytes], { type: 'application/pdf' });
        downloadBlob(blob, `${elements.docTitleInput.value || '分割'}_${part.name}`);
      }
      showToast(`${parts.length} 個のPDFに分割してダウンロードしました！`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`分割エラー: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // 全ページを1枚ずつバラバラに分割
  elements.btnConfirmSplitAll.addEventListener('click', async () => {
    elements.splitModal.classList.add('hidden');
    setLoading(true, '全ページを1枚ずつ分割保存中...');
    try {
      const pageSize = elements.exportPageSizeSelect.value;
      const parts = await state.pdfEngine.splitAllPages(state.pages, { pageSize });
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const blob = new Blob([part.bytes], { type: 'application/pdf' });
        downloadBlob(blob, `${elements.docTitleInput.value || '領収書'}_${part.name}`);
        // ブラウザ連続DLの制限対策に微小ディレイ
        await new Promise(r => setTimeout(r, 200));
      }
      showToast(`全 ${parts.length} ページを個別に保存しました！`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`分割エラー: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  elements.btnCancelSplit.addEventListener('click', () => {
    elements.splitModal.classList.add('hidden');
  });

  // ダウンロード実行ヘルパー
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ==========================================
  // イベントリスナー設定 (入力トリガー & D&D)
  // ==========================================

  // カメラ撮影
  elements.btnCamera.addEventListener('click', () => elements.cameraInput.click());
  elements.cameraInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = ''; // リセット
  });

  // 画像ファイル選択
  elements.btnSelectImage.addEventListener('click', () => elements.imageInput.click());
  elements.imageInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  // PDFファイル選択
  elements.btnSelectPdf.addEventListener('click', () => elements.pdfInput.click());
  elements.pdfInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  // ドラッグ＆ドロップ (全体・ドロップゾーン)
  ['dragenter', 'dragover'].forEach(name => {
    elements.dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      elements.dropZone.classList.add('drag-active');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    elements.dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      elements.dropZone.classList.remove('drag-active');
    });
  });

  elements.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // 初期化実行
  updateCounts();
});
