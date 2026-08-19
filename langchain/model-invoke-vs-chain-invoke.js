require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const prompt = ChatPromptTemplate.fromTemplate(
  `Trả lời trong đúng 1 câu: thủ đô của {country} là gì?`,
);

/**
 * 1. model.invoke() — Tự tay làm mọi thứ (Low-level)
 * Model AI thực ra không hiểu object biến { country: "Việt Nam" }. Nó chỉ hiểu văn bản thuần túy hoặc danh sách các tin nhắn (messages).
 *
 * Cách hoạt động:
 * 1. Tự gọi prompt.formatMessages({ country: "Việt Nam" }) để biến template thành mảng messages hoàn chỉnh.
 * 2. Truyền messages đó vào model.invoke(messages).
 * 3. Model trả về một object phức tạp gọi là AIMessage chứa rất nhiều metadata (thông tin token, ID,...) và nội dung chính nằm ở response.content.
 *
 * Khi nào dùng: Khi chỉ cần gọi model 1 lần với dữ liệu (messages) đã chuẩn bị sẵn, không cần ghép nhiều bước lại với nhau.
 */
async function demoModelInvoke() {
  const messages = await prompt.formatMessages({ country: "Việt Nam" });

  const response = await model.invoke(messages);

  console.log("=== model.invoke ===");
  console.log("Input:  messages đã format sẵn");
  console.log("Output: AIMessage -> response.content =", response.content);
}

/**
 * 2. chain.invoke() — Giao việc cho dây chuyền tự động (High-level)
 * Dùng .pipe() để nối các bước lại thành 1 Pipeline (đường ống xử lý) duy nhất:
 * prompt.pipe(model).pipe(new StringOutputParser()).
 *
 * Cách hoạt động: chỉ cần đưa 1 object chứa biến vào chain.invoke({ country: "Nhật Bản" }),
 * pipeline sẽ tự chạy lần lượt từng bước:
 * 1. Điền biến vào Prompt để ra messages.
 * 2. Đưa messages đó vào model.invoke() để lấy AIMessage.
 * 3. Đưa AIMessage đó qua StringOutputParser để bóc ra string thuần.
 *
 * Khi nào dùng: Trong hầu hết các ứng dụng thực tế, vì code ngắn gọn, sạch sẽ và tự động hóa hoàn toàn các bước lặp đi lặp lại.
 */
async function demoChainInvoke() {
  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  const answer = await chain.invoke({ country: "Nhật Bản" });

  console.log("\n=== chain.invoke ===");
  console.log("Input:  object biến gốc, chưa qua xử lý gì");
  console.log("Output: string đã parse sẵn ->", answer);
}

async function main() {
  await demoModelInvoke();
  await demoChainInvoke();
}

main();
