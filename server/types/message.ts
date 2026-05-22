import { Message as PrismaMessage } from '@prisma/client';


type contentItem = { 
    type: string;
    content: string;
}

export type Message = Omit<PrismaMessage, 'content'> & {
    content: contentItem[],
    imageUrl?: string;
}