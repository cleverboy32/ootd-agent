// 新增：定义消息的一个“部分”，可以是文本、图片或图片占位符
export type MessageContentPart = {
  type: 'text' | 'image' | 'image_placeholder' | 'image_failed';
  content: string; // 如果是 text，这里是文本内容；如果是 image，这里是图片 URL；如果是 placeholder，这里是 alt 文本
  id?: string;      // 图片的唯一ID，用于占位符和最终图片的匹配
  alt?: string;     // 图片的描述
};

export type Message = {
  role: 'user' | 'ai';
  // 核心改动：content 现在可以是简单的字符串，也可以是代表丰富内容的“部分”数组
  content: string | MessageContentPart[];
  timestamp: number; // 新增：消息创建时的时间戳
  imageUrl?: string; // 这个字段可以继续用来显示用户上传的图片
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};

