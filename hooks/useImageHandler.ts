import { useState, useCallback, useMemo } from 'react';
import { uploadFileToCOS } from '@/lib/utils';
import { MAX_PURCHASE_UPLOADS } from '@/lib/purchaseUploads';

const MAX_FILE_SIZE_MB = 5;

export interface ChatUpload {
  id: string;
  previewUrl: string;
  uploadedUrl: string | null;
}

export const useImageHandler = () => {
  const [uploads, setUploads] = useState<ChatUpload[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const isUploading = uploads.some((item) => !item.uploadedUrl);
  const uploadedImageUrls = useMemo(
    () => uploads.flatMap((item) => (item.uploadedUrl ? [item.uploadedUrl] : [])),
    [uploads]
  );

  const removeUpload = useCallback((id: string) => {
    setUploads((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    setUploadError(null);
    setUploads((current) => {
      const room = MAX_PURCHASE_UPLOADS - current.length;
      if (room <= 0) {
        setUploadError(`一次最多上传 ${MAX_PURCHASE_UPLOADS} 件单品。`);
        return current;
      }
      const accepted = files.slice(0, room);
      if (files.length > room) {
        setUploadError(`一次最多上传 ${MAX_PURCHASE_UPLOADS} 件单品。`);
      }
      const next = [...current];
      for (const file of accepted) {
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          setUploadError(`图片大小不能超过 ${MAX_FILE_SIZE_MB}MB。`);
          continue;
        }
        const id = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        next.push({ id, previewUrl, uploadedUrl: null });
        void uploadFileToCOS(file)
          .then((uploadedUrl) => {
            setUploads((latest) =>
              latest.map((item) => (item.id === id ? { ...item, uploadedUrl } : item))
            );
          })
          .catch((error: Error) => {
            console.error('Upload failed:', error);
            setUploadError(error.message || '上传失败，请重新选择图片。');
            setUploads((latest) => {
              const failed = latest.find((item) => item.id === id);
              if (failed) URL.revokeObjectURL(failed.previewUrl);
              return latest.filter((item) => item.id !== id);
            });
          });
      }
      return next;
    });
  }, []);

  const resetImageState = useCallback(() => {
    setUploads((current) => {
      for (const item of current) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
    setUploadError(null);
  }, []);

  return {
    uploads,
    uploadError,
    isUploading,
    uploadedImageUrls,
    previewUrl: uploads[0]?.previewUrl ?? null,
    uploadedImageUrl: uploadedImageUrls[0] ?? null,
    handleFileSelect,
    removeUpload,
    resetImageState,
  };
};
