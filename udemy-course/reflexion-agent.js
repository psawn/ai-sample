// =======================================================================
// DEMO: REFLEXION AGENT BẰNG LANGGRAPH
//
// Ý tưởng: LLM trả lời -> tự chỉ ra chỗ thiếu -> tự đề xuất từ khoá
// -> search web lấy dữ liệu thật -> viết lại có trích dẫn. Lặp vài vòng.
//
//   START -> draft -> execute_tools -> revise --(> MAX_ITERATIONS)--> END
//                          ↑             |
//                          |             +--(còn lại)--+
//                          +---------------------------+
//
// - draft: viết bản nháp ~250 từ + tự phê bình + đề xuất 1-3 từ khoá search.
// - execute_tools: search các từ khoá bằng Tavily -> trả về ToolMessage.
// - revise: đọc phê bình + kết quả search -> viết lại, thêm nguồn.
//
// "Reflexion" là tên của một kiến trúc và phương pháp nghiên cứu cụ thể (của Shinn et al.), 
// được thiết kế để giúp các mô hình học hỏi thông qua phản hồi bằng văn bản và tự phản ánh
//
// So với Reflection Agent (./reflection-agent.js):
// - Reflection: LLM thứ 2 chấm bài, chỉ dựa vào kiến thức có sẵn
//   -> văn hay hơn, nhưng sai thì vẫn sai.
// - Reflexion: LLM tự chấm + search web
//   -> nội dung đúng hơn, có nguồn kiểm chứng.
//
// Vì sao không cần đổi vai AI <-> Human như Reflection?
// - Model chỉ đóng 1 vai (người viết), không phải vào vai người chấm.
// - Tin cuối model đọc luôn là kết quả search + yêu cầu của user,
//   không phải câu trả lời của chính nó -> không bị "tưởng đã trả lời xong".
//
// Mẹo chính: bắt LLM "gọi tool" AnswerQuestion / ReviseAnswer.
// -> Đầu ra luôn đúng khuôn { answer, reflection, search_queries }.
// -> Tool thật ra chỉ dùng search_queries để search, phần còn lại bỏ qua.
//
// Yêu cầu: GEMINI_API_KEY và TAVILY_API_KEY trong file .env
// Chạy từ thư mục gốc: node udemy-course/reflexion-agent.js
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { z } = require("zod");
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
const { TavilySearch } = require("@langchain/tavily");
const {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");

/**
 * Ngưỡng dừng vòng lặp "search -> viết lại".
 *
 * Graph dừng khi số lần search > con số này (lớn hơn, không phải bằng).
 * Với 2: chạy 3 vòng "search -> viết lại" rồi dừng.
 */
const MAX_ITERATIONS = 2;

// Tên node, dùng lại khi dựng graph.
const DRAFT = "draft";
const EXECUTE_TOOLS = "execute_tools";
const REVISE = "revise";

// ===== 1. SCHEMAS: KHUÔN ĐẦU RA CỦA LLM =====
// Phần .describe() viết tiếng Anh vì LLM đọc nó để biết cần điền gì.

/**
 * Phần tự phê bình: câu trả lời còn thiếu gì, thừa gì.
 */
const Reflection = z.object({
  missing: z.string().describe("Critique of what is missing."),
  superfluous: z.string().describe("Critique of what is superfluous"),
});

/**
 * Khuôn đầu ra của bước nháp (node draft).
 *
 * - `answer`: câu trả lời ~250 từ.
 * - `reflection`: tự phê bình (thiếu gì, thừa gì).
 * - `search_queries`: 1-3 từ khoá cần search để bù chỗ thiếu.
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
 * Khuôn đầu ra của bước viết lại (node revise).
 *
 * Giống `AnswerQuestion`, thêm `references`: danh sách link nguồn đã dùng.
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
 * Prompt dùng chung cho draft và revise.
 *
 * 2 biến cần điền trước khi dùng (xem `buildChains`):
 * - `{time}`: giờ hiện tại -> LLM biết "bây giờ" là khi nào.
 * - `{first_instruction}`: việc chính của bước này (viết nháp / viết lại).
 *
 * Câu nhắc cuối để vai "human", không để "system":
 * Gemini báo lỗi nếu system message không nằm đầu danh sách.
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

/**
 * Yêu cầu cho bước viết lại: dùng phê bình + dữ liệu mới,
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

/** Tool search web, mỗi từ khoá lấy tối đa 5 kết quả. */
const tavilyTool = new TavilySearch({ maxResults: 5 });

/**
 * Search tất cả từ khoá cùng lúc, gộp kết quả thành 1 chuỗi JSON.
 *
 * LLM gửi kèm cả `answer`, `reflection`... nhưng ở đây chỉ cần `search_queries`.
 * Từ khoá nào search lỗi -> kết quả có dạng `{ error: "..." }`, không làm dừng graph.
 *
 * @param {{ search_queries: string[] }} args - Args LLM gửi khi gọi tool.
 * @returns {Promise<string>} Kết quả search, dạng chuỗi JSON (mảng, mỗi từ khoá 1 phần tử).
 */
async function runQueries({ search_queries }) {
  const results = await tavilyTool.batch(
    search_queries.map((query) => ({ query })),
  );
  return JSON.stringify(results);
}

// 2 tool cùng chạy runQueries, chỉ khác tên + schema.
// Tên phải trùng tên tool LLM gọi -> ToolNode mới tìm đúng tool để chạy.

/** Tool cho bước nháp: nhận args theo `AnswerQuestion`, chạy search. */
const answerQuestionTool = tool(runQueries, {
  name: "AnswerQuestion",
  description: "Answer the question.",
  schema: AnswerQuestion,
});

/** Tool cho bước viết lại: nhận args theo `ReviseAnswer`, chạy search. */
const reviseAnswerTool = tool(runQueries, {
  name: "ReviseAnswer",
  description: "Revise your original answer to your question.",
  schema: ReviseAnswer,
});

// ===== 4. CHAINS =====

/**
 * Tạo 2 chain: viết nháp (`firstResponder`) và viết lại (`revisor`).
 *
 * Cách làm:
 * 1. `partial()` điền sẵn `time` + `first_instruction` vào prompt
 *    -> lúc gọi chỉ cần truyền `messages`.
 * 2. `bindTools` + `tool_choice` bắt LLM phải gọi đúng tool
 *    -> đầu ra luôn đúng khuôn schema.
 *
 * Là hàm async vì `partial()` trả về Promise,
 * mà file CommonJS không dùng được `await` ngoài hàm.
 *
 * @returns {Promise<{ firstResponder: import("@langchain/core/runnables").Runnable, revisor: import("@langchain/core/runnables").Runnable }>}
 */
async function buildChains() {
  // Truyền hàm thay vì giá trị -> mỗi lần gọi lấy giờ mới nhất.
  const timedPromptTemplate = await actorPromptTemplate.partial({
    time: () => new Date().toISOString(),
  });

  const firstResponderPrompt = await timedPromptTemplate.partial({
    first_instruction: "Provide a detailed ~250 word answer.",
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

// ===== 5. GRAPH: NODES + ĐIỀU KIỆN DỪNG =====

/**
 * Dựng graph Reflexion: draft -> execute_tools -> revise -> (lặp / dừng).
 *
 * @param {{ firstResponder: import("@langchain/core/runnables").Runnable, revisor: import("@langchain/core/runnables").Runnable }} chains - Lấy từ `buildChains()`.
 * @returns Graph đã compile, gọi `.invoke({ messages })` để chạy.
 */
function buildGraph({ firstResponder, revisor }) {
  /**
   * Node draft: viết bản nháp đầu tiên.
   *
   * @param {{ messages: import("@langchain/core/messages").BaseMessage[] }} state
   * @returns 1 AIMessage chứa tool_call `AnswerQuestion` (nháp + phê bình + từ khoá).
   *          LangGraph tự nối vào cuối `state.messages`.
   */
  async function draftNode(state) {
    const response = await firstResponder.invoke({ messages: state.messages });
    return { messages: [response] };
  }

  /**
   * Node revise: viết lại câu trả lời.
   *
   * Đọc toàn bộ lịch sử: nháp + phê bình + kết quả search.
   *
   * @param {{ messages: import("@langchain/core/messages").BaseMessage[] }} state
   * @returns 1 AIMessage chứa tool_call `ReviseAnswer` (bản mới + nguồn + từ khoá mới).
   */
  async function reviseNode(state) {
    const response = await revisor.invoke({ messages: state.messages });
    return { messages: [response] };
  }

  // Node execute_tools: lấy tool_calls ở message cuối -> chạy tool -> ToolMessage.
  const executeTools = new ToolNode([answerQuestionTool, reviseAnswerTool]);

  /**
   * Quyết định sau mỗi lần revise: search tiếp hay dừng.
   *
   * Mỗi lần search sinh đúng 1 ToolMessage -> đếm ToolMessage = số lần đã search.
   *
   * @param {{ messages: import("@langchain/core/messages").BaseMessage[] }} state
   * @returns {string} `END` nếu đã search quá `MAX_ITERATIONS` lần, ngược lại `EXECUTE_TOOLS`.
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

  // MessagesAnnotation: state chỉ có `messages`, message mới tự nối vào cuối.
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
 * Chạy demo từ đầu đến cuối:
 * 1. Dựng chain + graph.
 * 2. Lưu sơ đồ graph ra images/reflexion-agent-flow.png.
 * 3. Hỏi về AI-Powered SOC, in câu trả lời cuối + toàn bộ lịch sử.
 */
async function main() {
  const graph = buildGraph(await buildChains());

  // Lưu sơ đồ graph ra images/<tên file>-flow.png
  // drawMermaidPng gọi dịch vụ online (mermaid.ink) -> cần mạng.
  const graphView = await graph.getGraphAsync();
  const image = await graphView.drawMermaidPng();
  const imagePath = path.join(
    __dirname,
    "../images",
    `${path.basename(__filename, ".js")}-flow.png`,
  );
  fs.writeFileSync(imagePath, Buffer.from(await image.arrayBuffer()));

  const res = await graph.invoke({
    messages: [
      new HumanMessage(
        "Write about AI-Powered SOC / autonomous soc problem domain, list startups that do that and raised capital.",
      ),
    ],
  });

  // Câu trả lời cuối nằm trong args của tool_call ở message cuối,
  // không nằm trong content như chat thường.
  const lastMessage = res.messages.at(-1);
  if (AIMessage.isInstance(lastMessage) && lastMessage.tool_calls?.length) {
    console.log(lastMessage.tool_calls[0].args.answer);
  }

  console.dir(res, { depth: null });
}

main();
