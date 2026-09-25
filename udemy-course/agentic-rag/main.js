// =======================================================================
// MAIN: Điểm chạy chính của Agentic RAG.
// - Lưu sơ đồ graph ra ảnh PNG.
// - Hỏi thử 1 câu và in kết quả.
//
// Chạy: node udemy-course/agentic-rag/main.js
// Cần chạy Chroma server trước: npx chroma run --path ./chroma-data
// =======================================================================

// Phải chạy trước khi require graph: các chain đọc API key từ .env ngay lúc load
require("../../langchain/_polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { awaitAllCallbacks } = require("@langchain/core/callbacks/promises");

const { FlowLogger } = require("./flow-logger");
const { app } = require("./graph/graph");

async function main() {
  console.log("Hello Advanced RAG");

  // Lưu sơ đồ graph ra file ảnh (vẽ qua mermaid.ink trên mạng).
  // Chỉ là phụ -> lỗi mạng thì cảnh báo rồi chạy tiếp, không dừng chương trình.
  try {
    const graphView = await app.getGraphAsync();
    const image = await graphView.drawMermaidPng();
    const imagePath = path.join(__dirname, "../../images/agentic-rag-graph.png");
    fs.writeFileSync(imagePath, Buffer.from(await image.arrayBuffer()));
  } catch (e) {
    console.log(`⚠️  Không vẽ được sơ đồ graph: ${e.message}`);
  }

  // Chạy graph với câu hỏi mẫu.
  // Tham số thứ 2 (config) chỉ để dễ tìm trace trên LangSmith:
  // - runName: tên dòng trace gốc (mặc định là "LangGraph", khó phân biệt).
  // - tags / metadata: dùng để lọc trace trên giao diện LangSmith.
  // - callbacks: FlowLogger in ra terminal mọi lần gọi LLM (gửi gì, nhận gì).
  const result = await app.invoke(
    { question: "agent memory?" },
    {
      runName: "agentic-rag",
      tags: ["agentic-rag", "udemy-course"],
      metadata: { model: "gemini-3.5-flash" },
      callbacks: [new FlowLogger()],
    },
  );

  // Chỉ in câu trả lời + nguồn, không in cả state (rất dài)
  const sources = [...new Set(result.documents.map((doc) => doc.metadata.source ?? "web search"))];
  console.log(`\n${"═".repeat(70)}\nKẾT QUẢ\n${"═".repeat(70)}`);
  console.log(`Câu hỏi : ${result.question}`);
  console.log(`Trả lời : ${result.generation}`);
  console.log(`Nguồn   :\n${sources.map((s) => `  - ${s}`).join("\n")}`);
}

// awaitAllCallbacks: chờ gửi hết trace lên LangSmith rồi mới thoát chương trình
main().catch(console.error).finally(awaitAllCallbacks);
