/**
 * PDFEngine: PDF結合・分割・抽出・回転・生成エンジン
 * pdf-lib と pdf.js を連携させ、端末内完結でPDFの全操作を実現します。
 */
class PDFEngine {
  constructor() {
    this.isPdfLibReady = false;
    this.isPdfJsReady = false;
    this._initCheck();
  }

  _initCheck() {
    if (window.PDFLib) {
      this.isPdfLibReady = true;
    }
    if (window.pdfjsLib) {
      this.isPdfJsReady = true;
      // ワーカーパス設定 (ローカルのvendor/を優先しオフライン完全対応)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    }
  }

  /**
   * PDFファイルを読み込み、全ページのサムネイルとメタデータを抽出
   * @param {File|ArrayBuffer} fileOrBuffer
   * @returns {Promise<Array<Object>>}
   */
  async loadPdfPages(fileOrBuffer) {
    if (!window.pdfjsLib) {
      throw new Error('PDF.jsライブラリが読み込まれていません');
    }

    let arrayBuffer;
    let fileName = 'document.pdf';
    if (fileOrBuffer instanceof File) {
      fileName = fileOrBuffer.name;
      arrayBuffer = await fileOrBuffer.arrayBuffer();
    } else {
      arrayBuffer = fileOrBuffer;
    }

    // PDFドキュメント読み込み
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const pages = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });

      // サムネイル用Canvasレンダリング (最大幅400pxに縮小)
      const scale = Math.min(1.5, 400 / viewport.width);
      const thumbViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = thumbViewport.width;
      canvas.height = thumbViewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport: thumbViewport
      }).promise;

      const thumbUrl = canvas.toDataURL('image/jpeg', 0.85);

      pages.push({
        id: 'page_' + Math.random().toString(36).substring(2, 10),
        sourceType: 'pdf',
        fileName: fileName,
        originalPageIndex: i - 1, // 0-indexed for pdf-lib
        displayNumber: i,
        totalPagesInSource: numPages,
        thumbnailUrl: thumbUrl,
        rotation: 0, // ユーザーによる追加回転 (0, 90, 180, 270)
        originalRotation: page.rotate || 0,
        width: viewport.width,
        height: viewport.height,
        pdfBytes: arrayBuffer.slice(0), // コピーを保持
        isSelected: false
      });
    }

    return pages;
  }

  /**
   * 画像ファイルからページオブジェクトを生成
   * @param {File|Blob} imageFile
   * @param {Object} [filterOptions] - 補正オプション
   * @returns {Promise<Object>}
   */
  async createImagePage(imageFile, filterOptions = {}) {
    const img = await ImageEnhancer.loadImage(imageFile);
    
    // サムネイル生成
    const thumbCanvas = ImageEnhancer.processImage(img, {
      ...filterOptions,
      maxWidth: 400
    });
    const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);

    // フル解像度Canvas生成
    const fullCanvas = ImageEnhancer.processImage(img, filterOptions);
    const processedBlob = await ImageEnhancer.canvasToBlob(fullCanvas, 'image/jpeg', 0.92);

    return {
      id: 'img_' + Math.random().toString(36).substring(2, 10),
      sourceType: 'image',
      fileName: imageFile.name || '領収書_' + new Date().toISOString().slice(0, 10) + '.jpg',
      displayNumber: 1,
      thumbnailUrl: thumbnailUrl,
      rotation: filterOptions.rotation || 0,
      width: fullCanvas.width,
      height: fullCanvas.height,
      imageBlob: processedBlob,
      rawImageFile: imageFile,
      filters: filterOptions,
      isSelected: false
    };
  }

  /**
   * 編集されたページリストから単一のPDFを構築
   * @param {Array<Object>} pages - 並べ替えや回転が反映されたページ配列
   * @param {Object} [options]
   * @param {string} [options.pageSize='fit'] - 'fit' (元サイズ) | 'a4' (A4用紙に最適化配置)
   * @returns {Promise<Uint8Array>}
   */
  async buildPdf(pages, options = { pageSize: 'fit' }) {
    if (!window.PDFLib) {
      throw new Error('pdf-libライブラリが読み込まれていません');
    }
    const { PDFDocument, degrees, PageSizes } = window.PDFLib;

    const mergedPdf = await PDFDocument.create();

    // キャッシュ: 同一元PDFバイナリのロードを1回にまとめる
    const loadedPdfDocs = new Map();

    for (const pageItem of pages) {
      if (pageItem.sourceType === 'pdf') {
        // PDFページのコピー
        let srcPdfDoc = loadedPdfDocs.get(pageItem.pdfBytes);
        if (!srcPdfDoc) {
          srcPdfDoc = await PDFDocument.load(pageItem.pdfBytes);
          loadedPdfDocs.set(pageItem.pdfBytes, srcPdfDoc);
        }

        const [copiedPage] = await mergedPdf.copyPages(srcPdfDoc, [pageItem.originalPageIndex]);
        
        // 回転の適用 (元の回転 + ユーザー回転)
        const currentRot = copiedPage.getRotation().angle;
        copiedPage.setRotation(degrees((currentRot + pageItem.rotation) % 360));
        
        mergedPdf.addPage(copiedPage);

      } else if (pageItem.sourceType === 'image') {
        // 画像をPDFページへ埋め込み
        let imgBlob = pageItem.imageBlob;
        // フィルタや回転の再計算が必要な場合
        if (!imgBlob || pageItem.rotation !== 0) {
          const img = await ImageEnhancer.loadImage(pageItem.rawImageFile || pageItem.thumbnailUrl);
          const canvas = ImageEnhancer.processImage(img, {
            ...pageItem.filters,
            rotation: pageItem.rotation
          });
          imgBlob = await ImageEnhancer.canvasToBlob(canvas, 'image/jpeg', 0.92);
        }

        const imgArrayBuffer = await imgBlob.arrayBuffer();
        const embeddedImage = await mergedPdf.embedJpg(imgArrayBuffer);
        const imgDims = embeddedImage.scale(1.0);

        if (options.pageSize === 'a4') {
          // A4用紙 (595.28 x 841.89 pt) の中央に収まるよう配置
          const a4Page = mergedPdf.addPage(PageSizes.A4);
          const a4Width = PageSizes.A4[0];
          const a4Height = PageSizes.A4[1];

          // マージン20pt
          const margin = 20;
          const maxW = a4Width - margin * 2;
          const maxH = a4Height - margin * 2;
          const scaleFactor = Math.min(maxW / imgDims.width, maxH / imgDims.height, 1.0);

          const drawW = imgDims.width * scaleFactor;
          const drawH = imgDims.height * scaleFactor;
          const x = (a4Width - drawW) / 2;
          const y = (a4Height - drawH) / 2;

          a4Page.drawImage(embeddedImage, {
            x: x,
            y: y,
            width: drawW,
            height: drawH
          });
        } else {
          // 画像サイズそのままのページを作成（レシート等の縦長に最適）
          const page = mergedPdf.addPage([imgDims.width, imgDims.height]);
          page.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: imgDims.width,
            height: imgDims.height
          });
        }
      }
    }

    return await mergedPdf.save();
  }

  /**
   * 選択されたページのみを抽出してPDF生成
   * @param {Array<Object>} allPages
   * @param {Array<string>} selectedIds
   * @param {Object} [options]
   * @returns {Promise<Uint8Array>}
   */
  async extractPages(allPages, selectedIds, options) {
    const selectedSet = new Set(selectedIds);
    const pagesToExtract = allPages.filter(p => selectedSet.has(p.id));
    if (pagesToExtract.length === 0) {
      throw new Error('抽出するページが選択されていません');
    }
    return await this.buildPdf(pagesToExtract, options);
  }

  /**
   * 指定した位置でPDFを複数に分割
   * @param {Array<Object>} allPages
   * @param {Array<number>} splitAfterIndices - このインデックスの直後で分割 (0-indexed)
   * @param {Object} [options]
   * @returns {Promise<Array<{ name: string, bytes: Uint8Array, pageCount: number }>>}
   */
  async splitPdf(allPages, splitAfterIndices, options) {
    if (allPages.length === 0) return [];

    const sortedSplits = [...new Set(splitAfterIndices)]
      .filter(idx => idx >= 0 && idx < allPages.length - 1)
      .sort((a, b) => a - b);

    const parts = [];
    let startIdx = 0;

    for (let i = 0; i <= sortedSplits.length; i++) {
      const endIdx = (i < sortedSplits.length) ? sortedSplits[i] + 1 : allPages.length;
      const slicePages = allPages.slice(startIdx, endIdx);
      if (slicePages.length > 0) {
        const bytes = await this.buildPdf(slicePages, options);
        parts.push({
          name: `part_${i + 1}_p${startIdx + 1}-p${endIdx}.pdf`,
          bytes: bytes,
          pageCount: slicePages.length,
          startPage: startIdx + 1,
          endPage: endIdx
        });
      }
      startIdx = endIdx;
    }

    return parts;
  }

  /**
   * 全ページを1枚ずつ個別のPDFに分解
   * @param {Array<Object>} allPages
   * @param {Object} [options]
   * @returns {Promise<Array<{ name: string, bytes: Uint8Array }>>}
   */
  async splitAllPages(allPages, options) {
    const results = [];
    for (let i = 0; i < allPages.length; i++) {
      const page = allPages[i];
      const bytes = await this.buildPdf([page], options);
      results.push({
        name: `page_${String(i + 1).padStart(3, '0')}.pdf`,
        bytes: bytes
      });
    }
    return results;
  }
}

// グローバル公開
window.PDFEngine = PDFEngine;
