import { Content } from '@google/genai';
import prismadb from 'server/db';
import { generateSummary } from '@/server/services/summarization';
import { CONTEXT_TOKEN_LIMIT, estimateTokenCount, formatHistoryAsync } from '@/server/utils/estimate-token';
import { Message } from '@/server/types/message';

export async function buildContext(conversationId?: string): Promise<Content[]> {
  if (!conversationId) return [];

  console.log(`[CONTEXT_DEBUG] --- 开始为会话构建上下文 ---`);
  console.log(`[CONTEXT_DEBUG] 传入的 conversationId: ${conversationId}`);

  try {
    const latestSummary = await prismadb.summary.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });

    const newMessages = await prismadb.message.findMany({
      where: {
        conversationId,
        createdAt: { gt: latestSummary?.summarizedUntil },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`有新对话${newMessages.length}条`);

    const unsummarizedHistory = await formatHistoryAsync(newMessages as Message[]);
    const summaryContent = latestSummary?.content || null;

    const summaryToken = summaryContent ? Math.floor(summaryContent.length / 2) : 0;
    const historyToken = estimateTokenCount(unsummarizedHistory);
    const totalToken = summaryToken + historyToken;
    console.log(`[CONTEXT] 预估 Token: 摘要(${summaryToken}) + 新消息(${historyToken}) = ${totalToken}`);

    if (totalToken > CONTEXT_TOKEN_LIMIT) {
      console.log(`[CONTEXT] Token 超出限制 (${totalToken})，开始生成新摘要...`);
      const newSummaryContent = await generateSummary(summaryContent, unsummarizedHistory);

      if (newSummaryContent) {
        const lastMessageSummarized = newMessages[newMessages.length - 1];
        prismadb.summary.create({
          data: {
            conversationId,
            content: newSummaryContent,
            summarizedUntil: lastMessageSummarized.createdAt,
          }
        }).then(() => console.log(`[CONTEXT] 新摘要已成功保存到数据库。`)).catch(e => console.error(`[CONTEXT] 保存新摘要失败:`, e));

        return [{ role: 'user', parts: [{ text: `--- 前情提要 ---\n${newSummaryContent}` }] }];
      } else {
        return unsummarizedHistory.slice(-20);
      }
    } else {
      const historyForAI: Content[] = [];
      if (summaryContent) {
        historyForAI.push({ role: 'user', parts: [{ text: `--- 前情提要 ---\n${summaryContent}` }] });
      }
      historyForAI.push(...unsummarizedHistory);
      return historyForAI;
    }
  } catch (e) {
    console.error(`[HISTORY] 加载历史消息失败:`, e);
    return [];
  }
}