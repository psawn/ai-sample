// =======================================================================
// OPENAI - GỌI CHAT COMPLETION CƠ BẢN
//
// 1. Gửi prompt dạng messages [{ role, content }] lên OpenAI.
// 2. Nhận câu trả lời ở response.choices[0].message.content.
// =======================================================================

require("dotenv").config();
const { OpenAI } = require("openai");

// Client đọc API key từ .env.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Gửi 1 prompt, trả về câu trả lời dạng text.
async function getCompletion(prompt, model = "gpt-3.5-turbo") {
  const messages = [{ role: "user", content: prompt }];

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0, // 0 = ít ngẫu nhiên, cùng prompt cho kết quả gần giống nhau
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Lỗi khi gọi OpenAI API:", error);
    throw error;
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const prompt = "Dịch từ 'Hello' sang tiếng Việt.";
  console.log("Đang chờ phản hồi...");
  const reply = await getCompletion(prompt);
  console.log("Phản hồi:", reply);
}

main();
