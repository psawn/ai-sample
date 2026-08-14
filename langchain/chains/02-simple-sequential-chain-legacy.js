require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { LLMChain, SimpleSequentialChain } = require("langchain/chains");

// =======================================================
// SimpleSequentialChain (cách viết CŨ)
//
// Dùng khi cần chạy NHIỀU chain nối tiếp nhau theo 1 đường thẳng: kết
// quả (output) của chain này tự động trở thành đầu vào (input) của
// chain kế tiếp. Ví dụ trong file này: tên sản phẩm -> tên công ty ->
// mô tả công ty.
//
// Giới hạn: mỗi chain con chỉ được có ĐÚNG 1 input và 1 output, và giá
// trị đó không có tên riêng (chỉ là 1 chuỗi text, không phải object có
// key). Nếu cần nhiều input/output có tên, phải dùng SequentialChain
// (xem file 03).
//
// Lưu ý: LLMChain và SimpleSequentialChain đều đã bị đánh dấu lỗi thời
// (deprecated), sẽ bị xóa ở LangChain 1.0.0. Xem file
// "02-simple-sequential-chain-lcel.js" để so sánh cách viết mới bằng LCEL.
// =======================================================

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Chain 1: Từ tên sản phẩm -> gọi API Gemini để gợi ý tên công ty.
const namePrompt = ChatPromptTemplate.fromTemplate(
  `What is a good name for a company that makes {input}? Only return the name, nothing else.`,
);
const nameChain = new LLMChain({ llm: model, prompt: namePrompt });

// Chain 2: Từ tên công ty -> gọi API Gemini để viết mô tả ngắn 20 từ.
const descriptionPrompt = ChatPromptTemplate.fromTemplate(
  `Write a 20-word description for the following company: {input}`,
);
const descriptionChain = new LLMChain({ llm: model, prompt: descriptionPrompt });

const overallChain = new SimpleSequentialChain({
  chains: [nameChain, descriptionChain],
});

async function main() {
  // Chạy lần lượt 2 chain trên, mỗi chain là 1 lần gọi API Gemini.
  const result = await overallChain.run("Queen Size Sheet Set");

  console.log("Final description:", result);
}

main();
