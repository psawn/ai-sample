require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const INPUT_FILE = path.join(__dirname, "animal.json");
const OUTPUT_FILE = path.join(__dirname, "animal-embeddings.json");
const EMBEDDING_MODEL = "gemini-embedding-001";

async function embedText(model, text) {
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function main() {
  const animals = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  console.log(`Đang tính embedding cho ${animals.length} mục...`);

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
