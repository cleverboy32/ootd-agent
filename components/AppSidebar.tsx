"use client";

import Image from "next/image";
import Link from "next/link";
import {
  LayoutDashboard,
  MessageSquare,
  PlusSquare,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { useAccess } from "@/components/access/AccessProvider";
import { LOGO_SRC } from "@/lib/utils";

export type AppSidebarSection = "chat" | "wardrobe" | "add" | "profile";

interface AppSidebarProps {
  activeSection: AppSidebarSection;
  onWardrobeViewChange?: (view: "display" | "add") => void;
}

const itemClassName =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary";
const activeItemClassName = `${itemClassName} bg-muted text-primary`;

function NavLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <>
      <Icon className="h-4 w-4" />
      {children}
    </>
  );
}

export function AppSidebar({
  activeSection,
  onWardrobeViewChange,
}: AppSidebarProps) {
  const { canMutate } = useAccess();
  const wardrobeItem = (view: "display" | "add", label: string, Icon: LucideIcon) => {
    const section = view === "display" ? "wardrobe" : "add";
    const className = activeSection === section ? activeItemClassName : itemClassName;

    if (onWardrobeViewChange) {
      return (
        <button
          key={section}
          type="button"
          onClick={() => onWardrobeViewChange(view)}
          className={className}
        >
          <NavLabel icon={Icon}>{label}</NavLabel>
        </button>
      );
    }

    return (
      <Link
        key={section}
        href="/wardrobe"
        className={className}
      >
        <NavLabel icon={Icon}>{label}</NavLabel>
      </Link>
    );
  };

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center px-4 lg:h-15 lg:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Image
              src={LOGO_SRC}
              alt="Fashion AI Logo"
              width={28}
              height={28}
              className="rounded-md"
            />
            <span className="font-semibold text-lg tracking-tight">Fashion AI</span>
          </Link>
        </div>

        <nav className="grid items-start gap-1 px-2 text-sm font-medium lg:px-4">
          <Link
            href="/"
            className={activeSection === "chat" ? activeItemClassName : itemClassName}
          >
            <NavLabel icon={MessageSquare}>AI 搭配</NavLabel>
          </Link>

          {wardrobeItem("display", "衣橱总览", LayoutDashboard)}
          {canMutate && wardrobeItem("add", "添加衣物", PlusSquare)}

          <Link
            href="/profile"
            className={activeSection === "profile" ? activeItemClassName : itemClassName}
          >
            <NavLabel icon={UserCircle}>我的档案</NavLabel>
          </Link>
        </nav>
      </div>
    </div>
  );
}
