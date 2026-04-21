import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

// 初始化 Google Generative AI 客户端
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

// 用于将图片文件转换为 Google Generative AI 所需的格式
async function fileToGenerativePart(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const base64EncodedData = Buffer.from(arrayBuffer).toString("base64");
  return {
    inlineData: {
      data: base64EncodedData,
      mimeType: file.type,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    const prompt = formData.get("prompt") as string | null;

    if (!file && !prompt) {
      return NextResponse.json({ error: "Missing image or prompt" }, { status: 400 });
    }

    // 使用支持系统指令和多模态的最新模型
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: "你是一名顶尖的时尚搭配师。用户会上传衣物照片或提出穿搭问题。你需要根据场合、季节、用户的体型或偏好，提供专业、有品位且落地的穿搭建议。语气要亲切、专业。排版要清晰美观，多使用 Markdown 的列表和加粗等格式分点说明。",
    });

    const parts: any[] = [];
    
    // 如果用户上传了图片但没说话，给一个默认提示词
    if (prompt) {
      parts.push(prompt);
    } else if (file) {
      parts.push("请帮我搭配这件衣服，并给出具体的穿搭建议。");
    }

    // 如果有图片，加入多模态参数
    if (file) {
      const imagePart = await fileToGenerativePart(file);
      parts.push(imagePart);
    }

    const result = await model.generateContent(parts);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ text });
  } catch (error) {
    console.error("Gemini API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
