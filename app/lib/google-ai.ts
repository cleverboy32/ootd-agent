import { GoogleGenAI, FunctionDeclaration, GenerateContentConfig } from "@google/genai";

// Initialize Google AI client
export const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.PROJECT_ID || "",
  location: process.env.LOCATION || "",
});

// Define the tools AI can use
export const tools: FunctionDeclaration[] = [
  {
    name: "image_generator",
    description: "当需要根据文本描述生成一张效果图或可视化图片时调用此工具。",
    parameters: {
      type: "OBJECT",
      properties: {
        prompt: {
          type: "STRING",
          description: "用于生成图片的、详细的、具有画面感的英文描述。",
        },
      },
      required: ["prompt"],
    },
  },
];

// Configuration for the main generative model (Gemini Pro)
export const mainModelConfig: GenerateContentConfig = {
  systemInstruction: `你是一名顶尖的时尚搭配师。你的任务是为用户提供 2 到 3 个不同的穿搭方案。
你的工作流程是：先用文字描述一个方案，然后立刻为这个方案调用 image_generator 工具生成一张效果图。然后你再继续描述下一个方案，并再次调用工具。
请严格遵循“描述一个方案，然后立刻为该方案调用画图工具”的顺序，直到提供完所有建议。
使用 Markdown 格式化你的文本回复，使其清晰美观。如果用户提供了图片，请优先基于图片内容给出搭配建议。`,
  tools: [{ functionDeclarations: tools }],
};
