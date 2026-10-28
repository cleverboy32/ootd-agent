import { isAccessoryReferenceLabel } from '@/server/agents/visual/seedreamPrompt';

/** 小首饰才做佩戴比例底板；包/帽/围巾等大配饰保持原图。 */
export function isSmallJewelryScaleTarget(label: string): boolean {
  if (!isAccessoryReferenceLabel(label)) return false;
  if (/包|帽|围巾|丝巾|腰带|发带|bag|hat|scarf|belt|tote|purse|handbag/i.test(label)) {
    return false;
  }
  return true;
}

const CANVAS = 1024;
/**
 * 首饰约占画布高度的比例。
 * 0.12/0.06/0.02 仍易被画大；0.0001≈1px 会丢原图乱画（visual-audit 10:25）。取 0.01 折中。
 */
const JEWELRY_HEIGHT_RATIO = 0.01;
/** 下限勿高于 ratio*canvas，否则 ratio 下调不生效（0.01×1024≈10） */
const JEWELRY_MIN_PX = 8;

/**
 * 把产品特写缩到浅灰大画布中央，避免 Seedream 按满屏特写放大成巨物。
 */
export async function prepareAccessoryOnBodyScaleRef(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const targetH = Math.max(JEWELRY_MIN_PX, Math.round(CANVAS * JEWELRY_HEIGHT_RATIO));
  const targetW = Math.max(JEWELRY_MIN_PX, Math.round(CANVAS * JEWELRY_HEIGHT_RATIO * 1.2));
  const resized = await sharp(input)
    .resize({
      height: targetH,
      width: targetW,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  const meta = await sharp(resized).metadata();
  const width = meta.width ?? targetH;
  const height = meta.height ?? targetH;
  const left = Math.max(0, Math.round((CANVAS - width) / 2));
  const top = Math.max(0, Math.round((CANVAS - height) / 2));

  return sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 3,
      background: { r: 248, g: 248, b: 248 },
    },
  })
    .composite([{ input: resized, left, top }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function loadImageBuffer(url: string): Promise<Buffer> {
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(url.trim());
  if (dataUrl) {
    return Buffer.from(dataUrl[2], 'base64');
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`accessory ref fetch failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * 对小首饰参考 URL 做佩戴比例预处理，失败则保留原 URL。
 */
export async function scaleAccessoryReferenceImages(
  referenceUrls: string[],
  referenceLabels: string[]
): Promise<string[]> {
  const out = [...referenceUrls];
  await Promise.all(
    referenceUrls.map(async (url, index) => {
      const label = referenceLabels[index] ?? '';
      if (!url?.trim() || !isSmallJewelryScaleTarget(label)) return;
      try {
        const raw = await loadImageBuffer(url);
        const scaled = await prepareAccessoryOnBodyScaleRef(raw);
        out[index] = `data:image/jpeg;base64,${scaled.toString('base64')}`;
        console.log(
          `[ACCESSORY_SCALE_REF] scaled jewelry ref index=${index} label=${label.slice(0, 40)}`
        );
      } catch (error) {
        console.warn(
          `[ACCESSORY_SCALE_REF] skip index=${index}:`,
          error instanceof Error ? error.message : error
        );
      }
    })
  );
  return out;
}
