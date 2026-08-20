require("../_polyfill");
require("dotenv").config();
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

// Dot product giữa 2 vector embedding: giá trị càng cao -> 2 câu càng gần nghĩa nhau.
function dotProduct(a, b) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

// Khởi tạo mô hình Embedding của Gemini (model: gemini-embedding-001),
// dùng để gọi API Gemini, chuyển Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

async function main() {
  const sentence1 = "i like dogs";
  const sentence2 = "i like canines";
  const sentence3 = "the weather is ugly outside";

  // embedDocuments nhận 1 mảng câu và gộp thành 1 lần gọi API duy nhất
  // (thay vì gọi embedQuery riêng cho từng câu), trả vector theo đúng thứ tự.
  const [embedding1, embedding2, embedding3] = await embeddings.embedDocuments([
    sentence1,
    sentence2,
    sentence3,
  ]);

  console.log("embedding1", embedding1.slice(0, 10), "...");
  console.log("embedding2", embedding2.slice(0, 10), "...");
  console.log("embedding3", embedding3.slice(0, 10), "...");

  // dogs / canines cùng nghĩa nên dot product phải cao hơn hẳn so với weather (không liên quan).
  console.log("=== So sánh embedding ===");
  console.log("dogs vs canines:", dotProduct(embedding1, embedding2));
  console.log("dogs vs weather:", dotProduct(embedding1, embedding3));
  console.log("canines vs weather:", dotProduct(embedding2, embedding3));
}

main();
