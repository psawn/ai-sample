require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

async function ask(input) {
  // Gọi API Gemini chỉ với câu hỏi hiện tại, không kèm lịch sử hội thoại trước đó.
  const response = await model.invoke(input);

  console.log(`User: ${input}`);
  console.log(`AI: ${response.content}\n`);
}

async function main() {
  await ask("Xin chào, tôi tên là An.");
  console.log("\n==============================\n");

  await ask("Tên tôi là gì?");
  console.log("\n==============================\n");
}

main();
