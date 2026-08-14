require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { LLMChain } = require("langchain/chains");

// =======================================================
// LLMChain (cách viết CŨ, dùng class LLMChain)
//
// "Chain" là cách LangChain gọi việc nối nhiều bước xử lý lại với nhau
// (ví dụ: Prompt -> Model -> ...) để không phải tự gọi tay từng bước một.
//
// LLMChain là chain đơn giản nhất, chỉ gồm 1 Prompt + 1 Model. Khi gọi
// chain.call({...biến}), nó tự động làm 2 việc:
// 1. Điền các biến vào Prompt (giống prompt.formatMessages()).
// 2. Gửi Prompt đã điền cho Model, tức gọi API Gemini để lấy câu trả lời
//    (giống model.invoke()).
//
// Lưu ý: class LLMChain đã bị đánh dấu lỗi thời (deprecated), sẽ bị xóa
// ở LangChain 1.0.0. Xem file "01-llm-chain-lcel.js" để biết cách viết
// mới mà LangChain khuyến nghị.
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

const chain = new LLMChain({
  llm: model,
  prompt,
});

async function main() {
  // chain.call() điền input vào prompt rồi gọi API Gemini để lấy câu trả lời.
  const result = await chain.call({
    product: "Queen Size Sheet Set",
  });

  // Kết quả trả về là object dạng { text: "..." }, câu trả lời nằm ở result.text.
  console.log("Company name:", result.text);
}

main();
