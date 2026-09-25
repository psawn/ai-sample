// =======================================================================
// DEMO: REFLEXION AGENT BẰNG LANGGRAPH
//
// Ý tưởng: LLM tự trả lời -> tự chỉ ra điểm thiếu sót -> đề xuất từ khóa
// -> search web lấy dữ liệu thực tế -> viết lại kèm trích dẫn. Lặp lại vài vòng.
//
//   START -> draft -> execute_tools -> revise --(> MAX_ITERATIONS)--> END
//                 ↑                          |
//                 |          (lặp lại)       +--(chưa đạt giới hạn)--+
//                 |                                                  ↓
//                 +--------------------------------------------------+
//
// - draft: viết bản nháp ~250 từ + tự phê bình + đề xuất 1-3 từ khoá search.
// - execute_tools: Dùng Tavily search các từ khóa -> trả về ToolMessage.
// - revise: Đọc lại phê bình + kết quả search để viết bản hoàn thiện + trích dẫn nguồn.
//
// Sơ đồ minh hoạ: ../images/reflexion-agent-graph.png
// Tên trong ảnh -> tên node trong code:
//   Responder -> draft, Execute Tools -> execute_tools, Revisor -> revise.
//
// "Reflexion" là tên của một kiến trúc và phương pháp nghiên cứu cụ thể (của Shinn et al.),
// được thiết kế để giúp các mô hình học hỏi thông qua phản hồi bằng văn bản và tự phản ánh
//
// So với Reflection Agent (./reflection-agent.js):
// - Reflection: Dùng LLM thứ 2 chấm bài dựa trên kiến thức tĩnh có sẵn.
//   -> Văn phong hay nhưng nếu sai kiến thức gốc thì vẫn sai.
// - Reflexion: LLM tự chấm bài + search web thực tế.
//   -> Nội dung chính xác cao, có nguồn kiểm chứng rõ ràng.
//
// Vì sao không cần đổi vai AI <-> Human như Reflection?
// - Model chỉ đóng một vai duy nhất (người viết), không phải đóng vai người chấm.
// - Tin nhắn cuối cùng model đọc là kết quả search + yêu cầu từ user,
//   không phải câu trả lời của chính nó -> tránh việc model tưởng đã hoàn thành.
//
// Mẹo cốt lõi: Bắt LLM "gọi tool" AnswerQuestion / ReviseAnswer.
// -> Đầu ra luôn ép theo đúng cấu trúc JSON schema { answer, reflection, search_queries }.
// -> Thực chất tool chỉ dùng mảng `search_queries` để gọi API search, phần còn lại giữ trong state.
//
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { awaitAllCallbacks } = require("@langchain/core/callbacks/promises");
const {
  AIMessage,
  HumanMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { TavilySearch } = require("@langchain/tavily");
const { z } = require("zod");

/**
 * Ngưỡng dừng vòng lặp "search -> viết lại".
 * Graph sẽ dừng khi số lần thực hiện search vượt quá con số này.
 * Ví dụ: MAX_ITERATIONS = 2 sẽ chạy 3 vòng search rồi dừng.
 */
const MAX_ITERATIONS = 2;

// Định nghĩa tên các node trong graph
const DRAFT = "draft";
const EXECUTE_TOOLS = "execute_tools";
const REVISE = "revise";

// ===== 1. SCHEMAS: ĐỊNH NGHĨA CẤU TRÚC ĐẦU RA CỦA LLM =====

/**
 * Cấu trúc tự phê bình: đánh giá điểm còn thiếu hoặc thừa trong câu trả lời.
 */
const Reflection = z.object({
  missing: z.string().describe("Critique of what is missing."),
  superfluous: z.string().describe("Critique of what is superfluous"),
});

/**
 * Cấu trúc đầu ra cho bước viết nháp (node draft).
 * - answer: Câu trả lời khoảng 250 từ.
 * - reflection: Đánh giá điểm thiếu/thừa của bản draft.
 * - search_queries: 1-3 từ khoá cho lần search Tavily tiếp theo, để bù chỗ thiếu mà reflection chỉ ra.
 */
const AnswerQuestion = z
  .object({
    answer: z.string().describe("~250 word detailed answer to the question."),
    reflection: Reflection.describe("Your reflection on the initial answer."),
    search_queries: z
      .array(z.string())
      .describe(
        "1-3 search queries for researching improvements to address the critique of your current answer.",
      ),
  })
  .describe("Answer the question.");

/**
 * Cấu trúc đầu ra cho bước viết lại (node revise).
 * Kế thừa từ AnswerQuestion, bổ sung trường references.
 *
 * - references: Danh sách link do LLM chọn lọc ở bước revise từ kết quả Tavily search trước đó.
 */
const ReviseAnswer = AnswerQuestion.extend({
  references: z
    .array(z.string())
    .describe("Citations motivating your updated answer."),
}).describe("Revise your original answer to your question.");

// ===== 2. LLM & PROMPT =====

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
});

/**
 * Prompt dùng chung cho cả 2 bước draft và revise.
 *
 * Prompt thật gửi cho LLM ở bước revise trông như sau:
 *   System: You are expert researcher...
 *   Human:  <câu hỏi gốc>                   ┐
 *   AI:     <bản nháp + phê bình + từ khoá> │ <- phần này do MessagesPlaceholder chèn vào
 *   Tool:   <kết quả search>                ┘
 *   Human:  Answer the user's question above using the required format.
 *
 * 1. Vì sao cần `MessagesPlaceholder("messages")`?
 *    -> Lịch sử chat mỗi vòng một dài thêm, không viết cứng vào prompt được.
 *    -> Placeholder là 1 ô trống, lúc chạy sẽ chèn cả mảng message vào đây.
 *    -> Thiếu nó, LLM không thấy câu hỏi, bản nháp cũ, kết quả search -> không thể viết lại.
 *
 * 2. Vì sao cần dòng "human" ở cuối?
 *    -> Nhắc việc: lịch sử dài, LLM dễ lạc đề. Câu chốt ở cuối kéo nó về đúng yêu cầu.
 *    -> Đúng lượt: message cuối của lịch sử là kết quả search (Tool), không phải user.
 *       Nhiều model (như Gemini) cần lượt cuối là của user, nếu không sẽ lỗi hoặc trả lời kém.
 *
 * `{time}` và `{first_instruction}` được điền sẵn trong `buildChains`.
 */
const actorPromptTemplate = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are expert researcher.
Current time: {time}

1. {first_instruction}
2. Reflect and critique your answer. Be severe to maximize improvement.
3. Recommend search queries to research information and improve your answer.`,
  ],
  new MessagesPlaceholder("messages"),
  ["human", "Answer the user's question above using the required format."],
]);

/** Hướng dẫn cho bước viết nháp (draft): trả lời chi tiết khoảng 250 từ. */
const firstInstructions = "Provide a detailed ~250 word answer.";

/**
 * Hướng dẫn cụ thể dành riêng cho bước viết lại (revise): dùng phê bình + dữ liệu mới,
 * thêm trích dẫn [1], [2]..., thêm mục References, tối đa 250 từ.
 */
const reviseInstructions = `Revise your previous answer using the new information.
    - You should use the previous critique to add important information to your answer.
        - You MUST include numerical citations in your revised answer to ensure it can be verified.
        - Add a "References" section to the bottom of your answer (which does not count towards the word limit). In form of:
            - [1] https://example.com
            - [2] https://example.com
    - You should use the previous critique to remove superfluous information from your answer and make SURE it is not more than 250 words.
`;

// ===== 3. TOOLS =====

/** Khởi tạo Tavily search, cấu hình tối đa 5 kết quả mỗi từ khóa. */
const tavilyTool = new TavilySearch({ maxResults: 5 });

/**
 * Hàm thực thi batch search từ khóa và gom kết quả thành chuỗi JSON.
 *
 * LLM gửi kèm cả `answer`, `reflection`... nhưng ở đây chỉ cần `search_queries`.
 * Từ khoá nào search lỗi -> kết quả có dạng `{ error: "..." }`, không làm dừng graph.
 */
async function runQueries({ search_queries }) {
  const results = await tavilyTool.batch(
    search_queries.map((query) => ({ query })),
  );
  return JSON.stringify(results);
}

// 2 tool cùng chạy runQueries, chỉ khác tên + schema.
// Tên phải trùng tên tool LLM gọi -> ToolNode mới tìm đúng tool để chạy.

/** Tool dùng cho bước draft: nhận schema AnswerQuestion và thực thi tìm kiếm. */
const answerQuestionTool = tool(runQueries, {
  name: "AnswerQuestion",
  description: "Answer the question.",
  schema: AnswerQuestion,
});

/** Tool dùng cho bước viết lại: nhận schema ReviseAnswer và thực thi tìm kiếm. */
const reviseAnswerTool = tool(runQueries, {
  name: "ReviseAnswer",
  description: "Revise your original answer to your question.",
  schema: ReviseAnswer,
});

// ===== 4. CHAINS =====

/**
 * Khởi tạo 2 chain: viết nháp (firstResponder) và viết lại (revisor).
 * - partial(): Điền các biến tĩnh như time và instruction.
 * - bindTools & tool_choice: Buộc LLM phải trả về đúng cấu trúc tool schema định sẵn.
 */
async function buildChains() {
  // Truyền hàm `() => new Date().toISOString()` thay vì giá trị
  // Mỗi lần chain invoke, hàm chạy lại để lấy giờ hiện tại.
  // Nếu truyền giá trị, giờ bị cố định.
  const timedPromptTemplate = await actorPromptTemplate.partial({
    time: () => new Date().toISOString(),
  });

  const firstResponderPrompt = await timedPromptTemplate.partial({
    first_instruction: firstInstructions,
  });
  const revisorPrompt = await timedPromptTemplate.partial({
    first_instruction: reviseInstructions,
  });

  return {
    firstResponder: firstResponderPrompt.pipe(
      llm.bindTools([answerQuestionTool], { tool_choice: "AnswerQuestion" }),
    ),
    revisor: revisorPrompt.pipe(
      llm.bindTools([reviseAnswerTool], { tool_choice: "ReviseAnswer" }),
    ),
  };
}

// ===== 5. GRAPH: NODES & ĐIỀU KIỆN DỪNG =====

/**
 * Xây dựng StateGraph cho mô hình Reflexion:
 * draft -> execute_tools -> revise -> điều kiện lặp/dừng.
 */
function buildGraph({ firstResponder, revisor }) {
  /**
   * Node draft: Tạo bản nháp đầu tiên kèm theo phản hồi và từ khóa tìm kiếm.
   *
   * Node draft và revise đều làm 2 việc:
   * 1. Gửi lịch sử vào prompt: `invoke({ messages: state.messages })`.
   *    -> Key `messages` trùng tên `MessagesPlaceholder("messages")` -> lịch sử được chèn vào đó.
   * 2. Trả về message mới: `return { messages: [response] }`.
   *    -> LangGraph tự nối vào cuối lịch sử (xem MessagesAnnotation bên dưới).
   */
  async function draftNode(state) {
    const response = await firstResponder.invoke({ messages: state.messages });
    return { messages: [response] };
  }

  /** Node revise: Viết lại câu trả lời dựa trên lịch sử nháp, phê bình và kết quả search. */
  async function reviseNode(state) {
    const response = await revisor.invoke({ messages: state.messages });
    return { messages: [response] };
  }

  // Node thực thi tool: Lấy các tool_calls ở message cuối và gọi API Tavily.
  const executeTools = new ToolNode([answerQuestionTool, reviseAnswerTool]);

  /**
   * Sau bước revise: Kiểm tra số lần search đẻ quyết định kết thúc process hay tiếp tục.
   * Số lần search = Số tin nhắn loại ToolMessage trong lịch sử state.
   *
   * Trả về node tiếp theo:
   * - END: Nếu số lần search > MAX_ITERATIONS -> dừng graph.
   * - EXECUTE_TOOLS: Nếu chưa -> tiếp tục search từ khóa mới.
   */
  function eventLoop(state) {
    const numIterations = state.messages.filter((m) =>
      ToolMessage.isInstance(m),
    ).length;
    if (numIterations > MAX_ITERATIONS) {
      return END;
    }
    return EXECUTE_TOOLS;
  }

  /**
   * StateGraph sử dụng MessagesAnnotation:
   * - Quản lý duy nhất mảng `messages` làm trạng thái chung.
   * - Các node trả về message mới -> LangGraph tự nối vào cuối (không ghi đè).
   *
   * Minh hoạ mảng messages lớn dần qua từng bước với MAX_ITERATIONS = 2:
   *   bắt đầu      [Human]
   *   draft        [Human, AI]
   *   tools (1)    [Human, AI, Tool]
   *   revise       [Human, AI, Tool, AI] -> có 1 Tool, chưa > 2 -> search tiếp
   *   tools (2)    [Human, AI, Tool, AI, Tool]
   *   revise       [Human, AI, Tool, AI, Tool, AI] -> có 2 Tool, chưa > 2 -> search tiếp
   *   tools (3)    [Human, AI, Tool, AI, Tool, AI, Tool]
   *   revise       [Human, AI, Tool, AI, Tool, AI, Tool, AI] -> có 3 Tool > 2 -> END
   *
   * Lưu ý: Node revise gửi toàn bộ lịch sử (kể cả kết quả search cũ) cho LLM,
   * nên lượng token tiêu thụ sẽ tăng dần qua mỗi vòng lặp.
   */
  return (
    new StateGraph(MessagesAnnotation)
      .addNode(DRAFT, draftNode)
      .addNode(EXECUTE_TOOLS, executeTools)
      .addNode(REVISE, reviseNode)
      .addEdge(START, DRAFT)
      .addEdge(DRAFT, EXECUTE_TOOLS)
      .addEdge(EXECUTE_TOOLS, REVISE)
      // [EXECUTE_TOOLS, END]: các đích eventLoop có thể trả về.
      .addConditionalEdges(REVISE, eventLoop, [EXECUTE_TOOLS, END])
      .compile()
  );
}

// ===== 6. THỰC THI =====

/**
 * Hàm chính thực thi luồng demo:
 * 1. Khởi tạo chain và biên dịch graph.
 * 2. Xuất sơ đồ luồng trực quan ra file ảnh Mermaid (.png).
 * 3. Gửi câu hỏi test về chủ đề AI-Powered SOC và in kết quả cuối cùng.
 */
async function main() {
  const graph = buildGraph(await buildChains());

  // Lưu sơ đồ graph dưới dạng file ảnh PNG vào thư mục images/
  const graphView = await graph.getGraphAsync();
  const image = await graphView.drawMermaidPng();
  const imagePath = path.join(
    __dirname,
    "../images",
    `${path.basename(__filename, ".js")}-flow.png`,
  );
  fs.writeFileSync(imagePath, Buffer.from(await image.arrayBuffer()));

  // Chạy graph với câu hỏi mẫu.
  // Tham số thứ 2 (config) chỉ để dễ tìm trace trên LangSmith:
  // - runName: tên dòng trace gốc (mặc định là "LangGraph", khó phân biệt).
  // - tags / metadata: dùng để lọc trace trên giao diện LangSmith.
  const res = await graph.invoke(
    {
      messages: [
        new HumanMessage(
          "Write about AI-Powered SOC / autonomous soc problem domain, list startups that do that and raised capital.",
        ),
      ],
    },
    {
      runName: "reflexion-agent",
      tags: ["reflexion", "udemy-course"],
      metadata: { model: "gemini-3.5-flash", maxIterations: MAX_ITERATIONS },
    },
  );

  // Message cuối luôn là AIMessage của lần revise cuối
  // (graph chỉ dừng ngay sau node revise).
  const lastMessage = res.messages.at(-1);

  // Câu trả lời KHÔNG nằm trong `content` như chat thường:
  // LLM bị ép gọi tool ReviseAnswer -> kết quả nằm trong args của tool_call:
  // tool_calls: [{
  //   name: "ReviseAnswer",
  //   args: { answer, reflection, search_queries, references }
  // }]
  // Còn content của AIMessage là bản thô dạng functionCall của Gemini, không dùng để in.
  if (AIMessage.isInstance(lastMessage) && lastMessage.tool_calls?.length) {
    console.log(lastMessage.tool_calls[0].args.answer);
  }

  console.dir(res, { depth: null, maxStringLength: null });
}

// Trace được gửi lên LangSmith ở chế độ chạy nền.
// Chờ gửi xong rồi mới thoát, để không bị mất trace của mấy bước cuối.
main().finally(awaitAllCallbacks);
