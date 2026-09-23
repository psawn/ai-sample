// =======================================================================
// CHAINS - BƯỚC 1: LLMChain (CÁCH MỚI - LCEL)
//
// LCEL (LangChain Expression Language): nối các bước bằng .pipe(),
// thay cho các class chain cũ (LLMChain, SequentialChain...).
//
// prompt.pipe(model):
// 1. Điền biến vào prompt.
// 2. Gửi prompt cho model.
//
// Kết quả .pipe() cũng là 1 Runnable, chạy bằng chain.invoke({...biến}).
//
// So sánh với cách cũ: 01-llm-chain-legacy.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

const prompt = ChatPromptTemplate.fromTemplate(
  `What is a good name for a company that makes {product}? Only return the name, nothing else.`,
);

const chain = prompt.pipe(model);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Điền {product} vào prompt rồi gọi Gemini.
  const result = await chain.invoke({
    product: "Queen Size Sheet Set",
  });

  // Kết quả là AIMessage -> lấy text qua result.content.
  // LLMChain cũ trả { text: "..." }. Muốn ra string thẳng: thêm .pipe(new StringOutputParser()) (file 02).
  console.log("Company name:", result.content);
}

main();
