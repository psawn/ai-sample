// =======================================================================
// LANGCHAIN BASICS - 3 CÁCH GỌI MODEL: invoke / batch / stream
//
// 1. invoke(): 1 input -> đợi xong -> nhận toàn bộ kết quả.
// 2. batch(): nhiều input -> chạy song song -> nhận mảng kết quả.
// 3. stream(): 1 input -> nhận từng mẩu text ngay khi model sinh ra.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// 1. invoke(): đợi model trả lời xong rồi mới nhận kết quả.
// Dùng khi chỉ cần 1 câu trả lời, không cần hiển thị dần.
async function demoInvoke() {
  const response = await llm.invoke("Give me 4 good books to read");

  console.log("=== llm.invoke ===");
  console.log(response.content);
}

// 2. batch(): gửi nhiều input độc lập, xử lý song song.
// Kết quả là mảng, đúng thứ tự input.
// Dùng khi có nhiều câu hỏi không phụ thuộc nhau (nhanh hơn gọi invoke() lần lượt).
// Nhiều input quá -> dễ bị rate limit. Giới hạn số request song song: batch(inputs, { maxConcurrency }).
async function demoBatch() {
  const responses = await llm.batch(["Hello", "Give me 4 good books to read"]);

  console.log("\n=== llm.batch ===");
  responses.forEach((response, i) => console.log(`[${i}]`, response.content));
}

// 3. stream(): nhận từng chunk ngay khi model sinh ra.
// Dùng khi muốn hiển thị chữ chạy dần, người dùng không phải chờ.
// process.stdout.write() thay console.log(): các chunk nối liền, không xuống dòng sau mỗi chunk.
async function demoStream() {
  console.log("\n=== llm.stream ===");

  const stream = await llm.stream("Give me 4 good books to read");

  for await (const chunk of stream) {
    process.stdout.write(chunk.content);
  }

  console.log();
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await demoInvoke();
  await demoBatch();
  await demoStream();
}

main();
