// =======================================================================
// CHAINS - BƯỚC 4: RouterChain (CÁCH CŨ - MultiPromptChain)
//
// Giống 1 lễ tân chuyển khách tới đúng phòng ban.
// 1. Destination chain: các chain chuyên biệt (physics, math, history, CS),
//    mỗi chain có prompt riêng cho chủ đề đó.
// 2. Router chain: đọc câu hỏi, chọn destination phù hợp.
//    Không khớp chủ đề nào -> trả "DEFAULT" -> rơi vào defaultChain.
//
// MultiPromptChain.fromLLMAndPrompts(): dựng sẵn router + destinations + default.
// Mỗi câu hỏi gọi Gemini 2 lần: 1 lần chọn destination, 1 lần trả lời.
//
// MultiPromptChain chưa deprecated, nhưng bên trong dùng LLMChain (đã deprecated).
// Cách mới thuần LCEL: 04-router-chain-lcel.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { MultiPromptChain } = require("@langchain/classic/chains");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// 3 mảng song song, cùng thứ tự: tên -> mô tả -> prompt của từng destination.
// Phần tử thứ i của 3 mảng thuộc cùng 1 destination. Lệch thứ tự -> router chọn sai prompt.
const promptNames = ["physics", "math", "history", "computer science"];

// Router đọc mô tả này để chọn destination.
const promptDescriptions = [
  "Good for answering questions about physics",
  "Good for answering math questions",
  "Good for answering questions about history",
  "Good for answering computer science questions",
];

const promptTemplates = [
  `You are a very smart physics professor. You are great at answering questions about physics in a concise and easy to understand manner. When you don't know the answer to a question you admit that you don't know.\n\nHere is a question:\n{input}`,
  `You are a very good mathematician. You are great at answering math questions. You are so good because you are able to break down hard problems into their component parts, answer the component parts, and then put them together to answer the broader question.\n\nHere is a question:\n{input}`,
  `You are a very good historian. You have an excellent knowledge of and understanding of people, events and contexts from a range of historical periods.\n\nHere is a question:\n{input}`,
  `You are a successful computer scientist. You have a passion for creativity, collaboration, forward-thinking, confidence, strong problem-solving capabilities.\n\nHere is a question:\n{input}`,
];

const chain = MultiPromptChain.fromLLMAndPrompts(model, {
  promptNames,
  promptDescriptions,
  promptTemplates,
});

// Hỏi 1 câu. Gọi Gemini 2 lần: 1 lần chọn destination, 1 lần trả lời.
async function ask(input) {
  const result = await chain.call({ input });

  console.log(`Q: ${input}`);
  console.log(`A: ${result.text}\n`);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Khớp destination "physics".
  await ask("What is black body radiation?");

  // Khớp destination "math".
  await ask("What is 2 + 2?");

  // Không khớp destination nào -> rơi về defaultChain (ConversationChain).
  await ask("Why does every cell in our body contain DNA?");
}

main();
