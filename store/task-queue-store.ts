import { create } from 'zustand';
import { useWardrobeStore } from './wardrobe-store';
import { executeUpload, executeAnalysis } from '../services/task-executors';

// --- Constants ---
const MAX_CONCURRENT_UPLOADS = 10;
const MAX_CONCURRENT_ANALYSES = 1;
const ANALYZE_RATE_LIMIT_RETRY_MS = 8000;

function isRateLimitMessage(message: string): boolean {
  return (
    message.includes('429') ||
    message.includes('RATE_LIMIT') ||
    message.includes('过于频繁') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('Resource exhausted') ||
    message.includes('Quota exceeded')
  );
}

type TaskType = 'upload' | 'analyze';

// --- State and Actions Interface ---
interface TaskQueueState {
  uploadQueue: string[];
  analyzeQueue: string[];
  activeUploads: number;
  activeAnalyzes: number;
  // A set to prevent adding the same file-task combination multiple times
  queuedIds: Set<string>; 

  addTask: (fileId: string, type: TaskType) => void;
  resetTask: (fileId: string) => void;
  _processQueues: () => void;
  _runTask: (fileId: string, type: TaskType) => Promise<void>;
}

// --- Store Implementation ---
export const useTaskQueueStore = create<TaskQueueState>((set, get) => ({
  // --- Initial State ---
  uploadQueue: [],
  analyzeQueue: [],
  activeUploads: 0,
  activeAnalyzes: 0,
  queuedIds: new Set(),

  // --- ACTIONS ---

  /**
   * Adds a task to the appropriate queue if it hasn't been added before.
   */
  addTask: (fileId, type) => {
    const key = `${fileId}-${type}`;
    if (get().queuedIds.has(key)) return;

    set(state => ({
      queuedIds: new Set(state.queuedIds).add(key),
      ...(type === 'upload' 
        ? { uploadQueue: [...state.uploadQueue, fileId] }
        : { analyzeQueue: [...state.analyzeQueue, fileId] })
    }));

    // Defer processing to avoid immediate re-renders and potential race conditions
    setTimeout(() => get()._processQueues(), 0);
  },

  resetTask: (fileId) => {
    set(state => {
      const newQueuedIds = new Set(state.queuedIds);
      newQueuedIds.delete(`${fileId}-upload`);
      newQueuedIds.delete(`${fileId}-analyze`);
      return { queuedIds: newQueuedIds };
    });
  },

  /**
   * The main scheduler. Checks available slots and runs tasks from the queues.
   */
  _processQueues: () => {
    // No change to get() is needed, but the logic inside the loops is fixed.

    // --- FIX 1: Correctly update the queue after shifting ---
    // Schedule uploads
    while (get().uploadQueue.length > 0 && get().activeUploads < MAX_CONCURRENT_UPLOADS) {
      const fileId = get().uploadQueue.shift()!; // Mutates the array from get()
      set(state => ({
        activeUploads: state.activeUploads + 1,
        uploadQueue: [...state.uploadQueue], // Create a new array from the *now modified* queue
      }));
      get()._runTask(fileId, 'upload');
    }

    // Schedule analyses
    while (get().analyzeQueue.length > 0 && get().activeAnalyzes < MAX_CONCURRENT_ANALYSES) {
      const fileId = get().analyzeQueue.shift()!; // Mutates the array from get()
      set(state => ({
        activeAnalyzes: state.activeAnalyzes + 1,
        analyzeQueue: [...state.analyzeQueue], // Create a new array from the *now modified* queue
      }));
      get()._runTask(fileId, 'analyze');
    }
  },

  /**
   * The task runner. Executes a task and handles its lifecycle.
   */
  _runTask: async (fileId, type) => {
    const { updateFileStatus, filesById } = useWardrobeStore.getState();
    const fileData = filesById[fileId];

    if (!fileData) {
      console.error(`TaskRunner: Could not find file with id ${fileId}`);
      // Decrement the counter anyway to prevent a stuck slot
      set(state => ({
        ...(type === 'upload'
          ? { activeUploads: state.activeUploads - 1 }
          : { activeAnalyzes: state.activeAnalyzes - 1 })
      }));
      get()._processQueues(); // Try to schedule next
      return;
    }

    try {
      if (type === 'upload') {
        // --- FIX 2: Correctly call updateFileStatus with an object payload ---
        updateFileStatus(fileId, { status: 'uploading' });
        const publicUrl = await executeUpload(fileData.file);

        // Upload task succeeds: update status and queue the next task
        updateFileStatus(fileId, { status: 'analyzing', publicUrl });
        get().addTask(fileId, 'analyze');

      } else if (type === 'analyze') {
        if (!fileData.publicUrl) throw new Error('Cannot analyze, public URL is missing.');
        await executeAnalysis(fileData.publicUrl);

        // Analysis task succeeds: Set final status to 'success'
        updateFileStatus(fileId, { status: 'success' });
      }
    } catch (error: unknown) {
      console.error(`TaskRunner: Error processing ${type} for ${fileId}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (type === 'analyze' && isRateLimitMessage(errorMessage)) {
        updateFileStatus(fileId, {
          status: 'analyzing',
          error: 'AI 服务繁忙，8 秒后自动重试…',
        });
        get().resetTask(fileId);
        setTimeout(() => get().addTask(fileId, 'analyze'), ANALYZE_RATE_LIMIT_RETRY_MS);
      } else {
        updateFileStatus(fileId, { status: 'error', error: errorMessage });
      }
    } finally {
      // Decrement the active count for the completed task type and trigger the scheduler again.
      set(state => ({
        ...(type === 'upload' 
          ? { activeUploads: state.activeUploads - 1 }
          : { activeAnalyzes: state.activeAnalyzes - 1 })
      }));
      get()._processQueues();
    }
  },
}));

