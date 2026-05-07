"use client";
import { useState, useRef, useEffect } from "react";
import { SidebarLeft } from "@/components/chat/SidebarLeft";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessagesList } from "@/components/chat/ChatMessagesList";
import { GreetingSection } from "@/components/chat/GreetingSection";
import { ChatInputArea } from "@/components/chat/ChatInputArea";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { useChatStore } from "@/store/chat";
import { useChatHandler } from "@/hooks/useChatHandler";
import { useImageHandler } from "@/hooks/useImageHandler";


export default function FashionAIPage() {
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isLoading,
    activeConversationId,
    fetchConversations,
    setActiveConversationId,
  } = useChatStore();

  const { handleSend } = useChatHandler();

  const { 
    selectedImage, 
    previewUrl, 
    uploadError, 
    handleImageSelect, 
    resetImageState 
  } = useImageHandler(fileInputRef); // <-- 调用新 hook
 
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleNewChat = () => {
    setActiveConversationId(null);
  };

   // === 新增：一个简单的包裹函数，用于在发送后清空输入框 ===
   const onSend = () => {
    handleSend(input, selectedImage);
    setInput("");
    resetImageState();
  }

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      <SidebarLeft 
        onNewChat={handleNewChat}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
        <ChatHeader />
        <div className="flex-1 overflow-y-auto no-scrollbar pb-32">
          {!activeConversationId ? ( 
            <GreetingSection handleSend={handleSend} />
          ) : (
            <ChatMessagesList messagesEndRef={messagesEndRef} /> // <--- 修改这里
          )}
        </div>

        <ChatInputArea
          input={input}
          setInput={setInput}
          selectedImage={selectedImage}
          previewUrl={previewUrl}
          handleImageSelect={handleImageSelect}
          handleSend={onSend}
          resetImageState={resetImageState}
          isLoading={isLoading}
          fileInputRef={fileInputRef}
          uploadError={uploadError}      // 新增：传递错误状态
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



