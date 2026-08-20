require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { MultiPromptChain } = require("@langchain/classic/chains");

// =======================================================
// RouterChain (cách viết CŨ - MultiPromptChain)
//
// Hình dung giống 1 lễ tân: có nhiều "phòng ban" chuyên biệt (physics,
// math, history, computer science), mỗi phòng ban là 1 chain riêng với
// prompt được viết riêng cho đúng chủ đề đó.
// - "destination chain": các chain chuyên biệt kể trên.
// - "router chain": đọc câu hỏi của user, rồi quyết định nên chuyển câu
//   hỏi đó cho destination chain nào (hoặc trả về "DEFAULT" nếu câu hỏi
//   không khớp chủ đề nào, lúc đó sẽ rơi vào defaultChain).
//
// MultiPromptChain.fromLLMAndPrompts() tự động dựng sẵn routerChain +
// tất cả destinationChains + defaultChain giúp mình, không cần tự viết.
// Mỗi câu hỏi sẽ tốn 2 lần gọi API Gemini: 1 lần để routerChain chọn
// destination, 1 lần để destination chain tương ứng trả lời.
//
// Lưu ý: MultiPromptChain KHÔNG bị đánh dấu lỗi thời (deprecated) trong
// bản langchain hiện tại, nhưng bên trong nó vẫn được dựng từ LLMChain
// đã deprecated. Xem file "04-router-chain-lcel.js" để so sánh cách
// viết mới, thuần LCEL.
// =======================================================

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const promptNames = ["physics", "math", "history", "computer science"];

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

async function ask(input) {
  // chain.call() gọi API Gemini 2 lần: routerChain chọn destination, rồi destination chain trả lời.
  const result = await chain.call({ input });

  console.log(`Q: ${input}`);
  console.log(`A: ${result.text}\n`);
}

async function main() {
  // Khớp destination "physics".
  await ask("What is black body radiation?");

  // Khớp destination "math".
  await ask("What is 2 + 2?");

  // Không khớp destination nào -> rơi về defaultChain (ConversationChain).
  await ask("Why does every cell in our body contain DNA?");
}

main();
