'use client';

import { Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthPanel, safeRedirect } from '@/components/auth/AuthPanel';
import { LOGO_SRC, withBasePath } from '@/lib/utils';

function LoginPageInner() {
  const searchParams = useSearchParams();
  const redirect = safeRedirect(searchParams.get('redirect'));

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center border-b border-border/40 bg-background/80 px-4 backdrop-blur-sm lg:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image
            src={LOGO_SRC}
            alt="Fashion AI Logo"
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="text-lg tracking-tight">Fashion AI</span>
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10">
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <Image
            src={withBasePath('/brand-hero-gold.png')}
            alt=""
            fill
            priority
            quality={100}
            unoptimized
            sizes="200vw"
            className="object-cover object-center opacity-50 scale-[1.15] translate-x-[100px]"
          />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.28)_0%,rgba(255,255,255,0.08)_35%,transparent_60%)]" />
        </div>

        <div className="relative z-10 w-full max-w-[400px]">
          <AuthPanel variant="page" redirect={redirect} />
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
