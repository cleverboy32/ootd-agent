import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Utility 1: Convert a File to a Base64 string
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // result is a data URL (e.g., "data:image/jpeg;base64,xxxx..."), we only need the base64 part
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Define the structure for the callbacks that the stream processor will use
export interface StreamHandlers {
  onTextChunk: (text: string) => void;
  onImageGenerated: (data: { imageUrl: string; alt: string }) => void;
  onError: (message: string) => void;
  onStreamEnd: (message: string) => void;
}

