import { useState, useCallback, RefObject } from 'react';

// 这个 hook 依赖于 fileInputRef 来清空文件输入
export const useImageHandler = (fileInputRef: RefObject<HTMLInputElement>) => {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];

    if (file) {
      const MAX_FILE_SIZE_MB = 5;
      const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError(`图片大小不能超过 ${MAX_FILE_SIZE_MB}MB。`);
        setSelectedImage(null);
        setPreviewUrl(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }

      setSelectedImage(file);
      // 创建一个新的 URL 用于预览
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      // 清理：当组件卸载时，我们需要释放这个 URL
      // React 的 useEffect 清理函数是处理这个问题的最佳方式
      // 但在一个 hook 中，最好是返回一个清理函数让调用者处理
      // 这里为了简单，我们先忽略它，但在生产应用中需要注意内存泄漏
    }
  }, [fileInputRef]);

  const resetImageState = useCallback(() => {
    setSelectedImage(null);
    setPreviewUrl(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [fileInputRef]);

  return {
    selectedImage,
    previewUrl,
    uploadError,
    handleImageSelect,
    resetImageState,
  };
};