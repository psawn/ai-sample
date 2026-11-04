// =======================================================================
// GUARDRAILS - EMBEDDING + RAG ĐƠN GIẢN (KHÔNG CẦN VECTOR DB)
//
// Embedding: đổi text thành vector số. Text giống nghĩa → vector gần nhau.
// Cosine similarity: đo 2 vector "cùng hướng" đến đâu, ~1 = rất giống nghĩa.
//
// RAG 3 bước: embed câu hỏi → lấy top-k tài liệu gần nhất → LLM trả lời
// CHỈ dựa vào các tài liệu đó.
//
// Vector lưu trong RAM (mảng JS) vì chỉ có vài tài liệu, nên chưa cần vector DB
// như FAISS.
//
// Các file đang sử dụng:
//   - ../01-custom-rails/intent-rails-rag.js (dùng embedTexts, cosine cho intent rail)
//   - ../02-nemo/call-nemo-server.js
// =======================================================================

require("dotenv").config();

const dns = require("node:dns");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const { HR_DOCUMENTS } = require("./hr-docs");
const { logInfo, logPrompt } = require("./log");

const EMBEDDING_MODEL = "gemini-embedding-001";
// Model sinh câu trả lời: chọn model rẻ, vì câu hỏi đã qua guard
const CHAT_MODEL = "gemini-3.5-flash-lite";
const TOP_K = 2;

dns.setDefaultResultOrder("ipv4first");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

/** Embed nhiều đoạn text trong 1 request (batch) → mảng vector. */
async function embedTexts(texts) {
  const { embeddings } = await embeddingModel.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { role: "user", parts: [{ text }] },
    })),
  });
  return embeddings.map((e) => e.values);
}

/** Cosine similarity = (a·b) / (|a| × |b|). */
function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Tạo RAG. Tài liệu được embed 1 lần (lần hỏi đầu tiên), sau đó dùng lại.
 * Trả về { answer(question) → câu trả lời dạng text }.
 */
function createRag() {
  // Mỗi tài liệu kèm vector của nó: [{ title, content, vector }].
  // null = chưa embed.
  let index = null;

  async function getIndex() {
    if (index === null) {
      const texts = HR_DOCUMENTS.map((doc) => `${doc.title}\n${doc.content}`);
      const vectors = await embedTexts(texts);
      index = HR_DOCUMENTS.map((doc, i) => ({ ...doc, vector: vectors[i] }));
    }
    return index;
  }

  async function answer(question) {
    const docs = await getIndex();
    const [questionVector] = await embedTexts([question]);

    // Lấy TOP_K tài liệu gần câu hỏi nhất
    const sources = docs
      .map((doc) => ({ ...doc, score: cosine(questionVector, doc.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    const sourcesText = sources.map((s) => `${s.title} (${s.score.toFixed(2)})`).join(", ");
    logInfo(`Tài liệu tìm được: ${sourcesText}`);

    const prompt = [
      "Bạn là trợ lý chính sách HR của ABC Corp.",
      "Chỉ trả lời dựa vào các trích đoạn chính sách bên dưới, ngắn gọn, bằng tiếng Việt.",
      "Nếu trích đoạn không có thông tin, nói rõ và hướng dẫn liên hệ hr@abc.vn.",
      `Trích đoạn:\n${sources.map((s) => `[${s.title}] ${s.content}`).join("\n")}`,
      `Câu hỏi: ${question}`,
    ].join("\n\n");

    logPrompt("Prompt gửi LLM trả lời (RAG)", prompt);

    // temperature 0: câu trả lời ít thay đổi giữa các lần chạy → test ổn định hơn
    const model = genAI.getGenerativeModel({
      model: CHAT_MODEL,
      generationConfig: { temperature: 0 },
    });
    const result = await model.generateContent(prompt);
    const usage = result.response.usageMetadata;
    logInfo(`Token vào/ra: ${usage.promptTokenCount}/${usage.candidatesTokenCount}`);

    return result.response.text().trim();
  }

  return { answer };
}

module.exports = { embedTexts, cosine, createRag };
