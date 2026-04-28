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
export default function FashionAIPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeMessages = conversations.find(c => c.id === activeConversationId)?.messages || [];

   // 1. 在组件加载时，从 localStorage 读取会话数据
   useEffect(() => {
    const savedConversations = localStorage.getItem('conversations');
    if (savedConversations) {
      try {
        const parsedConversations = JSON.parse(savedConversations);
        setConversations(parsedConversations);
        // 如果有历史会话，默认激活第一个
        if (parsedConversations.length > 0 && !activeConversationId) {
          setActiveConversationId(parsedConversations[0].id);
        }
      } catch (e) {
        console.error("Failed to parse conversations from localStorage", e);
        setConversations([]);
      }
    }
  }, []); // 空依赖数组确保这个 effect 只运行一次

  // 2. 每当 conversations 状态变化时，将其保存到 localStorage
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem('conversations', JSON.stringify(conversations));
    }
  }, [conversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages, isLoading]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
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
    
    const userMessage: Message = { role: 'user', content: textToSend, imageUrl: previewUrl || undefined };

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
        updateConversation(messages => {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role === 'ai' && Array.isArray(lastMessage.content)) {
            const newContent = [...lastMessage.content];
            const lastPart = newContent[newContent.length - 1];
            if (lastPart?.type === 'text') {
              lastPart.content += text;
              return [...messages.slice(0, -1), { ...lastMessage, content: newContent }];
            }
          }
          const newAiMessage: Message = { role: 'ai', content: [{ type: 'text', content: text }] };
          return lastMessage?.role === 'ai' 
            ? [...messages.slice(0, -1), { ...lastMessage, content: [...(lastMessage.content as any[]), { type: 'text', content: text }] }]
            : [...messages, newAiMessage];
        });
      },
      onImagePlaceholder: (data: { id: string; alt: string; }) => {
        updateConversation(messages => {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role === 'ai' && Array.isArray(lastMessage.content)) {
            return [...messages.slice(0, -1), { ...lastMessage, content: [...lastMessage.content, { type: 'image_placeholder', id: data.id, content: data.alt }] }];
          }
          const newAiMessage: Message = { role: 'ai', content: [{ type: 'image_placeholder', id: data.id, content: data.alt }] };
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
      onError: (message: string) => {
        const errorContent = `\n\n**抱歉，处理时发生错误**：${message}`;
        updateConversation(messages => {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage?.role === 'ai' && Array.isArray(lastMessage.content)) {
              return [...messages.slice(0, -1), { ...lastMessage, content: [...lastMessage.content, { type: 'text', content: errorContent }] }];
            }
            const newAiMessage: Message = { role: 'ai', content: [{ type: 'text', content: errorContent }] };
            return [...messages, newAiMessage];
        });
        setIsLoading(false);
      },
      onStreamEnd: (message: string) => {
        console.log('Stream finished:', message);
        setIsLoading(false);
      }
    };

    await streamResponse(payload, handlers);
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

