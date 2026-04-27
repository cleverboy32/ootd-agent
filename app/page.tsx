"use client";
import { useState, useRef, useEffect } from "react";
import { SidebarLeft } from "@/components/chat/SidebarLeft";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessagesList } from "@/components/chat/ChatMessagesList";
import { GreetingSection } from "@/components/chat/GreetingSection";
import { ChatInputArea } from "@/components/chat/ChatInputArea";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { Message } from '@/lib/types';
import { fileToBase64, streamResponse } from '@/lib/utils';

export default function FashionAIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

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
    // 关键改动 1：不再添加空的 AI 占位符
    setMessages(prev => [...prev, userMessage]);

    const imageFile = selectedImage;
    setInput("");
    setSelectedImage(null);
    setPreviewUrl(null);

    const payload = {
          prompt: textToSend,
      base64Image: imageFile ? await fileToBase64(imageFile) : undefined,
      mimeType: imageFile ? imageFile.type : undefined,
      };

    // 关键改动 2：让 handlers 变得更“智能”
    const handlers = {
      onTextChunk: (text: string) => {
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];

          // 如果最后一条消息是 AI，则追加内容
          if (lastMessage && lastMessage.role === 'ai' && Array.isArray(lastMessage.content)) {
            const newContent = [...lastMessage.content];
            const lastPart = newContent[newContent.length - 1];
            if (lastPart && lastPart.type === 'text') {
              const updatedPart = { ...lastPart, content: lastPart.content + text };
              newContent[newContent.length - 1] = updatedPart;
            } else {
              newContent.push({ type: 'text', content: text });
         }
            const updatedMessage = { ...lastMessage, content: newContent };
            return [...prev.slice(0, -1), updatedMessage];
    }
          // 否则，创建一条新的 AI 消息
          else {
            const newAiMessage: Message = { role: 'ai', content: [{ type: 'text', content: text }] };
            return [...prev, newAiMessage];
          }
        });
      },
      onImageGenerated: (data: { imageUrl: string; alt: string }) => {
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          // 如果最后一条消息是 AI，则追加内容
          if (lastMessage && lastMessage.role === 'ai' && Array.isArray(lastMessage.content)) {
            const updatedMessage = { ...lastMessage, content: [...lastMessage.content, { type: 'image', content: data.imageUrl, alt: data.alt }] };
            return [...prev.slice(0, -1), updatedMessage];
          }
          // 否则，创建一条新的 AI 消息
          else {
            const newAiMessage: Message = { role: 'ai', content: [{ type: 'image', content: data.imageUrl, alt: data.alt }] };
            return [...prev, newAiMessage];
          }
        });
      },
      onError: (message: string) => {
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          const errorContent = `\n\n**抱歉，处理时发生错误**：${message}`;
          // 如果最后一条消息是 AI，则追加内容
          if (lastMessage && lastMessage.role === 'ai' && Array.isArray(lastMessage.content)) {
            const updatedMessage = { ...lastMessage, content: [...lastMessage.content, { type: 'text', content: errorContent }] };
            return [...prev.slice(0, -1), updatedMessage];
          }
          // 否则，创建一条新的 AI 消息
          else {
            const newAiMessage: Message = { role: 'ai', content: [{ type: 'text', content: errorContent }] };
            return [...prev, newAiMessage];
          }
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
    setMessages([]);
    setInput("");
    setSelectedImage(null);
    setPreviewUrl(null);
    setIsLoading(false);
  };

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      <SidebarLeft onNewChat={handleNewChat} />
      <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
        <ChatHeader />
        <div className="flex-1 overflow-y-auto no-scrollbar pb-32">
          {messages.length === 0 ? (
            <GreetingSection handleSend={handleSend} />
          ) : (
            <ChatMessagesList messages={messages} isLoading={isLoading} messagesEndRef={messagesEndRef} />
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

