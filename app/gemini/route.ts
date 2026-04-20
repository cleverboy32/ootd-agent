import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

// 初始化 Google Generative AI 客户端
// 请确保在环境变量中设置了 GOOGLE_API_KEY
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

// 用于将图片文件转换为 Google Generative AI 所需的格式
async function fileToGenerativePart(file: File) {
  const base64EncodedData = await file.arrayBuffer().then(Buffer.from).then(buf => buf.toString("base64"));
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

    if (!file || !prompt) {
      return NextResponse.json({ error: "Missing image or prompt" }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

    const imagePart = await fileToGenerativePart(file);

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ text });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
