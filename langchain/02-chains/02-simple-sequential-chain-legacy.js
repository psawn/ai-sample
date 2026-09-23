// =======================================================================
// CHAINS - BƯỚC 2: SimpleSequentialChain (CÁCH CŨ - LEGACY)
//
// Chạy nhiều chain nối tiếp theo 1 đường thẳng: output chain trước -> input chain sau.
// Luồng: tên sản phẩm -> tên công ty -> mô tả công ty.
//
// Giới hạn: mỗi chain con chỉ có đúng 1 input + 1 output, không có tên riêng.
// Cần nhiều input/output có tên -> SequentialChain (file 03).
//
// LLMChain và SimpleSequentialChain đã deprecated.
// Cách mới: 02-simple-sequential-chain-lcel.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { LLMChain, SimpleSequentialChain } = require("@langchain/classic/chains");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Chain 1: tên sản phẩm -> tên công ty.
const namePrompt = ChatPromptTemplate.fromTemplate(
  `What is a good name for a company that makes {input}? Only return the name, nothing else.`,
);
const nameChain = new LLMChain({ llm: model, prompt: namePrompt });

// Chain 2: tên công ty -> mô tả ngắn 20 từ.
const descriptionPrompt = ChatPromptTemplate.fromTemplate(
  `Write a 20-word description for the following company: {input}`,
);
const descriptionChain = new LLMChain({ llm: model, prompt: descriptionPrompt });

// Nối 2 chain: output chain 1 tự thành {input} của chain 2.
const overallChain = new SimpleSequentialChain({
  chains: [nameChain, descriptionChain],
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Chạy lần lượt 2 chain, mỗi chain gọi Gemini 1 lần.
  const result = await overallChain.run("Queen Size Sheet Set");

  console.log("Final description:", result);
}

main();
