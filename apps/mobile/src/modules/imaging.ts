import { Platform } from 'react-native';

export function rotateImage(src: Uint8Array, angle: '0' | '90' | '180' | '270') {
  // Canvas + <img> only exist on web. On native, hand back the raw JPEG
  // bytes; the render layer can apply a CSS transform if the orientation
  // metadata says the image is upside-down.
  if (Platform.OS !== 'web') {
    return Promise.resolve(src);
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([src as BlobPart], { type: 'image/jpeg' }));
    img.onload = () => {
      if (angle === '0') {
        URL.revokeObjectURL(url);
        resolve(src);
        return;
      }
      const swap = angle === '90' || angle === '270';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject('2d canvas context unavailable');
        return;
      }
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(angle === '90' ? Math.PI / 2 : angle === '180' ? Math.PI : Math.PI * 1.5);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(new Uint8Array(reader.result as ArrayBuffer));
          };
          reader.onerror = () => reject(reader.error ?? 'FileReader failed');
          reader.readAsArrayBuffer(blob);
        } else {
          reject('Failed to rotate image');
        }
      }, 'image/jpeg');
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      console.error('rotateImage: failed to load image blob', e);
      reject(e);
    };
    img.src = url;
  });
}
