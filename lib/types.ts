// 新增：定义消息的一个“部分”，可以是文本或图片
export type MessageContentPart = {
  type: 'text' | 'image';
  content: string; // 如果是 text，这里是文本内容；如果是 image，这里是图片 URL
  alt?: string;     // 图片的描述
};

export type Message = {
  role: 'user' | 'ai';
  // 核心改动：content 现在可以是简单的字符串，也可以是代表丰富内容的“部分”数组
  content: string | MessageContentPart[];
  imageUrl?: string; // 这个字段可以继续用来显示用户上传的图片
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};
