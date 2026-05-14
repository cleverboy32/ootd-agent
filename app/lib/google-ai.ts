import { GoogleGenAI, FunctionDeclaration, GenerateContentConfig } from "@google/genai";

// Initialize Google AI client
export const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.PROJECT_ID || "",
  location: process.env.LOCATION || "",
});

// --- [修改] --- 定义所有 AI 可以使用的工具
export const tools: FunctionDeclaration[] = [
  {
    name: "image_generator",
    description: "当需要根据文本描述生成一张效果图或可视化图片时调用此工具。",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          description: "用于生成图片的、详细的、具有画面感的英文描述。",
        },
      },
      required: ["prompt"],
    },
  },
  // --- [新增] --- 定义 gatekeeper_check 工具
  {
    name: "gatekeeper_check",
    description: "在执行主要任务（如服装搭配）之前，调用此工具来检查是否缺少必要的用户信息（如身高、体重、风格偏好等）。",
    parameters: {
      type: "object",
      properties: {
        is_ready: {
          description: "如果所有必要信息都已齐全，可以开始执行主要任务，则设置为 true。",
        },
        questions: {
          description: "如果缺少信息，需要向用户提出缺少的问题列表。",
        },
      },
      required: ["is_ready"],
    },
  },
];

// --- [修改] --- 更新系统指令，教会 AI 使用新工具
export const mainModelConfig: GenerateContentConfig = {
  systemInstruction: `你是一名顶尖的时尚搭配师。
你的工作流程分为两个阶段：
  1.  **检查阶段**：在回答用户任何关于服装搭配的请求之前，你必须先调用 'gatekeeper_check' 工具。
    你需要根据当前已知的用户信息，判断是否可以直接给出建议。如果缺少关键信息（如身高、体重、场合、风格偏好等），你应该通过 'gatekeeper_check' 工具的 'questions' 参数，生成需要询问用户的问题列表。
  2.  **执行阶段**：当 'gatekeeper_check' 工具确认所有信息都已就绪后（is_ready: true），你才能开始你的核心任务：
    为用户提供 2 到 3 个不同的穿搭方案。先用文字描述一个方案，然后立刻为这个方案调用 image_generator 工具生成一张效果图。然后你再继续描述下一个方案，并再次调用工具。
    请严格遵循“描述一个方案，然后立刻为该方案调用画图工具”的顺序，直到提供完所有建议。
    使用 Markdown 格式化你的文本回复，使其清晰美观。如果用户提供了图片，请优先基于图片内容给出搭配建议
请严格遵循“先检查必要信息，最新问题结合历史消息进行分析，再执行”的原则。`,
  tools: [{ functionDeclarations: tools }], // 确保 tools 数组被正确引用
};
