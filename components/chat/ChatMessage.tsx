import React, { memo } from "react";
import ReactMarkdown from "react-markdown";
import Image from "next/image";
import remarkGfm from "remark-gfm";
import { ImageState, Message } from "@/lib/types";
import { User, AlertTriangle, RefreshCw } from "lucide-react";
import { useChatHandler } from "@/hooks/useChatHandler";
import { useImageRetry } from "@/hooks/useImageRetry";
import { Button } from "@/components/ui/button";
import { WardrobeItem } from "./WardrobeItem";
import { ZoomableOutfitImage } from "./ZoomableOutfitImage";

const IMAGE_MARKER_REGEX = /\[IMAGE=([^\]]+)\]/g;

function ImageLoadingPlaceholder() {
  return (
    <div className="h-[200px] w-full max-w-[200px] rounded-xl my-3 border border-border/10 bg-muted/40 flex flex-col items-center justify-center text-center p-2">
      <div className="h-8 w-8 border-4 border-dashed rounded-full border-muted-foreground/30 border-t-transparent animate-spin mb-2" />
      <p className="text-xs text-muted-foreground">正在生成穿搭效果图...</p>
    </div>
  );
}

function ImageFailedPlaceholder({
  onRetry,
  isRetrying,
}: {
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  return (
    <div className="h-[200px] w-full max-w-[200px] rounded-xl my-3 border border-destructive/50 bg-destructive/10 flex flex-col items-center justify-center text-center p-3">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-8 w-8 text-destructive mb-2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <p className="text-xs font-semibold text-destructive">图片生成失败</p>
      {onRetry && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 flex items-center gap-1 text-xs h-auto px-2 py-1"
          disabled={isRetrying}
          onClick={onRetry}
        >
          <RefreshCw className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} />
          {isRetrying ? "生成中..." : "重新生成"}
        </Button>
      )}
    </div>
  );
}

function InlineImageMarker({
  outfitId,
  messageId,
  imageStates,
  onRetryImage,
}: {
  outfitId: string;
  messageId: string;
  imageStates?: Record<string, ImageState>;
  onRetryImage: (messageId: string, outfitId: string) => void;
}) {
  const state = imageStates?.[outfitId];

  if (state && state !== "loading" && state !== "failed") {
    return (
      <ZoomableOutfitImage src={state} alt="AI 生成的穿搭效果图" />
    );
  }

  if (state === "failed") {
    return (
      <ImageFailedPlaceholder
        onRetry={() => onRetryImage(messageId, outfitId)}
        isRetrying={false}
      />
    );
  }

  return <ImageLoadingPlaceholder />;
}

function MarkdownBlock({ text }: { text: string }) {
  const processedText = text.replace(
    /\[衣橱物品:(?:id=)?([^\]]+)\]/g,
    "[衣橱物品](/wardrobe-item/$1)"
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => {
          if (href && href.startsWith("/wardrobe-item/")) {
            const itemId = href.slice("/wardrobe-item/".length);
            return (
              <span className="inline-flex align-middle mx-1">
                <WardrobeItem itemId={itemId} />
              </span>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
              {...props}
            >
              {children}
            </a>
          );
        },
        p: ({ children }) => <p className="leading-relaxed whitespace-pre-wrap">{children}</p>,
        img: (props) => (
          <ZoomableOutfitImage
            src={props.src as string}
            alt={props.alt || "AI 生成的穿搭效果图"}
          />
        ),
      }}
    >
      {processedText}
    </ReactMarkdown>
  );
}

const ContentRenderer = ({
  text,
  messageId,
  imageStates,
  onRetryImage,
}: {
  text: string;
  messageId: string;
  imageStates?: Record<string, ImageState>;
  onRetryImage: (messageId: string, outfitId: string) => void;
}) => {
  const segments: Array<{ type: "text"; content: string } | { type: "image"; outfitId: string }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(IMAGE_MARKER_REGEX)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, matchIndex) });
    }
    segments.push({ type: "image", outfitId: match[1] });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    return <MarkdownBlock text={text} />;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <MarkdownBlock key={`text-${index}`} text={segment.content} />
        ) : (
          <InlineImageMarker
            key={`img-${segment.outfitId}-${index}`}
            outfitId={segment.outfitId}
            messageId={messageId}
            imageStates={imageStates}
            onRetryImage={onRetryImage}
          />
        )
      )}
    </>
  );
};

interface ChatMessageProps {
  msg: Message;
  isLoading?: boolean;
}

export const ChatMessage = memo(
  function ChatMessage({ msg, isLoading = false }: ChatMessageProps) {
    const { handleSend } = useChatHandler();
    const { retryOutfitImage } = useImageRetry();

    const shouldRenderBubble =
      (Array.isArray(msg.content) && msg.content.length > 0) ||
      (typeof msg.content === "string" && msg.content !== "") ||
      msg.imageUrl;

    const isGenerating =
      msg.role === "ai" &&
      msg.status === "generating" &&
      msg.content.length === 0;

    return (
      <div
        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`flex items-start gap-3 max-w-[95%] sm:max-w-[90%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
        >
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-pink-300 text-white" : "bg-primary/10 text-primary"}`}
          >
            {msg.role === "user" ? (
              <User className="h-5 w-5" />
            ) : (
              <Image
                src="/logo.png"
                alt="Fashion AI Logo"
                width={48}
                height={48}
                className={`rounded-full ${isLoading ? "animate-spin" : ""}`}
              />
            )}
          </div>

          <div
            className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            {shouldRenderBubble && (
              <div
                className={`rounded-2xl px-5 py-3.5 ${msg.role === "user" ? "bg-gradient-to-br from-amber-400/20 to-yellow-600/10 text-black rounded-tr-sm" : "bg-muted/40 border border-border/50 text-foreground rounded-tl-sm"} shadow-sm ${msg.role === "ai" ? "prose prose-sm dark:prose-invert max-w-none" : "whitespace-pre-wrap leading-relaxed"}`}
              >
                {Array.isArray(msg.content) ? (
                  msg.content.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <ContentRenderer
                          key={part.id || index}
                          text={part.content}
                          messageId={msg.id}
                          imageStates={msg.imageStates}
                          onRetryImage={retryOutfitImage}
                        />
                      );
                    } else if (part.type === "image") {
                      return (
                        <ZoomableOutfitImage
                          key={part.id || index}
                          src={part.content}
                          alt={part.alt || "Generated image"}
                        />
                      );
                    } else if (part.type === "image_placeholder") {
                      return (
                        <ImageLoadingPlaceholder key={part.id || index} />
                      );
                    } else if (part.type === "image_failed") {
                      return (
                        <ImageFailedPlaceholder key={part.id || index} />
                      );
                    }
                    return null;
                  })
                ) : msg.role === "ai" ? (
                  <ContentRenderer
                    text={msg.content as string}
                    messageId={msg.id}
                    imageStates={msg.imageStates}
                    onRetryImage={retryOutfitImage}
                  />
                ) : (
                  msg.content
                )}
              </div>
            )}

            {isGenerating && !shouldRenderBubble && (
              <div className="rounded-2xl px-5 py-3.5 bg-muted/40 border border-border/50 rounded-tl-sm shadow-sm">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse delay-150" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse delay-300" />
                </div>
              </div>
            )}

            {msg.role === "ai" && msg.status === "failed" && (
              <div className="flex items-center gap-2 mt-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs">消息生成失败</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-1.5 text-xs h-auto px-2 py-1"
                  onClick={() => handleSend(msg)}
                >
                  <RefreshCw className="h-3 w-3" />
                  重试
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.msg.content === next.msg.content &&
      prev.msg.status === next.msg.status &&
      prev.msg.imageStates === next.msg.imageStates &&
      prev.isLoading === next.isLoading
    );
  },
);
