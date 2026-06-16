import { Content } from '@google/genai';
import prismadb from 'server/db';
import { generateSummary } from '@/server/services/summarization';
import { CONTEXT_TOKEN_LIMIT, estimateTokenCount, formatHistoryAsync } from '@/server/utils/estimate-token';
import { Message } from '@/server/types/message';

export async function buildContext(
  conversationId?: string,
  finalMessageId?: string
): Promise<{
  historyForAI: Content[];
  failedMessage: Message | null;
}> {
  if (!conversationId) {
    return { historyForAI: [], failedMessage: null };
  }

  console.log(`[CONTEXT_DEBUG] --- 开始为会话构建上下文 ---`);
  console.log(`[CONTEXT_DEBUG] conversationId: ${conversationId}, finalMessageId: ${finalMessageId || 'none'}`);

  try {
    // 1. 如果有 finalMessageId，先查询这条失败的消息
    let failedMessage: Message | null = null;
    if (finalMessageId) {
      failedMessage = (await prismadb.message.findUnique({
        where: { id: finalMessageId },
      })) as Message | null;
      console.log(`[CONTEXT_DEBUG] 成功查询到失败消息: ${finalMessageId}`);
    }

    // 2. 获取最新的摘要
    const latestSummary = await prismadb.summary.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });

    // 3. 查询新消息，【核心优化】：如果传入了 finalMessageId，在数据库层面直接剔除它！
    const newMessages = await prismadb.message.findMany({
      where: {
        conversationId,
        id: finalMessageId ? { not: finalMessageId } : undefined, // 剔除当前重试的消息
        createdAt: { gt: latestSummary?.summarizedUntil },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`[CONTEXT_DEBUG] 查询到未摘要的新消息 ${newMessages.length} 条 (已剔除重试消息)`);

    const unsummarizedHistory = await formatHistoryAsync(newMessages as Message[]);
    const summaryContent = latestSummary?.content || null;

    const summaryToken = summaryContent ? Math.floor(summaryContent.length / 2) : 0;
    const historyToken = estimateTokenCount(unsummarizedHistory);
    const totalToken = summaryToken + historyToken;
    console.log(`[CONTEXT] 预估 Token: 摘要(${summaryToken}) + 新消息(${historyToken}) = ${totalToken}`);

    let historyForAI: Content[] = [];

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

        historyForAI = [{ role: 'user', parts: [{ text: `--- 前情提要 ---\n${newSummaryContent}` }] }];
      } else {
        historyForAI = unsummarizedHistory.slice(-20);
      }
    } else {
      if (summaryContent) {
        historyForAI.push({ role: 'user', parts: [{ text: `--- 前情提要 ---\n${summaryContent}` }] });
      }
      historyForAI.push(...unsummarizedHistory);
    }

    return {
      historyForAI,
      failedMessage
    };

  } catch (e) {
    console.error(`[HISTORY] 加载历史消息失败:`, e);
    return { historyForAI: [], failedMessage: null };
  }
}