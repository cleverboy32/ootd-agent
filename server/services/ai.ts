import { GoogleGenAI } from '@google/genai';

export const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.PROJECT_ID || '',
  location: process.env.LOCATION || '',
});
