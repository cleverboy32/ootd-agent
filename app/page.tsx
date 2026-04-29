"use client";
import { useState, useRef, useEffect } from "react";
import { Message, Conversation } from '@/lib/types';
import { fileToBase64, streamResponse } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { SidebarLeft } from "@/components/chat/SidebarLeft";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessagesList } from "@/components/chat/ChatMessagesList";
import { GreetingSection } from "@/components/chat/GreetingSection";
import { ChatInputArea } from "@/components/chat/ChatInputArea";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { getAllConversations, saveConversation } from '@/lib/db';


export default function FashionAIPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null); // 新增：用于存储上传错误的状

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeMessages = conversations.find(c => c.id === activeConversationId)?.messages || [];

   // 1. 在组件加载时，从 IndexedDB 读取会话数据
   useEffect(() => {
    const loadConversations = async () => {
      try {
        const loadedConversations = await getAllConversations();
        setConversations(loadedConversations);
        // 如果有历史会话，默认激活第一个（因为我们的 db 工具已经按时间排序了）
        if (loadedConversations.length > 0 && !activeConversationId) {
          setActiveConversationId(loadedConversations[0].id);
        }
      } catch (e) {
        console.error("从 IndexedDB 加载会话失败", e);
        setConversations([]);
      }
    };
    loadConversations();
  }, []); // 空依赖数组确保这个 effect 只运行一次

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages, isLoading]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 重置之前的错误
    setUploadError(null);

    const file = e.target.files?.[0];
    if (file) {
      const MAX_FILE_SIZE_MB = 5;
      const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError(`图片大小不能超过 ${MAX_FILE_SIZE_MB}MB。`);
        // 清理选择，防止过大的文件被处理
        setSelectedImage(null);
    setPreviewUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      setSelectedImage(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // --- THE FINAL, CORRECT, REFACTORED handleSend FUNCTION ---
  const handleSend = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || input;
    if (!textToSend.trim() && !selectedImage) return;

    setIsLoading(true);
    
    const userMessage: Message = {
      role: 'user',
      content: textToSend,
      imageUrl: previewUrl || undefined,
      timestamp: Date.now()
    };
    let conversationId = activeConversationId;
    let isNewConversation = false;

    // 如果是新会话
    if (!conversationId) {
      isNewConversation = true;
      const newConversation: Conversation = {
        id: uuidv4(),
        title: textToSend.substring(0, 25), // 使用用户第一句话作为标题
        messages: [userMessage],
      };
      setConversations(prev => [newConversation, ...prev]);
      conversationId = newConversation.id;
      setActiveConversationId(newConversation.id);
    } else {
      // 在现有会话中添加用户消息
      setConversations(prev => prev.map(conv =>
        conv.id === conversationId
          ? { ...conv, messages: [...conv.messages, userMessage] }
          : conv
      ));
    }

    const imageFile = selectedImage;
    setInput("");
    setSelectedImage(null);
    setPreviewUrl(null);

    const payload = {
      prompt: textToSend,
      base64Image: imageFile ? await fileToBase64(imageFile) : undefined,
      mimeType: imageFile ? imageFile.type : undefined,
    };

    const updateConversation = (updater: (messages: Message[]) => Message[]) => {
      setConversations(prev => prev.map(conv =>
        conv.id === conversationId
          ? { ...conv, messages: updater(conv.messages) }
          : conv
      ));
    };

    const handlers = {
      onTextChunk: (text: string) => {
        updateConversation(currentMessages => {
          const lastMessage = currentMessages[currentMessages.length - 1];

          // Case 1: No AI message yet. Create a new one.
          if (!lastMessage || lastMessage.role !== 'ai') {
            const newAiMessage: Message = {
              role: 'ai',
              content: [{ type: 'text', content: text }],
              timestamp: Date.now()
            };
            return [...currentMessages, newAiMessage];
          }

          // Case 2: Last message is from AI. We must update it immutably.
          const lastMessageContent = Array.isArray(lastMessage.content) ? lastMessage.content : [];
          const lastPart = lastMessageContent[lastMessageContent.length - 1];

          let newContent: Message['content'];

          if (lastPart && lastPart.type === 'text') {
            // Subcase 2a: The last part is text.
            // Create a new part object with the updated content.
            const newLastPart = { ...lastPart, content: lastPart.content + text };
            // Create a new content array, replacing the last part.
            newContent = [...lastMessageContent.slice(0, -1), newLastPart];
          } else {
            // Subcase 2b: The last part is not text (e.g., an image) or content is empty.
            // Create a new content array with a new text part added.
            newContent = [...lastMessageContent, { type: 'text', content: text }];
          }

          // Create a new message object with the new content array.
          const newLastMessage = { ...lastMessage, content: newContent };

          // Return a new messages array, replacing the last message.
          return [...currentMessages.slice(0, -1), newLastMessage];
        });
      },
      onImagePlaceholder: (data: { id: string; alt: string; }) => {
        updateConversation(messages => {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role === 'ai' && Array.isArray(lastMessage.content)) {
            return [...messages.slice(0, -1), { ...lastMessage, content: [...lastMessage.content, { type: 'image_placeholder', id: data.id, content: data.alt }] }];
          }
          const newAiMessage: Message = { role: 'ai', content: [{ type: 'image_placeholder', id: data.id, content: data.alt }], timestamp: Date.now() };
          return [...messages, newAiMessage];
        });
      },
      onImageGenerated: (data: { id: string; imageUrl: string; alt: string }) => {
        updateConversation(messages => messages.map(msg => {
          if (msg.role === 'ai' && Array.isArray(msg.content)) {
            return {
              ...msg,
              content: msg.content.map(part =>
                part.type === 'image_placeholder' && part.id === data.id
                  ? { ...part, type: 'image', content: data.imageUrl, alt: data.alt }
                  : part
              ),
            };
          }
          return msg;
        }));
      },
      onImageGenerationFailed: (data: { id: string; message: string; alt: string }) => {
        updateConversation(messages => messages.map(msg => {
          if (msg.role === 'ai' && Array.isArray(msg.content)) {
            return {
              ...msg,
              content: msg.content.map(part =>
                part.type === 'image_placeholder' && part.id === data.id
                  ? { ...part, type: 'image_failed', content: data.message, alt: data.alt }
                  : part
              ),
            };
          }
          return msg;
        }));
      },
      onError: (message: string) => {
        const errorContent = `\n\n**抱歉，处理时发生错误**：${message}`;
        updateConversation(messages => {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage?.role === 'ai' && Array.isArray(lastMessage.content)) {
              return [...messages.slice(0, -1), { ...lastMessage, content: [...lastMessage.content, { type: 'text', content: errorContent }] }];
            }
            const newAiMessage: Message = { role: 'ai', content: [{ type: 'text', content: errorContent }], timestamp: Date.now() };
            return [...messages, newAiMessage];
        });
        setIsLoading(false);
      },
      onStreamEnd: (message: string) => {
        console.log('Stream finished:', message);
        setIsLoading(false);

        // 新增代码：在流结束后，获取最新的会话状态并保存
        setConversations(currentConversations => {
          const finalConversation = currentConversations.find(c => c.id === conversationId);
          if (finalConversation) {
            saveConversation(finalConversation).catch(e => {
              console.error("最终保存会话到 IndexedDB 失败", e);
            });
          }
          return currentConversations;
        });
      }
    };

    await streamResponse(payload, { ...handlers });
  };
  const handleNewChat = () => {
    // 切换到“新会话”模式，但不删除任何数据
    setActiveConversationId(null);
    setInput("");
    setSelectedImage(null);
    setPreviewUrl(null);
    setIsLoading(false);
  };

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      <SidebarLeft 
        onNewChat={handleNewChat}
        conversations={conversations}
        activeConversationId={activeConversationId}
        setActiveConversationId={setActiveConversationId}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
        <ChatHeader />
        <div className="flex-1 overflow-y-auto no-scrollbar pb-32">
          {activeMessages.length === 0 ? ( // <--- 修改这里
            <GreetingSection handleSend={handleSend} />
          ) : (
            <ChatMessagesList messages={activeMessages} isLoading={isLoading} messagesEndRef={messagesEndRef} /> // <--- 修改这里
          )}
        </div>

        <ChatInputArea
          input={input}
          setInput={setInput}
          selectedImage={selectedImage}
          setSelectedImage={setSelectedImage}
          previewUrl={previewUrl}
          setPreviewUrl={setPreviewUrl}
          handleImageSelect={handleImageSelect}
          handleSend={handleSend}
          isLoading={isLoading}
          fileInputRef={fileInputRef}
          uploadError={uploadError}      // 新增：传递错误状态
          setUploadError={setUploadError}  // 新增：传递更新函数
        />
      </main>

      {/* Floating Help Button */}
      <div className="fixed bottom-6 right-6 z-30">
        <Button variant="outline" size="icon" className="h-12 w-12 rounded-full border-border shadow-lg bg-background hover:bg-accent text-muted-foreground">
          <HelpCircle className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
}

