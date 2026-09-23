// =======================================================================
// CHAINS - BƯỚC 2: SimpleSequentialChain (CÁCH MỚI - LCEL)
//
// Chạy nhiều bước nối tiếp: output bước trước -> input bước sau.
// Luồng: tên sản phẩm -> tên công ty -> mô tả công ty.
//
// Cách làm:
// 1. Mỗi bước là 1 chain nhỏ: prompt.pipe(model).pipe(parser).
//    StringOutputParser: trả string thuần, thay vì AIMessage.
// 2. RunnableSequence.from([bước 1, bước 2, ...]): nối các bước lại.
//
// So sánh với cách cũ: 02-simple-sequential-chain-legacy.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableSequence } = require("@langchain/core/runnables");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Bước 1: tên sản phẩm -> tên công ty (string thuần).
const nameChain = ChatPromptTemplate.fromTemplate(
  `What is a good name for a company that makes {input}? Only return the name, nothing else.`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Bước 2: tên công ty -> mô tả ngắn 20 từ.
const descriptionChain = ChatPromptTemplate.fromTemplate(
  `Write a 20-word description for the following company: {input}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Bước 1 trả string, nhưng prompt bước 2 cần object { input }.
// -> Thêm 1 hàm nhỏ ở giữa để "gói" string thành object.
// Hàm thường đặt trong RunnableSequence tự được bọc thành RunnableLambda.
const overallChain = RunnableSequence.from([
  nameChain,
  (companyName) => ({ input: companyName }),
  descriptionChain,
]);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Chạy lần lượt 2 bước, mỗi bước gọi Gemini 1 lần.
  const result = await overallChain.invoke({ input: "Queen Size Sheet Set" });

  console.log("Final description:", result);
}

main();
