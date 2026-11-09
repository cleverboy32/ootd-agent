'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Images, Palette, Search, Sparkles, Upload } from 'lucide-react';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { PRODUCT_HOME } from '@/lib/pageGate';
import { LOGO_SRC, withBasePath } from '@/lib/utils';

/** 换落地页图时改这个，逼浏览器 / next/image 丢掉旧缓存 */
const LANDING_IMG_V = '202611091926';

function landingSrc(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return withBasePath(`${path}${sep}v=${LANDING_IMG_V}`);
}

const styles: Array<{
  title: string;
  tag: string;
  tagClass: string;
  caption: string;
  prompt: string;
  image: string;
}> = [
  {
    title: '极简',
    tag: '松弛',
    tagClass: 'bg-[#f3f0ea] text-[#7a6a52]',
    caption: '件数克制、轮廓干净，日常也能显质感',
    prompt: '帮我搭一套极简穿搭',
    image: '/landing/showcase2-minimal.jpg',
  },
  {
    title: '老钱',
    tag: '静奢',
    tagClass: 'bg-[#f6efe4] text-[#9a6b32]',
    caption: '低调质感与经典线条，静奢感拉满',
    prompt: '帮我搭一套老钱风穿搭',
    image: '/landing/m-old-money-v3.jpg',
  },
  {
    title: '法式',
    tag: '优雅',
    tagClass: 'bg-[#f3eef8] text-[#7a5aa0]',
    caption: '松弛优雅，适合日常与约会的轻盈造型',
    prompt: '帮我搭一套法式穿搭',
    image: '/landing/showcase-french.png',
  },
  {
    title: '韩系',
    tag: '显瘦',
    tagClass: 'bg-[#eef3f8] text-[#4a6d8c]',
    caption: '比例利落、块面干净，轻松显高显瘦',
    prompt: '帮我搭一套韩系穿搭',
    image: '/landing/m-korean-v4.jpg',
  },
  {
    title: '新中式',
    tag: '国风',
    tagClass: 'bg-[#f3e9e6] text-[#8a4a3c]',
    caption: '现代剪裁加一处中式细节，东方高级感',
    prompt: '帮我搭一套新中式穿搭',
    image: '/landing/showcase-new-chinese.jpg',
  },
  {
    title: '潮酷',
    tag: '街头',
    tagClass: 'bg-[#eceef3] text-[#4a5160]',
    caption: '街头感与结构感并存，适合出街社交',
    prompt: '帮我搭一套潮酷穿搭',
    image: '/landing/m-cool-v3.jpg',
  },
];

const sceneShowcases: Array<{
  title: string;
  tag: string;
  tagClass: string;
  caption: string;
  prompt: string;
  image: string;
}> = [
  {
    title: '通勤',
    tag: '商务休闲',
    tagClass: 'bg-[#eef3f8] text-[#4a6d8c]',
    caption: '干练利落，适合职场通勤的日常方案',
    prompt: '明天职场通勤穿什么',
    image: '/landing/showcase2-commute.png',
  },
  {
    title: '约会',
    tag: '晚间约会',
    tagClass: 'bg-[#fdeef3] text-[#c44d72]',
    caption: '优雅有氛围，适合晚间约会的造型',
    prompt: '周末约会穿什么',
    image: '/landing/showcase2-weekend.jpg',
  },
  {
    title: '周末',
    tag: '休闲日常',
    tagClass: 'bg-[#eef6ef] text-[#3d8a5a]',
    caption: '轻松舒适，适合周末出街的自在穿搭',
    prompt: '轻度假出游穿什么',
    image: '/landing/showcase2-weekend-v4.jpg',
  },
];

const introHighlights = [
  { label: 'AI 生成穿搭方案', icon: Sparkles },
  { label: '理解个人风格与使用场景', icon: Palette },
  { label: '搭配效果图预览', icon: Images },
];

const features = [
  {
    title: '我的衣橱',
    description: '拍照上传单品，按已有衣服匹配搭配',
    image: '/landing/feature-wardrobe.jpg',
  },
  {
    title: '我的穿搭风',
    description: '按身材、肤色和场合整理专属风格',
    image: '/landing/feature-style-v2.jpg',
  },
  {
    title: '效果实时预览',
    description: '1:1 上身效果图，少一次试错',
    image: '/landing/showcase2-preview.jpg',
  },
];

function ShowcaseCard({
  title,
  tag,
  tagClass,
  caption,
  image,
  onClick,
}: {
  title: string;
  tag: string;
  tagClass: string;
  caption: string;
  image: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group overflow-hidden rounded-2xl border border-border bg-white p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[var(--gold)]/40"
      style={{ boxShadow: '0 6px 16px rgba(90, 60, 20, 0.06)' }}
    >
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3">
        <div className="min-w-0 self-stretch">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">{title}</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tagClass}`}>{tag}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{caption}</p>
        </div>
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-neutral-100">
          <Image
            src={landingSrc(image)}
            alt=""
            fill
            sizes="220px"
            className="object-cover object-top transition duration-500 group-hover:scale-[1.03]"
          />
        </div>
      </div>
    </button>
  );
}

export function GuestLanding({ signupGrant }: { signupGrant: number }) {
  const { openAuthModal } = useAuthModal();

  function openLogin() {
    openAuthModal({ redirect: PRODUCT_HOME });
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/85 backdrop-blur-md">
        <div className="flex h-14 w-full items-center justify-between gap-3 px-3 sm:h-16 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <Image
                src={LOGO_SRC}
                alt="Fashion AI"
                width={34}
                height={34}
                className="rounded-full"
                priority
              />
              <span className="leading-tight">
                <span className="block text-sm font-semibold tracking-tight">Fashion AI</span>
                <span className="hidden text-xs text-muted-foreground sm:block">AI 时尚搭配助手</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={openLogin}
              className="flex w-[200px] shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-[var(--gold)]"
            >
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="truncate">搜索历史对话...</span>
            </button>
          </div>

          <button
            type="button"
            onClick={openLogin}
            className="shrink-0 rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-[var(--gold)]/90"
          >
            登录
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-20 px-4 pt-6 pb-0 sm:gap-24 sm:px-6 sm:pt-8">
        <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-10">
          <div className="space-y-5">
            <span className="inline-flex rounded-full bg-[color-mix(in_oklab,var(--gold)_22%,white)] px-3 py-1 text-xs font-medium text-[color-mix(in_oklab,var(--gold)_70%,black)]">
              AI 时尚搭配助手
            </span>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl sm:leading-[1.2]">
              管理衣橱，选择场景或偏好风格，AI 直接生成穿在你身上的搭配效果图
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              登录后同步衣橱，选择适合的场景或偏好风格，AI 会自动检索已有单品、生成多套搭配方案，并提供上身效果图预览。注册即可体验完整能力，快速找到适合你的穿搭。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openLogin}
                className="rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-[var(--gold)]/90"
              >
                注册领积分，免费体验
              </button>
              <a
                href="#scene-showcase"
                className="rounded-full border border-border bg-white px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-[var(--gold)]/50"
              >
                了解产品
              </a>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {introHighlights.map((item) => {
                const Icon = item.icon;
                return (
                  <span
                    key={item.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs text-muted-foreground"
                  >
                    <Icon className="size-3.5 text-[var(--gold)]" aria-hidden />
                    {item.label}
                  </span>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={openLogin}
            className="w-full rounded-2xl border border-border bg-white p-4 text-left shadow-[0_10px_28px_rgba(90,60,20,0.07)] transition duration-200 hover:border-[var(--gold)]/35 sm:p-5"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">AI 搭配效果示例</h2>
                <p className="mt-1 text-xs text-muted-foreground">注册后即可体验完整助手能力</p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--gold)] px-2.5 py-1 text-[11px] font-semibold text-neutral-950">
                AI 生成
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.9fr_1.1fr]">
              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-border bg-[#faf8f5] p-3.5">
                  <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--gold)_22%,white)] text-[var(--gold)]">
                    <Upload className="size-4" aria-hidden />
                  </span>
                  <p className="text-sm font-medium">上传一张衣服照片</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    自动识别颜色、版型和适用场景，归入你的衣橱
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-[#faf8f5] p-3.5">
                  <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--gold)_22%,white)] text-[var(--gold)]">
                    <Palette className="size-4" aria-hidden />
                  </span>
                  <p className="text-sm font-medium">理解你的风格与使用场景</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    通勤、约会、周末等场景，按偏好给出方案
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="overflow-hidden rounded-xl border border-border bg-[#faf8f5]">
                  <div className="px-3.5 pt-3">
                    <p className="text-sm font-medium">生成的穿搭方案</p>
                  </div>
                  <div className="relative mx-auto mt-2 aspect-[3/4] w-[72%] overflow-hidden rounded-lg bg-neutral-100">
                    <Image
                      src={landingSrc('/landing/showcase-example-v5.jpg')}
                      alt=""
                      fill
                      sizes="200px"
                      className="object-cover object-top"
                      priority
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
                    {['商务休闲', '日常通勤', '搭配效果图'].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border bg-white px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-[color-mix(in_oklab,var(--gold)_16%,white)] px-3.5 py-3">
                  <p className="text-sm font-medium text-neutral-900">注册即可体验场景与风格搭配</p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-700">
                    电子衣橱、风格分析、上身效果图一次打通
                  </p>
                </div>
              </div>
            </div>
          </button>
        </section>

        <section id="scene-showcase" className="space-y-8 scroll-mt-24">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight">同一个人，不同场景，不同风格，不同穿搭</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              AI 从你的衣橱里自动匹配单品，按场景给出穿搭方案，并生成上身效果图
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {sceneShowcases.map((scene) => (
              <ShowcaseCard
                key={scene.title}
                title={scene.title}
                tag={scene.tag}
                tagClass={scene.tagClass}
                caption={scene.caption}
                image={scene.image}
                onClick={openLogin}
              />
            ))}
          </div>
        </section>

        <section className="space-y-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight">六种风格展示</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              选好风格后，AI 会检索衣橱并生成对应效果；登录后还有甜美、文艺、通勤等更多风格
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {styles.map((style) => (
              <ShowcaseCard
                key={style.title}
                title={style.title}
                tag={style.tag}
                tagClass={style.tagClass}
                caption={style.caption}
                image={style.image}
                onClick={openLogin}
              />
            ))}
          </div>
        </section>

        <section className="space-y-8">
          <div className="max-w-2xl text-left">
            <h2 className="text-2xl font-semibold tracking-tight">使用方式</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              从注册到生成搭配，只需三步，快速上手 AI 时尚助手。
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <button
                key={feature.title}
                type="button"
                onClick={openLogin}
                className="group relative aspect-[3/4] overflow-hidden rounded-3xl ring-1 ring-black/[0.06] transition duration-200 hover:-translate-y-1"
                style={{
                  boxShadow: '0 6px 14px rgba(90, 60, 20, 0.1)',
                }}
              >
                <Image
                  src={landingSrc(feature.image)}
                  alt=""
                  fill
                  sizes="320px"
                  className="object-cover object-top transition duration-300 group-hover:scale-[1.03]"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/78 via-black/20 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 p-5 text-left text-white">
                  <span className="block text-base font-medium">{feature.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-white/80">
                    {feature.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="relative left-1/2 w-screen -translate-x-1/2 border-y border-[var(--gold)]/30 bg-neutral-950 px-4 py-8 text-neutral-50 sm:px-6 sm:py-10">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-medium tracking-wide text-[var(--gold)]">限时福利活动</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                注册即送 {signupGrant} 积分
              </h2>
              <p className="mt-2 max-w-xl text-sm text-neutral-300">
                登录后使用衣橱、穿搭方案和上身效果图
              </p>
            </div>
            <button
              type="button"
              onClick={openLogin}
              className="shrink-0 rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-[var(--gold)]/90"
            >
              立即登录领取积分
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
