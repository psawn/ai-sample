require("dotenv").config();
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
/**
 * Hàm lấy completion từ OpenAI
 * @param {string} prompt - Câu lệnh đầu vào
 * @param {string} model - Mô hình sử dụng (mặc định gpt-3.5-turbo)
 * @returns {Promise<string>} - Nội dung trả về từ AI
 */
async function getCompletion(prompt, model = "gpt-3.5-turbo") {
  const messages = [{ role: "user", content: prompt }];

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0, // Độ ngẫu nhiên của phản hồi
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Lỗi khi gọi OpenAI API:", error);
    throw error;
  }
}

// Hàm chạy thử nghiệm
async function main() {
  const prompt = "Dịch từ 'Hello' sang tiếng Việt.";
  console.log("Đang chờ phản hồi...");
  const reply = await getCompletion(prompt);
  console.log("Phản hồi:", reply);
}

main();
