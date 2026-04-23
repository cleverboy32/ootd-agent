const { GoogleGenerativeAI } = require("@google/generative-ai");
const { ProxyAgent, setGlobalDispatcher } = require("undici");

async function test() {
  // 配置全局代理
  const proxyUrl = "http://127.0.0.1:7897";
  const proxyAgent = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(proxyAgent);
  
  console.log(`Global proxy set to ${proxyUrl}`);

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
  const model = genAI.getGenerativeModel(
    { model: "gemini-flash-latest" }, 
    { apiVersion: "v1beta" }
  );

  console.log("Sending request via undici global proxy...");
  try {
    const result = await model.generateContent("Hello, can you see this?");
    const response = await result.response;
    console.log("Response:", response.text());
  } catch (e) {
    console.error("Test failed:", e);
  }
}

test();
