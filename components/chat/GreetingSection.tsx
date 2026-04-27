import React from 'react';
import Image from 'next/image';
import { Briefcase, Shirt, Heart, Palette } from 'lucide-react';
import { FeatureCard } from './FeatureCard';

interface GreetingSectionProps {
  handleSend: (prompt: string) => void;
}

export function GreetingSection({ handleSend }: GreetingSectionProps) {
  return (
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
  );
}