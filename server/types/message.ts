import { Message as PrismaMessage } from '@prisma/client';


type contentItem = {
    type: string;
    content?: string;
    /** Persisted wardrobe candidate picker payload (id list for confirm continuity). */
    items?: Array<{ id: string; [key: string]: unknown }>;
    prompt?: string;
    [key: string]: unknown;
};

export type Message = Omit<PrismaMessage, 'content'> & {
    content: contentItem[],
    imageUrl?: string;
}