/**
 * ImageEnhancer: 領収書・レシート画像補正モジュール
 * 純粋なHTML5 Canvas APIを用いて、撮影した領収書の文字をくっきり白黒化・コントラスト補正します。
 */
class ImageEnhancer {
  /**
   * 画像ファイルまたはBlobからImageオブジェクトを生成
   * @param {Blob|File|string} source
   * @returns {Promise<HTMLImageElement>}
   */
  static async loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(new Error('画像の読み込みに失敗しました'));

      if (typeof source === 'string') {
        img.src = source;
      } else {
        const url = URL.createObjectURL(source);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.src = url;
      }
    });
  }

  /**
   * 画像を補正してCanvasに描画
   * @param {HTMLImageElement} img 
   * @param {Object} options
   * @param {string} options.preset - 'original' | 'receipt_bw' | 'high_contrast' | 'grayscale'
   * @param {number} options.brightness - -100 to 100 (デフォルト0)
   * @param {number} options.contrast - -100 to 100 (デフォルト0)
   * @param {number} options.rotation - 0, 90, 180, 270
   * @param {number} [options.maxWidth] - 最大幅制限（サムネイル等の縮小用）
   * @returns {HTMLCanvasElement}
   */
  static processImage(img, options = {}) {
    const {
      preset = 'original',
      brightness = 0,
      contrast = 0,
      rotation = 0,
      maxWidth = null
    } = options;

    let targetWidth = img.naturalWidth || img.width;
    let targetHeight = img.naturalHeight || img.height;

    // 縮小リサイズ処理（サムネイル用）
    if (maxWidth && targetWidth > maxWidth) {
      const scale = maxWidth / targetWidth;
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 回転に応じたキャンバスサイズ設定
    const isSideways = (rotation % 180 !== 0);
    canvas.width = isSideways ? targetHeight : targetWidth;
    canvas.height = isSideways ? targetWidth : targetHeight;

    ctx.save();
    // 回転の中心を合わせる
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
    ctx.restore();

    // フィルタ処理
    if (preset !== 'original' || brightness !== 0 || contrast !== 0) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // コントラスト係数計算
      // factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
      const adjContrast = Math.max(-100, Math.min(100, contrast));
      const factor = (259 * (adjContrast + 255)) / (255 * (259 - adjContrast));
      const adjBrightness = Math.max(-100, Math.min(100, brightness));

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // 1. 明るさ調整
        if (adjBrightness !== 0) {
          r = Math.min(255, Math.max(0, r + adjBrightness));
          g = Math.min(255, Math.max(0, g + adjBrightness));
          b = Math.min(255, Math.max(0, b + adjBrightness));
        }

        // 2. コントラスト調整
        if (adjContrast !== 0) {
          r = Math.min(255, Math.max(0, factor * (r - 128) + 128));
          g = Math.min(255, Math.max(0, factor * (g - 128) + 128));
          b = Math.min(255, Math.max(0, factor * (b - 128) + 128));
        }

        // 3. プリセットに応じた領収書特化フィルタ
        if (preset === 'grayscale') {
          // 標準グレースケール
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        } else if (preset === 'receipt_bw') {
          // 🧾 レシートくっきりモード（文字を濃く、背景を白く飛ばす高品位二値化/適応調階）
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          // 背景の薄い影を取り除き文字を強調
          let finalVal;
          if (gray > 165) {
            finalVal = 255; // 紙の地色をクリアな白へ
          } else if (gray < 85) {
            finalVal = 0;   // 印字されたインクを真っ黒へ
          } else {
            // 中間調をS字カーブでコントラスト強化
            const normalized = (gray - 85) / 80;
            finalVal = normalized * normalized * 255;
          }
          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        } else if (preset === 'high_contrast') {
          // 📈 高コントラストカラー（カラーレシートや印鑑・スタンプの赤を残す）
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const boost = gray > 180 ? 30 : -20;
          data[i] = Math.min(255, Math.max(0, r + boost));
          data[i + 1] = Math.min(255, Math.max(0, g + boost));
          data[i + 2] = Math.min(255, Math.max(0, b + boost));
        } else {
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }

    return canvas;
  }

  /**
   * CanvasからBlobを非同期取得
   * @param {HTMLCanvasElement} canvas
   * @param {string} [type='image/jpeg']
   * @param {number} [quality=0.88]
   * @returns {Promise<Blob>}
   */
  static canvasToBlob(canvas, type = 'image/jpeg', quality = 0.88) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });
  }
}

// グローバル公開 (Vanilla JS / ブラウザ環境)
window.ImageEnhancer = ImageEnhancer;
