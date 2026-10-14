export async function prepareEventLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)
    throw new Error('请选择 2 MB 以内的 PNG、JPEG 或 WebP 图片');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 16777216
    )
      throw new Error('图片尺寸过大，请选择较小的 Logo 图片');
    const canvas = document.createElement('canvas'),
      context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理图片，请更换浏览器');
    let scale = Math.min(1, 360 / image.naturalWidth, 96 / image.naturalHeight);
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png');
      if (png.startsWith('data:image/png;base64,') && png.length <= 32789) return png;
      scale *= 0.75;
    }
    throw new Error('图片压缩后仍过大，请选择更简洁的 Logo');
  } finally {
    URL.revokeObjectURL(url);
  }
}
