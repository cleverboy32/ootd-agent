"use client";

import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent 
} from "@/components/ui/card";
import { 
  Menu, 
  Search, 
  Plus, 
  Sparkles, 
  Briefcase,
  Shirt,
  Heart,
  Palette,
  Upload, 
  SendHorizontal, 
  HelpCircle,
  X,
  Loader2,
  User
} from "lucide-react";

type Message = {
  role: 'user' | 'ai';
  content: string;
  imageUrl?: string;
};

export default function FashionAIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 当消息更新时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
    // 重置 input value 保证能重复选择同一张图片
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || input;
    if (!textToSend.trim() && !selectedImage) return;

    const currentImageUrl = previewUrl;
    setIsLoading(true);

    // Add user message and AI placeholder in one go
    setMessages(prev => [
      ...prev,
      { role: 'user', content: textToSend, imageUrl: currentImageUrl || undefined },
      { role: 'ai', content: '' } // AI placeholder is always the last one
    ]);

    // Clear input state immediately
    setInput("");
    setSelectedImage(null);
    setPreviewUrl(null);

    try {
      const formData = new FormData();
      if (textToSend) formData.append("prompt", textToSend);
      if (selectedImage) formData.append("image", selectedImage);

      const res = await fetch("/gemini", {
        method: "POST",
        body: formData,
      });

      // Stop loading indicator once stream starts
      setIsLoading(false);

      if (!res.ok || !res.body) {
        throw new Error(`API request failed: ${res.statusText || 'No response body'}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Read the stream and parse SSE
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last, possibly incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.substring(6);
            try {
              const parsed = JSON.parse(jsonStr);
              const textChunk = parsed.text;
              if (textChunk) {
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  lastMessage.content += textChunk; // Append only the 'text' content
                  return newMessages;
                });
              }
            } catch (e) {
              console.error("Failed to parse JSON from SSE chunk:", jsonStr);
            }
          }
        }
      }

    } catch (error: any) {
      console.error("Streaming error:", error);
      // Update the last message (the AI placeholder) with the error
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        lastMessage.content = error.message || "抱歉，出错了。请检查网络或 API Key 设置后稍后再试。";
        return newMessages;
      });
    } finally {
      // Ensure loading is always stopped
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      {/* Left Sidebar */}
      <aside className="w-72 flex flex-col bg-muted/30 border-r border-border shrink-0">
        <div className="p-4 flex items-center gap-3">
          <Image src="/logo.png" alt="Fashion AI Logo" width={32} height={32} className="rounded-md" />
          <span className="font-semibold text-lg tracking-tight">Fashion AI</span>
        </div>

        <div className="px-4 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="搜索对话" 
              className="pl-9 h-10 rounded-xl bg-background border-border shadow-sm"
            />
          </div>
        </div>

        <div className="px-4 mb-6">
          <Button 
            variant="outline" 
            onClick={() => setMessages([])} // 新建对话按钮功能
            className="w-full justify-start gap-3 rounded-full py-6 px-4 shadow-sm hover:bg-accent group border-border"
          >
            <div className="bg-primary/10 p-1.5 rounded-full group-hover:bg-primary/20 transition-colors">
              <Plus className="h-4 w-4 text-primary" />
            </div>
            <span className="font-medium text-sm">新建对话</span>
          </Button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm">
          <p>还没有历史记录</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
        {/* Top Header */}
        <header className="h-14 flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border/40">
          <h2 className="font-semibold text-foreground">AI 时尚搭配助手</h2>
        </header>

        {/* Chat/Greeting Area */}
        <div className="flex-1 overflow-y-auto no-scrollbar pb-32">
          {messages.length === 0 ? (
            <div className="max-w-4xl mx-auto pt-16 px-6 sm:px-12">
              <div className="flex flex-col items-start mb-12">
                <div className="mb-6">
                  <Image src="/logo.png" alt="Fashion AI Logo" width={56} height={56} className="rounded" />
                </div>
                <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 tracking-tight">
                  你好，我是你的专属时尚搭配助手
                </h1>
                <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl">
                  上传一件衣服照片，我会为你推荐多套搭配方案和穿搭建议
                </p>
              </div>

              {/* Feature Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <FeatureCard 
                  icon={<Briefcase className="h-6 w-6 text-blue-500" />}
                  iconBg="bg-blue-50"
                  title="商务搭配"
                  description="职场通勤穿搭建议"
                  onClick={() => handleSend("我想了解商务通勤风格的穿搭，有什么好建议吗？")}
                />
                <FeatureCard 
                  icon={<Shirt className="h-6 w-6 text-green-500" />}
                  iconBg="bg-green-50"
                  title="休闲风格"
                  description="日常出街穿搭方案"
                  onClick={() => handleSend("请给我推荐几套适合周末日常出街的休闲穿搭。")}
                />
                <FeatureCard 
                  icon={<Heart className="h-6 w-6 text-rose-500" />}
                  iconBg="bg-rose-50"
                  title="约会搭配"
                  description="浪漫优雅的着装推荐"
                  onClick={() => handleSend("我周末有个约会，想要浪漫优雅一点的风格，求推荐。")}
                />
                <FeatureCard 
                  icon={<Palette className="h-6 w-6 text-amber-500" />}
                  iconBg="bg-amber-50"
                  title="配色建议"
                  description="专业色彩搭配指导"
                  onClick={() => handleSend("如何进行高级感的色彩搭配？请教我一些色彩搭配的公式。")}
                />
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto pt-8 px-6 sm:px-12 flex flex-col gap-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex items-start gap-3 max-w-[85%] sm:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-primary/10 text-primary'}`}>
                      {msg.role === 'user' ? <User className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                    </div>
                    <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`rounded-2xl px-5 py-3.5 ${msg.role === 'user' ? 'bg-indigo-500 text-white rounded-tr-sm' : 'bg-muted/40 border border-border/50 text-foreground rounded-tl-sm'} shadow-sm ${msg.role === 'ai' ? 'prose prose-sm dark:prose-invert' : 'whitespace-pre-wrap leading-relaxed'}`}>
                        {msg.imageUrl && (
                          <img src={msg.imageUrl} alt="Uploaded" className="max-w-[200px] sm:max-w-xs rounded-xl mb-3 border border-border/10" />
                        )}
                        {msg.role === 'ai' ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        ) : (
                          msg.content
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-start gap-3 max-w-[80%]">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-primary/10 text-primary">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div className="rounded-2xl px-5 py-3.5 bg-muted/40 border border-border/50 text-foreground rounded-tl-sm flex items-center gap-3 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">正在构思搭配方案...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/95 to-transparent z-20">
          <div className="max-w-3xl mx-auto">
            {/* Image Preview */}
            {previewUrl && (
              <div className="mb-3 relative inline-block">
                <div className="p-1 bg-background border border-border rounded-xl shadow-sm">
                  <img src={previewUrl} alt="Preview" className="h-20 w-20 object-cover rounded-lg" />
                </div>
                <button
                  onClick={() => { setSelectedImage(null); setPreviewUrl(null); }}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-sm hover:scale-105 transition-transform"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="relative group">
              <div className="flex items-center bg-background border border-border rounded-[2rem] p-2 pl-4 shadow-md focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
                <input 
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleImageSelect}
                />
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-full shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-5 w-5" />
                </Button>
                <input 
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="上传衣服照片，获取搭配建议..."
                  className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground py-2 px-3 text-base sm:text-lg min-w-0"
                />
                <Button 
                  size="icon" 
                  onClick={() => handleSend()}
                  disabled={isLoading || (!input.trim() && !selectedImage)}
                  className="h-10 w-10 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full shrink-0 ml-2 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
                </Button>
              </div>
            </div>
            <p className="text-center text-xs text-muted-foreground mt-4">
              Fashion AI 会根据提供的图片和描述生成搭配建议，结果仅供参考。
            </p>
          </div>
        </div>
      </main>

      {/* Right Sidebar */}
      <aside className="w-72 border-l border-border p-6 bg-muted/10 hidden lg:block shrink-0">
        <h3 className="font-semibold text-foreground mb-2">历史搭配</h3>
        <p className="text-muted-foreground text-sm">过往的搭配方案将显示在这里</p>
      </aside>

      {/* Floating Help Button */}
      <div className="fixed bottom-6 right-6 z-30">
        <Button variant="outline" size="icon" className="h-12 w-12 rounded-full border-border shadow-lg bg-background hover:bg-accent text-muted-foreground">
          <HelpCircle className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
}

function FeatureCard({ 
  icon, 
  iconBg, 
  title, 
  description,
  onClick
}: { 
  icon: React.ReactNode, 
  iconBg: string, 
  title: string, 
  description: string,
  onClick?: () => void
}) {
  return (
    <Card onClick={onClick} className="border-border hover:bg-accent/50 hover:shadow-sm transition-all cursor-pointer group">
      <CardHeader className="pb-2">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform ${iconBg}`}>
          {icon}
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm">{description}</CardDescription>
      </CardContent>
    </Card>
  );
}
