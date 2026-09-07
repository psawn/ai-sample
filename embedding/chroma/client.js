require("dotenv").config();
const { ChromaClient } = require("chromadb");
const { DefaultEmbeddingFunction } = require("@chroma-core/default-embed");
const { GoogleGeminiEmbeddingFunction } = require("@chroma-core/google-gemini");

const client = new ChromaClient({
  host: process.env.CHROMA_HOST || "localhost",
  port: Number(process.env.CHROMA_PORT) || 8000,
});

const documents = [
  "Con chó chạy trong công viên",
  "Con mèo ngủ trên ghế sofa",
  "Máy bay cất cánh từ sân bay",
];
const queryText = "con vật ngoài đường";

const defaultEmbeddingFunction = new DefaultEmbeddingFunction();
const geminiEmbeddingFunction = new GoogleGeminiEmbeddingFunction({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: "gemini-embedding-001",
});

async function queryWith(name, embeddingFunction) {
  const collection = await client.getOrCreateCollection({ name, embeddingFunction });

  await collection.add({ ids: ["1", "2", "3"], documents });

  return collection.query({ queryTexts: [queryText], nResults: 1 });
}

async function main() {
  const defaultResult = await queryWith("data-test", defaultEmbeddingFunction);
  const geminiResult = await queryWith("data-test-gemini", geminiEmbeddingFunction);

  console.log(`Query: "${queryText}"\n`);
  console.log("Default:", defaultResult);
  console.log("Gemini:", geminiResult);
}

main();
