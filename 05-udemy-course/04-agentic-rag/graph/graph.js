// =======================================================================
// GRAPH: Định nghĩa luồng Agentic RAG.
//
// Luồng chính: retrieve -> grade_documents -> generate -> END
//
// 3 điểm rẽ nhánh quyết định:
// 1. routeQuestion (Bắt đầu):
//    - Có trong vectorstore -> retrieve
//    - Ngoài phạm vi -> websearch
// 2. decideToGenerate (Sau khi chấm tài liệu):
//    - Có tài liệu không liên quan -> websearch bổ sung
//    - Tài liệu đạt chuẩn -> generate
// 3. gradeGenerationGroundedInDocumentsAndQuestion (Sau khi sinh câu trả lời):
//    - Bịa đặt (không dựa trên tài liệu) -> sinh lại (GENERATE)
//    - Đúng tài liệu nhưng chưa trả đúng ý câu hỏi -> tìm thêm (WEBSEARCH)
//    - Đạt cả 2 yêu cầu -> kết thúc (END)
// =======================================================================

const { StateGraph, START, END } = require("@langchain/langgraph");

const { logStep, logDecision } = require("../flow-logger");

const { answerGrader } = require("./chains/answer-grader");
const { hallucinationGrader } = require("./chains/hallucination-grader");
const { questionRouter, DATASOURCE } = require("./chains/router");
const { GENERATE, GRADE_DOCUMENTS, RETRIEVE, WEBSEARCH } = require("./consts");
const { generate, gradeDocuments, retrieve, webSearch } = require("./nodes");
const { GraphState } = require("./state");

/**
 * Quyết định bước tiếp theo sau khi chấm tài liệu:
 * - Có chunk bị loại -> Chuyển sang websearch.
 * - Tài liệu đạt -> Chuyển sang generate.
 */
function decideToGenerate(state) {
  logStep(
    "edge",
    "ASSESS GRADED DOCUMENTS",
    `Còn ${state.documents.length} chunk sau khi lọc, webSearch = ${state.webSearch}`,
  );

  if (state.webSearch) {
    logDecision("NOT ALL DOCUMENTS ARE RELEVANT, INCLUDE WEB SEARCH -> websearch");
    return WEBSEARCH;
  }
  logDecision("GENERATE -> generate");
  return GENERATE;
}

/**
 * Kiểm tra chất lượng câu trả lời qua 2 tiêu chí:
 * 1. Tính trung thực: Dựa hoàn hảo vào tài liệu (không bịa)?
 * 2. Tính hữu ích: Trả lời đúng trọng tâm câu hỏi không?
 *
 * Note: Dùng conditional edge thay vì node riêng vì kết quả chấm
 * chỉ dùng để điều hướng luồng đi tiếp, không cần lưu vào state.
 */
async function gradeGenerationGroundedInDocumentsAndQuestion(state) {
  logStep(
    "edge",
    "GRADE GENERATION",
    "Chấm câu trả lời: (1) có bịa không, (2) có đúng ý câu hỏi không",
  );
  const { question, documents, generation } = state;

  const hallucinationScore = await hallucinationGrader.invoke({
    // Chỉ lấy nội dung chữ, lược bỏ metadata để prompt gọn hơn
    documents: documents.map((doc) => doc.pageContent).join("\n\n"),
    generation,
  });

  if (hallucinationScore.binaryScore === false) {
    logDecision("GENERATION IS NOT GROUNDED IN DOCUMENTS, RE-TRY -> generate");
    return "not supported";
  }
  logDecision("GENERATION IS GROUNDED IN DOCUMENTS -> chấm tiếp đúng ý");

  const answerScore = await answerGrader.invoke({ question, generation });

  if (answerScore.binaryScore === true) {
    logDecision("GENERATION ADDRESSES QUESTION -> END");
    return "useful";
  }

  logDecision("GENERATION DOES NOT ADDRESS QUESTION -> websearch");
  return "not useful";
}

/**
 * Định tuyến câu hỏi ban đầu:
 * - Thuộc vectorstore -> retrieve từ Chroma.
 * - Chủ đề khác -> tìm kiếm web.
 *
 * So sánh với DATASOURCE (giá trị LLM trả về), không so với tên node,
 * và báo lỗi nếu gặp giá trị lạ thay vì âm thầm đi sai nhánh.
 */
async function routeQuestion(state) {
  logStep("edge", "ROUTE QUESTION", "Chọn nguồn dữ liệu: vectorstore hay websearch");
  const source = await questionRouter.invoke({ question: state.question });

  if (source.datasource === DATASOURCE.WEBSEARCH) {
    logDecision("ROUTE QUESTION TO WEB SEARCH -> websearch");
    return WEBSEARCH;
  }
  if (source.datasource === DATASOURCE.VECTORSTORE) {
    logDecision("ROUTE QUESTION TO RAG -> retrieve");
    return RETRIEVE;
  }
  throw new Error(`Datasource không hợp lệ: ${source.datasource}`);
}

const workflow = new StateGraph(GraphState)
  .addNode(RETRIEVE, retrieve)
  .addNode(GRADE_DOCUMENTS, gradeDocuments)
  .addNode(GENERATE, generate)
  .addNode(WEBSEARCH, webSearch)
  // Dùng routeQuestion làm điểm xuất phát động (thay vì addEdge cố định từ START)
  .addConditionalEdges(START, routeQuestion, {
    [WEBSEARCH]: WEBSEARCH,
    [RETRIEVE]: RETRIEVE,
  })
  .addEdge(RETRIEVE, GRADE_DOCUMENTS)
  .addConditionalEdges(GRADE_DOCUMENTS, decideToGenerate, {
    [WEBSEARCH]: WEBSEARCH,
    [GENERATE]: GENERATE,
  })
  .addConditionalEdges(
    GENERATE,
    gradeGenerationGroundedInDocumentsAndQuestion,
    {
      "not supported": GENERATE, // Bịa đặt -> Viết lại câu trả lời
      useful: END, // Chính xác & đúng ý -> Kết thúc
      "not useful": WEBSEARCH, // Không bịa nhưng chưa đủ ý -> Tìm thêm trên web
    },
  )
  .addEdge(WEBSEARCH, GENERATE);

const app = workflow.compile();

module.exports = { app };
