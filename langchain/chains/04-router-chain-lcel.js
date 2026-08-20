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

// =======================================================
// RouterChain (cách viết MỚI - LCEL, dùng RunnableBranch)
//
// Ý tưởng giống bản cũ ("04-router-chain-legacy.js"): có nhiều chain
// chuyên biệt theo chủ đề (physics, math, history, computer science),
// và 1 bước "phân loại" câu hỏi để biết nên đưa cho chain nào xử lý.
//
// Cách làm gồm 3 bước:
// 1. routerChain: gọi API Gemini với 1 prompt đơn giản, yêu cầu trả về
//    ĐÚNG 1 từ là tên chủ đề phù hợp nhất với câu hỏi (physics/math/
//    history/computer science), hoặc "general" nếu không khớp chủ đề nào.
// 2. RunnablePassthrough.assign({ topic: routerChain }) chạy routerChain
//    rồi gắn thêm kết quả đó (topic) vào input object - câu hỏi gốc vẫn
//    còn nguyên trong object, không bị mất.
// 3. RunnableBranch.from([...]) hoạt động như 1 chuỗi if/else: nhận vào
//    danh sách các cặp [điều kiện, chain xử lý], kiểm tra lần lượt từ
//    trên xuống, hễ điều kiện nào đúng thì chạy chain tương ứng rồi dừng
//    lại. Phần tử cuối cùng (không có điều kiện đi kèm) đóng vai trò
//    "else" - chạy khi không điều kiện nào khớp, tương đương defaultChain
//    ở bản cũ.
// =======================================================

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const promptTemplates = {
  physics: `You are a very smart physics professor. You are great at answering questions about physics in a concise and easy to understand manner. When you don't know the answer to a question you admit that you don't know.\n\nHere is a question:\n{input}`,
  math: `You are a very good mathematician. You are great at answering math questions. You are so good because you are able to break down hard problems into their component parts, answer the component parts, and then put them together to answer the broader question.\n\nHere is a question:\n{input}`,
  history: `You are a very good historian. You have an excellent knowledge of and understanding of people, events and contexts from a range of historical periods.\n\nHere is a question:\n{input}`,
  "computer science": `You are a successful computer scientist. You have a passion for creativity, collaboration, forward-thinking, confidence, strong problem-solving capabilities.\n\nHere is a question:\n{input}`,
};

// Tạo 1 destination chain cho mỗi topic ở trên.
const destinationChains = Object.fromEntries(
  Object.entries(promptTemplates).map(([topic, template]) => [
    topic,
    ChatPromptTemplate.fromTemplate(template)
      .pipe(model)
      .pipe(new StringOutputParser()),
  ]),
);

// Chain mặc định khi câu hỏi không thuộc topic nào ở trên.
const generalChain = ChatPromptTemplate.fromTemplate(
  `You are a helpful assistant. Answer the following question:\n{input}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// routerChain: chỉ trả về đúng 1 từ là tên topic (hoặc "general").
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

async function ask(input) {
  // chain.invoke() gọi API Gemini 2 lần: routerChain phân loại chủ đề, rồi destination chain tương ứng trả lời.
  const result = await chain.invoke({ input });

  console.log(`Q: ${input}`);
  console.log(`A: ${result}\n`);
}

async function main() {
  // Khớp destination "physics".
  await ask("What is black body radiation?");

  // Khớp destination "math".
  await ask("What is 2 + 2?");

  // Không khớp destination nào -> rơi về generalChain.
  await ask("Why does every cell in our body contain DNA?");
}

main();
