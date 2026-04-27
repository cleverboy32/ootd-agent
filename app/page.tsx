"use client";

import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import { Loader2, User } from "lucide-react";

// Import new components
import { SidebarLeft } from "@/components/chat/SidebarLeft";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessagesList } from "@/components/chat/ChatMessagesList";
import { GreetingSection } from "@/components/chat/GreetingSection";
import { ChatInputArea } from "@/components/chat/ChatInputArea";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";

// Import the centralized, powerful types
import { Message, MessageContentPart } from '@/lib/types';

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

  // A helper function to convert File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        // result is a data URL (e.g., "data:image/jpeg;base64,xxxx..."), we only need the base64 part
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // --- THE FINAL, INDUSTRIAL-GRADE handleSend FUNCTION ---
  const handleSend = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || input;
    if (!textToSend.trim() && !selectedImage) return;

    const currentImageUrl = previewUrl;
    const imageFile = selectedImage;
    setIsLoading(true);

    // --- 修正：将两次 setMessages 合并为一次原子更新，提高状态管理的稳定性 ---
    const userMessage: Message = { role: 'user', content: textToSend, imageUrl: currentImageUrl || undefined };
    const aiPlaceholder: Message = { role: 'ai', content: [] };
    setMessages(prev => [...prev, userMessage, aiPlaceholder]);
    setInput("");
    setSelectedImage(null);
    setPreviewUrl(null);

    try {
      let base64Image: string | undefined = undefined;
      let mimeType: string | undefined = undefined;

      if (imageFile) {
        base64Image = await fileToBase64(imageFile);
        mimeType = imageFile.type;
      }

      // Use fetch with POST, sending all data in the body
      const res = await fetch("/api/generate-with-image", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: textToSend,
          base64Image: base64Image,
          mimeType: mimeType,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`API request failed: ${res.statusText}`);
      }

      // --- Manual Stream & Event Parsing Logic ---
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
             setIsLoading(false);
             console.log("Stream finished by 'done' signal.");
             break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep the last, potentially incomplete, message in buffer

          for (const line of lines) {
            if (!line.startsWith('event:')) continue;

            // --- 调试日志：打印出从流中收到的每一个原始事件块 ---
            console.log("原始SSE事件", line);

            const eventName = line.substring(7, line.indexOf('\n'));
            const dataString = line.substring(line.indexOf('\n') + 6);

            try {
              const data = JSON.parse(dataString);

              if (eventName === 'text_chunk') {
                setMessages(prev => prev.map((msg, index) => {
                  if (index === prev.length - 1 && msg.role === 'ai' && Array.isArray(msg.content)) {
                    const newContent = [...msg.content];
                    const lastPart = newContent[newContent.length - 1];

                    // --- 重新应用关键修复：使用不可变方式更新，防止内容重复 ---
                    if (lastPart && lastPart.type === 'text') {
                      const updatedPart = { ...lastPart, content: lastPart.content + data.text };
                      newContent[newContent.length - 1] = updatedPart;
                    } else {
                      newContent.push({ type: 'text', content: data.text });
                    }
                    return { ...msg, content: newContent };
                  }
                  return msg;
                }));
              }  else if (eventName === 'image_generated') {
                 // --- 强制修正：确保我们创建的是 `ChatMessage` 组件能识别的正确对象结构 ---
                 console.log("前端 page.tsx: 收到了 image_generated 事件，准备更新状态", data);
                 setMessages(prev => prev.map((msg, index) => {
                   if (index === prev.length - 1 && msg.role === 'ai' && Array.isArray(msg.content)) {
                      const newContent: MessageContentPart[] = [
                        ...msg.content,
                      // 正确的结构: { type: 'image', content: '...' }
                      { type: 'image', content: data.imageUrl, alt: data.alt }
                      ];
                      return { ...msg, content: newContent };
                   }
                   return msg;
                 }));
              } else if (eventName === 'error') {
                console.error("画图失败 (来自服务器):", data.message);
                 setMessages(prev => prev.map((msg, index) => {
                  if (index === prev.length - 1 && msg.role === 'ai' && Array.isArray(msg.content)) {
                    const newContent: MessageContentPart[] = [
                      ...msg.content,
                        // --- 修正BUG ---
                        // 将错误信息作为文本块添加，而不是无效的图片块
                        { type: 'text', content: `\n\n**画图失败了**：服务器返回错误 "${data.message}"` }
                    ];
                    return { ...msg, content: newContent };
                  }
                  return msg;
                }));
              } else if (eventName === 'stream_end') {
                console.log('Stream finished by event:', data.message);
                setIsLoading(false);
                // The 'break' might not be strictly necessary here if the server closes the stream,
                // but it's good practice for cleanup.
                return; // Exit the loop
              }

            } catch (e) {
              console.error("Failed to parse SSE JSON:", dataString, e);
            }
          }
        }
      };

      processStream();

    } catch (error: any) {
      console.error("Fetch or streaming error:", error);
      setMessages(prev => prev.map((msg, index) => {
         if (index === prev.length - 1 && msg.role === 'ai') {
            return { ...msg, content: '抱歉，连接出错了。' };
         }
         return msg;
      }));
      setIsLoading(false);
    }
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

