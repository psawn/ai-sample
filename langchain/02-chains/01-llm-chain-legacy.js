// =======================================================================
// CHAINS - BƯỚC 1: LLMChain (CÁCH CŨ - LEGACY)
//
// Chain: nối nhiều bước xử lý (prompt -> model -> ...) để khỏi gọi tay từng bước.
// LLMChain là chain đơn giản nhất: 1 prompt + 1 model.
// chain.call({...biến}) tự làm 2 việc:
// 1. Điền biến vào prompt (giống prompt.formatMessages()).
// 2. Gửi prompt cho model (giống model.invoke()).
//
// LLMChain đã deprecated. Cách mới: 01-llm-chain-lcel.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { LLMChain } = require("@langchain/classic/chains");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

const prompt = ChatPromptTemplate.fromTemplate(
  `What is a good name for a company that makes {product}? Only return the name, nothing else.`,
);

const chain = new LLMChain({
  llm: model,
  prompt,
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Điền {product} vào prompt rồi gọi Gemini.
  const result = await chain.call({
    product: "Queen Size Sheet Set",
  });

  // Kết quả dạng { text: "..." } -> câu trả lời ở result.text.
  console.log("Company name:", result.text);
}

main();
