export type Message = {
  role: 'user' | 'ai';
  content: string;
  imageUrl?: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};