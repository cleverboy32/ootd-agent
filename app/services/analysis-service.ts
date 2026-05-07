import { genAI } from "@/app/lib/google-ai";
import { GenerateContentConfig } from "@google/genai";


// The system instruction for the AI.
const extractionSystemInstruction = `
You are a precise information extraction assistant. Your task is to identify and extract key user profile information from a given text.
The information you need to identify includes, but is not limited to:
- Name (name)
- Location (location)
- Contact information, such as email or phone (contact)
- User's personal preferences or interests (preferences)
- Mentioned specific brands or products (mentioned_items)

Please adhere strictly to the following rules:
1.  **Return only a single JSON object.**
2.  If the text does not contain any of the above information, return an empty JSON object: {}.
3.  The extracted information should be in key-value pairs, with keys in English.
4.  Merge all extracted preferences or interests into an array named 'preferences'.

For example, if the user says: "Hi, my name is Li Ming, I live in Shanghai. I'm looking for a pair of Nike running shoes."
You should return:
{
  "name": "Li Ming",
  "location": "Shanghai",
  "mentioned_items": ["Nike running shoes"]
}
`;


// A specific AI model configuration for information extraction.
const extractionModelConfig: GenerateContentConfig = {
  // We use a lower temperature to make the model's output more deterministic and stable.
  temperature: 0.2,
  // This is the key part: it instructs the model to only output JSON.
  responseMimeType: "application/json", 
  systemInstruction: extractionSystemInstruction
};

/**
 * Extracts user information from a given text using an AI model.
 * @param text The text content to analyze.
 * @returns A promise that resolves to a JSON object with the extracted information, or null if extraction fails or yields no data.
 */
export async function extractUserInfoFromText(text: string): Promise<Record<string, any> | null> {
  // Prevent analyzing very short or meaningless text
  if (!text || text.trim().length < 5) {
    return null;
  }

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-pro",
      config: extractionModelConfig,
      contents: text,
    });

    const jsonText = response.text;

    console.info(`分析书个人信息：${jsonText}`)

    if (!jsonText) {
      return null;
    }

    // Parse the JSON string returned by the AI
    const extractedData = JSON.parse(jsonText);

    // If the AI returns an empty object, we can consider it as no useful information extracted.
    if (Object.keys(extractedData).length === 0) {
      return null;
    }

    return extractedData;

  } catch (error) {
    console.error("Error during user info extraction:", error);
    // In a production environment, you might want to use a more robust logging system.
    return null;
  }
}