require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableSequence } = require("@langchain/core/runnables");

// =======================================================
// SimpleSequentialChain (cách viết MỚI - LCEL)
//
// Ý tưởng giống hệt bản cũ ("02-simple-sequential-chain-legacy.js"): nối
// nhiều bước chạy nối tiếp, output bước trước tự động thành input bước sau.
//
// Cách làm:
// - Mỗi bước là 1 chain nhỏ: prompt.pipe(model).pipe(parser).
//   StringOutputParser() giúp bước đó trả về 1 chuỗi text thuần (thay vì
//   1 AIMessage), để ghép thẳng được vào bước kế tiếp.
// - RunnableSequence.from([bước 1, bước 2, ...]) nối các bước lại thành
//   1 chain hoàn chỉnh, gọi bằng chain.invoke({...}).
// =======================================================

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Bước 1: Từ tên sản phẩm -> gọi API Gemini để gợi ý tên công ty. Dùng
// StringOutputParser để output là string thuần, ghép thẳng vào bước sau được luôn.
const nameChain = ChatPromptTemplate.fromTemplate(
  `What is a good name for a company that makes {input}? Only return the name, nothing else.`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Bước 2: Từ tên công ty -> gọi API Gemini để viết mô tả ngắn 20 từ.
const descriptionChain = ChatPromptTemplate.fromTemplate(
  `Write a 20-word description for the following company: {input}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Bước 1 trả về 1 chuỗi text thuần (tên công ty), nhưng prompt của bước 2
// lại cần input dạng object ({ input: "..." }). Vì vậy phải thêm 1 hàm
// nhỏ ở giữa để "gói" chuỗi đó lại thành đúng định dạng, trước khi đưa
// tiếp vào bước 2.
const overallChain = RunnableSequence.from([
  nameChain,
  (companyName) => ({ input: companyName }),
  descriptionChain,
]);

async function main() {
  // Chạy lần lượt 2 bước trên, mỗi bước là 1 lần gọi API Gemini.
  const result = await overallChain.invoke({ input: "Queen Size Sheet Set" });

  console.log("Final description:", result);
}

main();
