import { NextResponse } from 'next/server';
import { ClothingMainCategory } from '@prisma/client';
import prismadb from 'server/db';
import { genAI } from 'server/services/ai';
import { urlToGenerativePart } from '@/server/utils/image';
import { GenerateContentResponse } from '@google/genai';

// --- [新增] GET 请求处理函数 ---
export async function GET(req: Request) {
  try {
    // 1. 从请求头获取 clientId
    const clientId = req.headers.get('X-Client-ID');
    if (!clientId) {
      return NextResponse.json({ error: 'X-Client-ID header is required' }, { status: 400 });
    }

    console.log(`[API /api/wardrobe] GET request for clientId: ${clientId}`);

    // 2. 从数据库查询该用户的所有衣物，按创建时间倒序排列
    const clothingItems = await prismadb.clothingItem.findMany({
      where: {
        clientProfileId: clientId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 3. 返回查询结果
    return NextResponse.json(clothingItems, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/wardrobe:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// 定义 AI 返回的 JSON 对象的 TypeScript 接口，用于类型检查
interface AiClothingAnalysis {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  season: string[]; // <-- 新增
  material: string[]; // <-- 新增
  colors: string[];
  tags: string[];
  description: string;
}

// 精心设计的 AI 指令，告诉模型如何分析图片并以特定 JSON 格式返回结果
const aiPrompt = `You are an expert fashion assistant responsible for analyzing clothing items. Your task is to analyze the user-provided image and return a structured JSON object with the item's details.

**JSON Output Format:**
You MUST respond with a single, minified JSON object and nothing else. Do not include markdown backticks (\`\`\`json), explanations, or any text outside of the JSON object.

The JSON object must have the following structure:
{
  "mainCategory": "string",
  "subCategory": "string",
  "season": ["string"],
  "material": ["string"],
  "colors": ["string"],
  "tags": ["string"],
  "description": "string"
}

**Field Descriptions & Constraints:**

1.  **mainCategory**: The primary category of the item. It MUST be one of the following exact string values: "TOP", "BOTTOM", "OUTERWEAR", "FOOTWEAR", "ACCESSORY", "ONE_PIECE".

2.  **subCategory**: A specific, descriptive sub-category in English (e.g., "T-shirt", "Skinny Jeans", "Trench Coat", "Ankle Boots").

3.  **season**: An array of applicable seasons in English. It MUST contain one or more of the following: "Spring", "Summer", "Autumn", "Winter".

4.  **material**: An array of 1-2 primary materials in English (e.g., ["cotton"], ["polyester", "spandex"]).
5.  **colors**: An array of 1-3 dominant colors present in the item, in English (e.g., ["black", "white", "gray"]).

6.  **tags**: An array of 3-5 descriptive tags in English that capture the style or occasion (e.g., ["casual", "formal", "sporty", "vintage"]).

7.  **description**: A concise, one-sentence description of the item in English (e.g., "A white short-sleeve cotton t-shirt with a crew neck.").

**Example Input Image:** A picture of a blue denim jacket.
**Example Correct Output:**
{"mainCategory":"OUTERWEAR","subCategory":"Denim Jacket","season":["Spring","Autumn"],"material":["denim"],"colors":["blue"],"tags":["casual","streetwear"],"description":"A classic blue denim jacket with metal buttons."}

Now, analyze the following image and provide the JSON object.`;


export async function POST(req: Request) {
  try {
    // 1. 从请求中获取 clientId 和 imageUrl
    const clientId = req.headers.get('X-Client-ID');
    if (!clientId) {
      return NextResponse.json({ error: 'X-Client-ID header is required' }, { status: 400 });
    }

    const { imageUrl } = await req.json();
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json({ error: 'imageUrl is required in the request body' }, { status: 400 });
    }

    console.log(`[API /api/wardrobe] Received request for clientId: ${clientId}, imageUrl: ${imageUrl}`);
    

    const imagePart = await urlToGenerativePart(imageUrl);
    const textPart = { text: aiPrompt };

    // [MODIFIED] 使用最新的 genAI.models.generateContent 方式调用 AI
    console.log('[API /api/wardrobe] Calling Gemini API for analysis with genAI.models.generateContent...');
    const result: GenerateContentResponse = await genAI.models.generateContent({
      model: "gemini-2.5-pro", // 指定要使用的模型
      contents: [{ role: 'user', parts: [imagePart, textPart] }] // 将图片和文本 prompt 组合
    });

    // 3. 获取分析结果
    const responseText = result.text;
    console.log(`[API /api/wardrobe] Gemini response received: ${responseText}`);

    // 4. 解析和验证 AI 返回的 JSON
    if (!responseText) {
      console.error('[API /api/wardrobe] Received empty response from Gemini.');
      return NextResponse.json({ error: 'Received empty response from AI service.' }, { status: 500 });
    }

    let analysis: AiClothingAnalysis;
    try {
      analysis = JSON.parse(responseText);
    } catch (e) {
      console.error('[API /api/wardrobe] Failed to parse JSON from AI response:', responseText);
      return NextResponse.json({ error: 'Failed to parse AI response. The response was not valid JSON.' }, { status: 500 });
    }

    // 对解析出的数据进行严格验证
    const { mainCategory, subCategory, season, material, colors, tags, description } = analysis;
    if (!mainCategory || !subCategory || !Array.isArray(season) || !Array.isArray(material) || !Array.isArray(colors) || !Array.isArray(tags) || !description) {
      return NextResponse.json({ error: 'Invalid data structure from AI analysis' }, { status: 500 });
    }
    if (!Object.values(ClothingMainCategory).includes(mainCategory)) {
        return NextResponse.json({ error: `Invalid mainCategory "${mainCategory}" from AI analysis` }, { status: 500 });
    }

    // 5. 将结果存入数据库
    console.log('[API /api/wardrobe] Storing new clothing item to database...');
    const newClothingItem = await prismadb.clothingItem.create({
      data: {
        clientProfileId: clientId,
        imageUrl: imageUrl,
        mainCategory: mainCategory,
        subCategory: subCategory,
        season: season.map(s => s.toLowerCase()),
        material: material.map(m => m.toLowerCase()),
        // 将所有标签和颜色统一转为小写，以保持数据一致性
        colors: colors.map(c => c.toLowerCase()),
        tags: tags.map(t => t.toLowerCase()),
        description: description,
      }
    });
    console.log(`[API /api/wardrobe] Successfully created clothing item with id: ${newClothingItem.id}`);

    // 6. 返回成功的响应
    return NextResponse.json(newClothingItem, { status: 201 }); // 201 Created

  } catch (error) {
    console.error('Error in POST /api/wardrobe:', error);
    // 检查是否是 Google API 特定的错误
    if (error instanceof Error && error.message.includes('GoogleGenerativeAI')) {
      return NextResponse.json({ error: 'An error occurred with the AI service.', details: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

