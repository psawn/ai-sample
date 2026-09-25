// =======================================================================
// FLOW LOGGER: In log theo từng bước để dễ theo dõi luồng graph.
//
// 2 phần:
// - logStep / logDecision / logDetail: node và điểm rẽ nhánh tự gọi để in.
// - FlowLogger: callback của LangChain, tự in mọi lần gọi LLM (gửi gì, nhận gì)
//   và mọi lần retrieve. Gắn 1 lần ở main.js, không phải sửa từng chain.
//
// Mẫu log:
//   ════════════════════════════════════════
//   [1] 🔀 RẼ NHÁNH: ROUTE QUESTION
//   ════════════════════════════════════════
//     ▶ GỬI LLM (gemini-3.5-flash)
//       [system] You are an expert at routing ...
//       [human] agent memory?
//     ◀ LLM TRẢ VỀ
//       {"datasource":"vectorstore"}
//     ➜ QUYẾT ĐỊNH: ROUTE QUESTION TO RAG -> retrieve
// =======================================================================

const { BaseCallbackHandler } = require("@langchain/core/callbacks/base");

const { Colors } = require("../helpers/logger");

// Prompt dài (vd: chứa cả chunk) -> chỉ giữ đầu + cuối, cắt phần giữa.
// Giữ phần cuối vì câu hỏi thường nằm cuối prompt.
const HEAD_CHARS = 350;
const TAIL_CHARS = 150;
const LINE = "═".repeat(70);

let stepCount = 0; // Đánh số bước để thấy thứ tự chạy

// ===== 1. HÀM IN LOG CHO NODE / RẼ NHÁNH =====

/**
 * In tiêu đề 1 bước, có đánh số và đường kẻ phân cách.
 * - type "node": node trong graph (ghi dữ liệu vào state).
 * - type "edge": điểm rẽ nhánh (chỉ chọn đường đi tiếp).
 */
function logStep(type, name, description) {
  stepCount += 1;
  const label = type === "node" ? "⚙️  NODE" : "🔀 RẼ NHÁNH";
  const color = type === "node" ? Colors.CYAN : Colors.PURPLE;

  console.log(`\n${color}${LINE}`);
  console.log(`${Colors.BOLD}[${stepCount}] ${label}: ${name}${Colors.END}`);
  if (description) console.log(`${color}    ${description}`);
  console.log(`${LINE}${Colors.END}`);
}

/**
 * In quyết định của bước (vd: đi nhánh nào, chunk có liên quan không).
 */
function logDecision(message) {
  console.log(`${Colors.GREEN}  ➜ QUYẾT ĐỊNH: ${message}${Colors.END}`);
}

/**
 * In thông tin phụ, thụt lề cho dễ đọc.
 */
function logDetail(message) {
  console.log(`  • ${message}`);
}

// ===== 2. CALLBACK: TỰ IN MỌI LẦN GỌI LLM / RETRIEVE =====

/**
 * Callback gắn vào app.invoke(..., { callbacks: [new FlowLogger()] }).
 * LangChain tự gọi các hàm handle* bên dưới ở mọi chain/LLM/retriever bên trong.
 */
class FlowLogger extends BaseCallbackHandler {
  name = "flow-logger";

  // Chạy xong log rồi mới chạy tiếp -> log đúng thứ tự với log của node
  awaitHandlers = true;

  /** Trước khi gọi LLM: in các message gửi đi. */
  handleChatModelStart(llm, messages, runId, parentRunId, extra, tags, metadata) {
    const model = metadata?.ls_model_name ?? llm.id.at(-1);
    console.log(`${Colors.BLUE}  ▶ GỬI LLM (${model})${Colors.END}`);
    for (const message of messages[0]) {
      printBlock(shorten(`[${message.type}] ${toText(message.content)}`));
    }
  }

  /** Sau khi LLM trả lời: in đầy đủ nội dung trả về. */
  handleLLMEnd(output) {
    const message = output.generations[0][0].message;
    // Structured output: kết quả có thể nằm trong tool_calls thay vì content
    const result = message.tool_calls?.length
      ? JSON.stringify(message.tool_calls[0].args)
      : compactJson(toText(message.content));

    console.log(`${Colors.BLUE}  ◀ LLM TRẢ VỀ${Colors.END}`);
    printBlock(result);
  }

  /** Retriever tìm xong: in nguồn + đoạn đầu của từng chunk. */
  handleRetrieverEnd(documents) {
    console.log(`${Colors.BLUE}  ◀ CHROMA TRẢ VỀ ${documents.length} CHUNK${Colors.END}`);
    documents.forEach((doc, i) => {
      const preview = doc.pageContent.replace(/\s+/g, " ").slice(0, 100);
      printBlock(`(${i + 1}) ${doc.metadata.source}\n    "${preview}..."`);
    });
  }
}

// ===== 3. HELPER =====

/** Chuyển content của message (string hoặc mảng) thành chữ. */
function toText(content) {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** JSON in nhiều dòng -> gom về 1 dòng cho đồng nhất. Không phải JSON thì giữ nguyên. */
function compactJson(text) {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

/** Quá dài -> giữ phần đầu + phần cuối, cắt phần giữa. */
function shorten(text) {
  if (text.length <= HEAD_CHARS + TAIL_CHARS) return text;
  const cut = text.length - HEAD_CHARS - TAIL_CHARS;
  return `${text.slice(0, HEAD_CHARS)}\n[... cắt ${cut} ký tự ...]\n${text.slice(-TAIL_CHARS)}`;
}

/** In đoạn chữ thụt lề 6 khoảng. */
function printBlock(text) {
  console.log(text.replace(/^/gm, "      "));
}

module.exports = { FlowLogger, logStep, logDecision, logDetail };
