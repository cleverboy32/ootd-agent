// 新增：定义消息的一个“部分”，可以是文本、图片或图片占位符
export type MessageContentPart = {
  type: 'text' | 'image' | 'image_placeholder' | 'image_failed';
  content: string; // 如果是 text，这里是文本内容；如果是 image，这里是图片 URL；如果是 placeholder，这里是 alt 文本
  id?: string;      // 图片的唯一ID，用于占位符和最终图片的匹配
  alt?: string;     // 图片的描述
};

export type MessageStatus = 'generating' | 'completed' | 'failed';

export type Message = {
  id: string;
  status: 'generating' | 'completed' | 'failed';
  role: 'user' | 'ai';
  content: MessageContentPart[];
  timestamp: number;
  imageUrl?: string; // Add optional imageUrl for client-side rendering
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};

