import { genAI } from './ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';

const instructions = `
你的任务是扮演一个专业的时尚搜索引擎优化专家。
仔细阅读用户的请求，然后提取出最核心、最能代表用户意图的、用于在衣橱中搜索服装单品的关键词。

规则：
- 输出必须是简洁的、用逗号分隔的关键词列表。
- 关键词应该聚焦于服装的风格、类型、颜色、材质或适合的场合。
- 忽略所有与具体物品无关的礼貌用语、指令性动词或疑问。
- 如果用户的请求可以被解读为多种风格，可以一并列出。

示例输入 1: "额 我上传了我的衣橱了，你看看我的衣服和合适去面试的嘛 给我搭一套"
示例输出 1: "职业装, 面试, 正装, 西装, 衬衫, 西裤, 皮鞋"

示例输入 2: "今天好热啊，有啥推荐的？最好是清爽一点的，要去海边玩。"
示例输出 2: "清爽, 夏天, 海边度假, 短裤, T恤, 凉鞋, 沙滩裤, 防晒衣"

示例输入 3: "晚上有个 party，想穿得亮眼一点"
示例输出 3: "派对, 亮眼, 连衣裙, 闪亮材质, 设计感, 高跟鞋"

现在，请处理以下用户请求：
`;

export async function distillUserQueryForSearch(userQuery: string): Promise<string> {
  console.log(`[QueryDistillation] Original query: "${userQuery}"`);
  
  if (!userQuery.trim()) {
    console.log('[QueryDistillation] Query is empty, returning empty string.');
    return '';
  }

  try {
    const fullPrompt = `${instructions}\n用户请求: "${userQuery}"\n输出:`;

    const result = await withRetryOn429(
      () =>
        genAI.models.generateContent({
          model: AGENT_MODELS.reasoning,
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        }),
      { label: 'QueryDistillation' }
    );

    // [MODIFIED] 统一的响应处理方式
    const distilledKeywords = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`[QueryDistillation] Distilled keywords: "${distilledKeywords}"`);
    return distilledKeywords.trim(); // 返回trim后的结果，更安全
  } catch (error) {
    console.error('Error during query distillation:', error);
    // 如果提炼失败，我们退回原始查询，保证流程不中断，但效果可能不佳
    console.warn('[QueryDistillation] Falling back to original user query for search.');
    return userQuery;
  }
}