require("../../_shared/polyfill");

// =======================================================================
// OBSERVABILITY 1: LANGSMITH — THEO DÕI CODE TỰ VIẾT (CUSTOM TRACING)
//
// 1. LangSmith là gì?
//    Trang web ghi lại toàn bộ hoạt động của ứng dụng AI trong mỗi lần chạy:
//    hàm nào được gọi, input/output là gì, thời gian thực thi (latency),
//    và số lượng token tiêu thụ. Giống như "camera hành trình" của app AI.
//
// 2. Bài toán giải quyết:
//    - Khi dùng LangChain / LangGraph, bật LANGSMITH_TRACING=true trong .env
//      là hệ thống tự động ghi lại mọi thứ.
//    - Nhưng với **code tự viết** (VD: hàm search tùy chỉnh, gọi trực tiếp
//      thư viện Gemini SDK, code NestJS sau này), LangSmith sẽ không thấy.
//    - Giải pháp: Bọc hàm bằng wrapper `traceable()`, LangSmith sẽ theo dõi
//      và ghi lại hàm đó.
//
// 3. Ba khái niệm cốt lõi cần nắm:
//    - Run      : Bản ghi của 1 lần gọi hàm (input, output, thời gian, lỗi).
//    - Trace    : Cây phả hệ gồm tất cả các run trong 1 câu hỏi từ user.
//                 (Hàm A gọi hàm B thì run của B sẽ nằm lồng bên trong run của A).
//    - run_type : Phân loại hàm để LangSmith hiển thị biểu tượng và thống kê chuẩn:
//                 * "chain" = hàm điều phối, gọi các hàm khác theo thứ tự.
//                 * "tool"  = hàm lấy/xử lý dữ liệu (search, gọi API ngoài...).
//                 * "llm"   = hàm gọi AI model (giúp LangSmith hiện token và model).
//
// 4. Cấu trúc bài học (4 phần):
//    - Phần 1: Bọc hàm tự viết bằng `traceable`, xem chúng lồng nhau thành cây trace.
//    - Phần 2: Gọi trực tiếp Gemini SDK mà LangSmith vẫn hiển thị token và tên model.
//    - Phần 3: Gắn kèm thông tin `user_id` vào trace để dễ dàng lọc theo từng người dùng.
//    - Phần 4: Che giấu thông tin cá nhân (PII như email, SĐT) trước khi đẩy lên LangSmith.
//
// Cấu trúc cây trace mẫu trên giao diện LangSmith:
//    support_qa (chain)              <- Phần 3: Gắn user_id, session_id
//    └── doc_qa (chain)              <- Phần 1: Hàm điều phối logic Q&A
//        ├── search_docs (tool)      <- Phần 1: Hàm tìm kiếm tài liệu
//        └── gemini_generate (llm)   <- Phần 2: Hàm gọi LLM (hiển thị token, model)
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/01-observability/01-langsmith-custom-tracing.js
// =======================================================================

require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Client } = require("langsmith");
const { createAnonymizer } = require("langsmith/anonymizer");
const { traceable, getCurrentRunTree } = require("langsmith/traceable");

const MODEL = "gemini-3.5-flash-lite";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Khởi tạo LangSmith Client ("người đưa thư" gom các run lại rồi đẩy lên hệ thống).
// Cấu hình anonymizer: Chạy hàm maskPII để che email, số điện thoại trước khi gửi.
// Vì Client này được dùng chung cho các hàm bên dưới, mọi run đều được bảo mật tự động.
const langsmith = new Client({
  anonymizer: createAnonymizer((text) => maskPII(text)),
});

// Tài liệu mẫu dùng để minh họa tìm kiếm (trong thực tế sẽ dùng Vector DB / RAG)
const MOCK_DOCS = [
  "Prompt injection: attacker chèn lệnh vào input hoặc tài liệu để model bỏ qua system prompt. Phòng: input guardrail, tách rõ dữ liệu và lệnh, least privilege cho tool.",
  "PII leakage: model hoặc log làm lộ email, số điện thoại, số thẻ. Phòng: phát hiện và che PII ở input, output và cả trong log/trace.",
  "LLM gateway: lớp trung gian quản lý mọi LLM call: routing, fallback, rate limit, cache, kiểm soát chi phí.",
  "Observability: log, trace, metric cho từng bước của agent để debug, đo latency, token và chi phí.",
];

/** Hàm tiện ích in tiêu đề từng phần ra console */
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

// -----------------------------------------------------------------------
// PHẦN 1: BỌC HÀM TỰ VIẾT BẰNG TRACEABLE
// -----------------------------------------------------------------------
// Cú pháp: traceable(hamGoc, { name, run_type, client })
// - Gọi hàm được bọc vẫn hoạt động y hệt hàm gốc, kèm theo việc ghi nhận trace.
// - Các hàm traceable lồng nhau sẽ tự động tạo thành cây quan hệ (cha - con).

/**
 * Hàm search: Tách từ khóa từ câu hỏi và tìm các tài liệu khớp nhất.
 */
const searchDocs = traceable(
  async (query) => {
    // Lọc bỏ các từ quá ngắn (<= 3 ký tự) như "là", "gì", "về"
    const keywords = query
      .toLowerCase()
      .split(/[\s,.?!]+/)
      .filter((word) => word.length > 3);

    // Chấm điểm mức độ liên quan của từng tài liệu
    const scored = MOCK_DOCS.map((doc) => ({
      doc,
      score: keywords.filter((word) => doc.toLowerCase().includes(word)).length,
    }));

    // Lọc lấy tối đa 2 tài liệu có điểm cao nhất (> 0)
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => item.doc);
  },
  { name: "search_docs", run_type: "tool", client: langsmith },
);

/**
 * Hàm docQA: Kết hợp tìm kiếm tài liệu và gọi Gemini để sinh câu trả lời.
 * Bên trong gọi 2 hàm traceable khác, nên LangSmith sẽ tự dựng thành cây trace.
 */
const docQA = traceable(
  async (question) => {
    const docs = await searchDocs(question); // Run con thứ 1 (chạy trước): search_docs (tool)
    const prompt = [
      "Dựa vào context, trả lời ngắn gọn bằng tiếng Việt.",
      `Context:\n${docs.join("\n")}`,
      `Câu hỏi: ${question}`,
    ].join("\n\n");

    const { text } = await geminiGenerate(prompt); // Run con thứ 2 (chạy sau, ngang hàng search_docs): gemini_generate (llm)
    return text;
  },
  { name: "doc_qa", run_type: "chain", client: langsmith },
);

// -----------------------------------------------------------------------
// PHẦN 2: GỌI TRỰC TIẾP GEMINI SDK NHƯNG VẪN THỐNG KÊ ĐƯỢC TOKEN & MODEL
// -----------------------------------------------------------------------
// Khi dùng LangChain, LangSmith tự nhận diện model và token.
// Khi gọi SDK gốc (GoogleGenerativeAI), ta phải tự cung cấp 2 thông tin:
// 1. Tên model & nhà cung cấp: thông qua `getInvocationParams`.
// 2. Số lượng token tiêu thụ: trả về trong trường `usage_metadata` theo chuẩn LangSmith.
// Khi đáp ứng đủ, giao diện LangSmith sẽ hiển thị chính xác chi phí và thông số token.
// -----------------------------------------------------------------------

const geminiGenerate = traceable(
  async (prompt) => {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);

    const usage = result.response.usageMetadata;
    return {
      text: result.response.text(),
      usage_metadata: {
        input_tokens: usage.promptTokenCount, // Số token đầu vào (prompt)
        output_tokens: usage.candidatesTokenCount, // Số token đầu ra (completion)
        total_tokens: usage.totalTokenCount, // Tổng số token
      },
    };
  },
  {
    name: "gemini_generate",
    run_type: "llm",
    client: langsmith,
    getInvocationParams: () => ({
      ls_provider: "google",
      ls_model_name: MODEL,
    }),
  },
);

// -----------------------------------------------------------------------
// PHẦN 3: GẮN KÈM THÔNG TIN USER (METADATA & TAGS)
// -----------------------------------------------------------------------
// Giúp trả lời các câu hỏi quản trị sau này như: "User nào tốn nhiều token nhất?",
// "Phiên chat nào gặp nhiều lỗi?".
//
// - getCurrentRunTree() : Lấy ra ngữ cảnh run hiện tại để bổ sung thông tin.
// - metadata            : Lưu dữ liệu dạng key-value (VD: user_id, session_id).
// - tags                : Gắn nhãn ngắn gọn để phân loại nhanh (VD: "support-bot").
//
// ⚠️ LƯU Ý QUAN TRỌNG: Nên dùng mã định danh nội bộ (VD: "u_123"), tránh dùng
// trực tiếp email/SĐT làm user_id. Lý do: Phần 4 sẽ che toàn bộ metadata,
// khiến email bị đổi thành "<EMAIL>" và mất khả năng lọc theo user thực tế.
// -----------------------------------------------------------------------

const supportQA = traceable(
  async ({ question, userId, sessionId }) => {
    const run = getCurrentRunTree();
    run.metadata = { ...run.metadata, user_id: userId, session_id: sessionId };
    run.tags = [...(run.tags ?? []), "support-bot"];

    return docQA(question); // doc_qa và các run con sẽ được gom chung dưới support_qa
  },
  { name: "support_qa", run_type: "chain", client: langsmith },
);

// -----------------------------------------------------------------------
// PHẦN 4: ANONYMIZATION — CHE THÔNG TIN CÁ NHÂN (PII LEAKAGE PROTECTION)
// -----------------------------------------------------------------------
// PII (Personally Identifiable Information) là thông tin định danh cá nhân:
// email, số điện thoại, số thẻ tín dụng,...
// Khi người dùng nhập email vào app, dữ liệu đó sẽ bị đẩy lên cloud của LangSmith.
//
// Cơ chế hoạt động của bộ lọc Anonymizer:
//   User nhập: "Email tôi là an@gmail.com"
//     ├─► Ứng dụng chạy với chuỗi GỐC: Gemini vẫn đọc được email để xử lý bình thường.
//     └─► LangSmith Client chuẩn bị đẩy dữ liệu lên cloud:
//           └─► Chạy qua `maskPII()` để ẩn danh thành: "Email tôi là <EMAIL>"
//
// Lưu ý quan trọng:
// - `maskPII` chỉ thực thi lúc ĐẨY dữ liệu lên LangSmith, app nội bộ không bị ảnh hưởng.
// - Cơ chế này che tự động cả input, output, metadata và cả thông báo lỗi (error logs).
// -----------------------------------------------------------------------

/**
 * Thay thế email, số thẻ, số điện thoại bằng các nhãn che tương ứng.
 * (Đây là biểu thức regex cơ bản minh họa; thực tế nên dùng thư viện phát hiện PII chuyên dụng).
 */
function maskPII(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<EMAIL>") // Định dạng email
    .replace(/\b(?:\d[ -]?){13,16}\b/g, "<CARD>") // Số thẻ ngân hàng (13-16 chữ số)
    .replace(/\b0\d{9}\b/g, "<PHONE>"); // Số điện thoại Việt Nam (0 đầu + 9 số)
}

// -----------------------------------------------------------------------
// CHẠY THỬ NGHIỆM (MAIN FUNCTION)
// -----------------------------------------------------------------------

async function main() {
  if (!process.env.LANGSMITH_API_KEY) {
    console.log(
      "⚠️ Chưa có LANGSMITH_API_KEY: Code vẫn chạy cục bộ nhưng không đẩy trace lên cloud được.",
    );
  }

  section("PHẦN 1 + 2: Kiểm tra các hàm lồng nhau và theo dõi LLM trực tiếp");
  const question = "Làm sao phòng prompt injection?";
  console.log(`Q: ${question}\nA: ${await docQA(question)}`);

  section(
    "PHẦN 3 + 4: Gắn kèm user_id và kiểm tra cơ chế che PII (Email / SĐT)",
  );
  const requests = [
    {
      userId: "an",
      sessionId: "s1",
      question: "PII leakage là gì? Email tôi là an.nguyen@gmail.com",
    },
    {
      userId: "binh",
      sessionId: "s2",
      question: "LLM gateway dùng để làm gì? Gọi tôi qua 0912345678",
    },
  ];

  for (const req of requests) {
    console.log(
      `[User: ${req.userId}] Q: ${req.question}\n             A: ${await supportQA(req)}`,
    );
  }

  // LangSmith Client gom các trace lại thành từng batch gửi đi để tối ưu mạng.
  // Cần gọi `awaitPendingTraceBatches()` trước khi thoát script để tránh mất dữ liệu cuối.
  await langsmith.awaitPendingTraceBatches();
}

main().catch(console.error);
