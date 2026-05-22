import prismadb from 'server/db';
import { Prisma } from '@prisma/client';
import { mainModelConfig } from '@/server/utils/ootd-ai-config';

export async function loadPersonalization(clientId: string | undefined, baseConfig: typeof mainModelConfig): Promise<typeof mainModelConfig> {
  if (!clientId) return baseConfig;

  try {
    const clientProfile = await prismadb.clientProfile.findUnique({
      where: { id: clientId },
    });

    if (clientProfile && clientProfile.profileData) {
      const profile = clientProfile.profileData as Prisma.JsonObject;
      let userContext = "关于当前用户，我们有以下已知信息，请在你的回复中酌情参考：\n";
      
      if (profile.name) userContext += `- 姓名: ${profile.name}\n`;
      if (profile.height) userContext += `- 身高: ${profile.height}\n`;
      if (profile.weight) userContext += `- 体重: ${profile.weight}\n`;
      if (profile.preferences) userContext += `- 偏好: ${Array.isArray(profile.preferences) ? profile.preferences.join(', ') : profile.preferences}\n`;
      
      const dynamicSystemInstruction = `${baseConfig.systemInstruction}\n\n${userContext}`;
      
      console.log(`[USER_CONTEXT] 已为 Client ${clientId} 加载个性化配置。 ${JSON.stringify(profile)}`);
      return {
        ...baseConfig,
        systemInstruction: dynamicSystemInstruction,
      };
    }
  } catch (e) {
    console.error(`[USER_CONTEXT] 为 Client ${clientId} 获取用户信息失败:`, e);
  }
  
  return baseConfig;
}