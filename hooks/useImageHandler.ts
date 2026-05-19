import { useState, useCallback, useEffect } from 'react';
import { uploadFileToGCS } from '@/lib/utils';

export const useImageHandler = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null); // 存储上传后的 URL

  // 当用户选择新文件时触发
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // 重置所有旧状态
    setUploadError(null);
    setUploadedImageUrl(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    const file = e.target.files?.[0];

    if (file) {
      // 文件大小验证
      const MAX_FILE_SIZE_MB = 5;
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setUploadError(`图片大小不能超过 ${MAX_FILE_SIZE_MB}MB。`);
        setSelectedFile(null);
        setPreviewUrl(null);
        return;
      }

      // 设置新文件和预览
      setSelectedFile(file);
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
    } else {
      setSelectedFile(null);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  // [核心逻辑] 使用 useEffect 监听 selectedFile 的变化，自动开始上传
  useEffect(() => {
    // 定义一个异步函数来执行上传
    const performUpload = async () => {
      if (!selectedFile) return;

      setIsUploading(true);
      setUploadError(null);
      
      try {
        const imageUrl = await uploadFileToGCS(selectedFile);
        setUploadedImageUrl(imageUrl);
      } catch (e) {
        const error = e as Error;
        console.error('Upload failed in useEffect:', error);
        setUploadError(error.message || '上传失败，请重新选择图片。');
        // 上传失败时，清除选择，让用户可以重试
        setSelectedFile(null);
        setPreviewUrl(null);
      } finally {
        setIsUploading(false);
      }
    };

    performUpload();

    // 清理函数，在组件卸载或 selectedFile 变化时运行
    // 这里我们不需要特别的清理，因为上传是异步的
  }, [selectedFile]);

  // 重置所有状态的函数
  const resetImageState = useCallback(() => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setUploadError(null);
    setIsUploading(false);
    setUploadedImageUrl(null);
  }, [previewUrl]);

  return {
    previewUrl,
    uploadError,
    isUploading,
    uploadedImageUrl, // 导出上传后的 URL
    handleFileSelect,
    resetImageState,
  };
};