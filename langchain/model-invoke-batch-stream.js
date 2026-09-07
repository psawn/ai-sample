require("./_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// 1. invoke() — Gửi 1 input, đợi model trả lời xong toàn bộ rồi mới nhận kết quả.
// Dùng khi chỉ cần 1 câu trả lời và không quan tâm hiển thị dần theo thời gian thực.
async function demoInvoke() {
  const response = await llm.invoke("Give me 4 good books to read");

  console.log("=== llm.invoke ===");
  console.log(response.content);
}

// 2. batch() — Gửi nhiều input độc lập cùng lúc, model xử lý song song,
// kết quả trả về là mảng đúng theo thứ tự input. Dùng khi có nhiều câu hỏi
// không phụ thuộc nhau, thay vì gọi invoke() tuần tự cho từng cái.
async function demoBatch() {
  const responses = await llm.batch(["Hello", "Give me 4 good books to read"]);

  console.log("\n=== llm.batch ===");
  responses.forEach((response, i) => console.log(`[${i}]`, response.content));
}

// 3. stream() — Nhận kết quả dần theo từng chunk ngay khi model sinh ra, thay vì
// đợi xong toàn bộ như invoke(). Dùng khi muốn hiển thị chữ chạy dần (như ChatGPT).
// Mỗi chunk chỉ là 1 mẩu text ngắn, console.log() sẽ tự xuống dòng sau mỗi chunk
// -> in rời rạc, nên dùng process.stdout.write() để nối liền chunk trên cùng dòng.
async function demoStream() {
  console.log("\n=== llm.stream ===");

  const stream = await llm.stream("Give me 4 good books to read");

  for await (const chunk of stream) {
    process.stdout.write(chunk.content);
  }

  console.log();
}

async function main() {
  await demoInvoke();
  await demoBatch();
  await demoStream();
}

main();
