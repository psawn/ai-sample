require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

// =======================================================
// LLMChain (cách viết MỚI, dùng LCEL)
//
// LCEL (LangChain Expression Language) là cách viết chain mới, thay thế
// cho các class chain cũ (LLMChain, SequentialChain...). Thay vì tạo ra
// 1 class riêng, mình chỉ cần "nối" các bước lại bằng hàm .pipe():
//
//   prompt.pipe(model)
//
// nghĩa là:
// 1. Nhận input.
// 2. Đưa qua prompt để điền biến.
// 3. Đưa tiếp kết quả đó qua model để gọi API Gemini lấy câu trả lời.
//
// Chuỗi các bước nối bằng .pipe() như vậy được gọi là 1 "Runnable", và được
// chạy bằng chain.invoke({...biến}) (tương đương chain.call() ở bản cũ).
//
// So sánh với cách viết cũ ở file "01-llm-chain-legacy.js".
// =======================================================

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

async function main() {
  // chain.invoke() điền input vào prompt rồi gọi API Gemini để lấy câu trả lời.
  const result = await chain.invoke({
    product: "Queen Size Sheet Set",
  });

  // Kết quả trả về là 1 AIMessage (khác với LLMChain cũ trả về { text: "..." }),
  // nên lấy câu trả lời qua result.content.
  console.log("Company name:", result.content);
}

main();
