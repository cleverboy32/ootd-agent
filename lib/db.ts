import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Conversation } from './types';

const DB_NAME = 'OotdAgentDB';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';

interface OotdAgentDB extends DBSchema {
  [STORE_NAME]: {
    key: string; // conversation id
    value: Conversation;
  };
}

let dbPromise: Promise<IDBPDatabase<OotdAgentDB>> | null = null;

const getDb = (): Promise<IDBPDatabase<OotdAgentDB>> => {
  if (!dbPromise) {
    dbPromise = openDB<OotdAgentDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

/**
 * Fetches all conversations from the database, sorted by the first message's timestamp (newest first).
 */
export const getAllConversations = async (): Promise<Conversation[]> => {
  const db = await getDb();
  const allConvos = await db.getAll(STORE_NAME);
  // Sort conversations so the most recent ones appear first
  return allConvos.sort((a, b) => {
    const a_ts = a.messages[0]?.timestamp || 0;
    const b_ts = b.messages[0]?.timestamp || 0;
    return b_ts - a_ts;
  });
};

/**
 * Saves or updates a single conversation in the database.
 * @param conversation - The conversation object to save.
 */
export const saveConversation = async (conversation: Conversation): Promise<void> => {
  const db = await getDb();
  await db.put(STORE_NAME, conversation);
};

/**
 * Deletes a conversation from the database by its ID.
 * @param id - The ID of the conversation to delete.
 */
export const deleteConversation = async (id: string): Promise<void> => {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
};
