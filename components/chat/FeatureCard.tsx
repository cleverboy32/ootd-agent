import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

interface FeatureCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  onClick?: () => void;
}

export function FeatureCard({ icon, iconBg, title, description, onClick }: FeatureCardProps) {
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