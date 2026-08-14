require("dotenv").config();
const readline = require("readline");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-3.5-flash",
  generationConfig: {
    temperature: 0.7,
  },
});

// ======================================
// Context (Conversation History)
// ======================================
const context = [
  {
    role: "user",
    parts: [
      {
        text: `
You are a helpful assistant.
Always answer in Vietnamese.
`,
      },
    ],
  },
];

// ======================================
// Readline
// ======================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ======================================
// Chat
// ======================================
async function chat() {
  rl.question("\nBạn: ", async (input) => {
    if (input.toLowerCase() === "exit") {
      console.log("\nTạm biệt!");
      rl.close();
      return;
    }

    // 1. Thêm User Message vào Context
    context.push({
      role: "user",
      parts: [{ text: input }],
    });

    // 2. Log toàn bộ Context
    console.log("\n========== Context ==========");
    console.log(JSON.stringify(context, null, 2));
    console.log("=============================\n");

    try {
      console.log("Gemini đang suy nghĩ...\n");

      // 3. Gửi toàn bộ Context cho Gemini
      const result = await model.generateContent({
        contents: context,
      });

      const answer = result.response.text();

      console.log("Gemini:", answer);

      // 4. Thêm Assistant Message vào Context
      context.push({
        role: "model",
        parts: [{ text: answer }],
      });
    } catch (error) {
      console.error("Lỗi:", error);
    }

    // Tiếp tục chat
    chat();
  });
}

console.log("===== Simple Gemini Chatbot =====");
console.log("Gõ 'exit' để thoát.");

chat();
