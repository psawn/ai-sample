// =======================================================================
// EMBEDDING - TẠO VECTOR CHO DANH SÁCH CON VẬT
//
// Embedding: đổi text thành vector số. Text giống nghĩa -> vector gần nhau.
//
// Flow:
// 1. Đọc animal.json (mảng text).
// 2. Embed từng mục.
// 3. Lưu ra animal-embeddings.json: [{ text, embedding }].
// =======================================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const INPUT_FILE = path.join(__dirname, "animal.json");
const OUTPUT_FILE = path.join(__dirname, "animal-embeddings.json");
const EMBEDDING_MODEL = "gemini-embedding-001";

// Gọi model lấy vector embedding của 1 đoạn text (mảng số, 3072 chiều với gemini-embedding-001).
async function embedText(model, text) {
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function main() {
  const animals = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  console.log(`Đang tính embedding cho ${animals.length} mục...`);

  // Embed tuần tự từng mục, không gọi song song, để tránh rate limit.
  const results = [];
  for (const [index, text] of animals.entries()) {
    const embedding = await embedText(model, text);
    results.push({ text, embedding });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");
  console.log(`Đã lưu embedding vào ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error("Lỗi khi tính embedding:", error);
  process.exit(1);
});
