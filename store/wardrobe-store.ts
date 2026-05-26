import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export type UploadStatus = 'queue' | 'uploading' | 'analyzing' | 'success' | 'error';

export interface UploadableFile {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string | null;
  publicUrl?: string | null;
}

// The core architectural change: from an array to an object-based map.
interface WardrobeState {
  filesById: { [id: string]: UploadableFile };
  fileIds: string[]; // To maintain insertion order

  addFiles: (newFiles: File[]) => void;
  updateFileStatus: (id:string, updates: Partial<Omit<UploadableFile, 'id' | 'file'>>) => void;
  removeFile: (id: string) => void;
  retryFile: (id: string) => void;
  clearSuccessful: () => void;
  reset: () => void;
}

export const useWardrobeStore = create<WardrobeState>((set, get) => ({
  filesById: {},
  fileIds: [],

  addFiles: (newFiles: File[]) => {
    const newFilesById: { [id: string]: UploadableFile } = {};
    const newFileIds: string[] = [];

    newFiles.forEach(file => {
      const id = uuidv4();
      newFileIds.push(id);
      newFilesById[id] = {
        id,
        file,
        status: 'queue',
      };
    });

    set(state => ({
      filesById: { ...state.filesById, ...newFilesById },
      fileIds: [...state.fileIds, ...newFileIds],
    }));
  },

  updateFileStatus: (id, updates) => {
    set(state => {
      if (!state.filesById[id]) {
        return state; // Do nothing if the file doesn't exist
      }
      return {
        filesById: {
          ...state.filesById,
          [id]: { // Precisely update only one item
            ...state.filesById[id],
            ...updates,
          },
        },
      };
    });
  },

  removeFile: (id) => {
    set(state => {
      if (!state.filesById[id]) {
        return state;
      }
      const newFilesById = { ...state.filesById };
      delete newFilesById[id];
      const newFileIds = state.fileIds.filter(fileId => fileId !== id);

      return {
        filesById: newFilesById,
        fileIds: newFileIds,
      };
    });
  },

  retryFile: (id) => {
    get().updateFileStatus(id, { status: 'queue', error: null });
  },

  clearSuccessful: () => {
    set(state => {
      const newFilesById: { [id: string]: UploadableFile } = {};
      const newFileIds: string[] = [];

      state.fileIds.forEach(id => {
        const file = state.filesById[id];
        if (file.status !== 'success') {
          newFileIds.push(id);
          newFilesById[id] = file;
        }
      });

      return {
        filesById: newFilesById,
        fileIds: newFileIds,
      };
    });
  },

  reset: () => {
    set(state => {
      const newFilesById: { [id: string]: UploadableFile } = {};
      const newFileIds: string[] = [];

      state.fileIds.forEach(id => {
        const file = state.filesById[id];
        // Keep files that are already successfully processed or have a persistent error.
        if (file.status === 'success' || file.status === 'error') {
          newFileIds.push(id);
          newFilesById[id] = file;
        }
      });

      // TODO: We should also inform the task-queue-store to cancel these tasks.
      // For now, the task-runner will fail gracefully when it can't find the fileId.

      return {
        filesById: newFilesById,
        fileIds: newFileIds,
      };
    });
  },
}));

