// =======================================================================
// CHAINS - BƯỚC 4: RouterChain (CÁCH MỚI - LCEL + RunnableBranch)
//
// Có nhiều chain chuyên biệt theo chủ đề (physics, math, history, computer science).
// Phân loại câu hỏi trước, rồi chuyển cho đúng chain xử lý.
//
// Flow:
// 1. routerChain: Gemini trả đúng 1 từ là tên chủ đề (hoặc "general").
// 2. RunnablePassthrough.assign({ topic }): gắn topic vào object,
//    câu hỏi gốc vẫn giữ nguyên.
// 3. RunnableBranch: như chuỗi if/else. Kiểm tra lần lượt [điều kiện, chain],
//    đúng điều kiện nào thì chạy chain đó. Phần tử cuối (không điều kiện) là "else".
//
// So sánh với cách cũ: 04-router-chain-legacy.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const {
  RunnableSequence,
  RunnablePassthrough,
  RunnableBranch,
} = require("@langchain/core/runnables");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Prompt riêng cho từng chủ đề.
const promptTemplates = {
  physics: `You are a very smart physics professor. You are great at answering questions about physics in a concise and easy to understand manner. When you don't know the answer to a question you admit that you don't know.\n\nHere is a question:\n{input}`,
  math: `You are a very good mathematician. You are great at answering math questions. You are so good because you are able to break down hard problems into their component parts, answer the component parts, and then put them together to answer the broader question.\n\nHere is a question:\n{input}`,
  history: `You are a very good historian. You have an excellent knowledge of and understanding of people, events and contexts from a range of historical periods.\n\nHere is a question:\n{input}`,
  "computer science": `You are a successful computer scientist. You have a passion for creativity, collaboration, forward-thinking, confidence, strong problem-solving capabilities.\n\nHere is a question:\n{input}`,
};

// Tạo 1 chain chuyên biệt (destination chain) cho mỗi chủ đề.
const destinationChains = Object.fromEntries(
  Object.entries(promptTemplates).map(([topic, template]) => [
    topic,
    ChatPromptTemplate.fromTemplate(template)
      .pipe(model)
      .pipe(new StringOutputParser()),
  ]),
);

// Chain mặc định khi câu hỏi không thuộc chủ đề nào.
const generalChain = ChatPromptTemplate.fromTemplate(
  `You are a helpful assistant. Answer the following question:\n{input}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Router: chỉ trả đúng 1 từ là tên chủ đề (hoặc "general").
// Danh sách chủ đề lấy từ key của destinationChains -> thêm chủ đề không cần sửa prompt.
const topics = Object.keys(destinationChains);
const routerChain = ChatPromptTemplate.fromTemplate(
  `Given the user question below, classify it as one of: ${topics.join(", ")}, or "general" if none of them match.

Do not respond with more than one word.

<question>
{input}
</question>

Classification:`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Chain hoàn chỉnh: phân loại -> rẽ nhánh tới chain phù hợp.
// toLowerCase() + includes(): model có thể trả kèm dấu câu hoặc viết hoa (vd "Physics.").
const chain = RunnableSequence.from([
  RunnablePassthrough.assign({ topic: routerChain }),
  RunnableBranch.from([
    ...topics.map((topic) => [
      (input) => input.topic.toLowerCase().includes(topic),
      destinationChains[topic],
    ]),
    generalChain,
  ]),
]);

// Hỏi 1 câu. Gọi Gemini 2 lần: 1 lần phân loại, 1 lần trả lời.
async function ask(input) {
  const result = await chain.invoke({ input });

  console.log(`Q: ${input}`);
  console.log(`A: ${result}\n`);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Khớp destination "physics".
  await ask("What is black body radiation?");

  // Khớp destination "math".
  await ask("What is 2 + 2?");

  // Không khớp destination nào -> rơi về generalChain.
  await ask("Why does every cell in our body contain DNA?");
}

main();
