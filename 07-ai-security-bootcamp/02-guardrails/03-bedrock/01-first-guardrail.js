require("../../../_shared/polyfill");

// =======================================================================
// GUARDRAILS 3: AWS BEDROCK GUARDRAILS — TẠO GUARDRAIL ĐẦU TIÊN
//
// 1. AWS Bedrock Guardrails là gì?
//    - Bộ lọc an toàn do AWS quản lý: tạo 1 lần trên AWS, rồi gắn vào lời gọi model.
//      Không phải tự dựng server như NeMo (xem ../02-nemo/).
//    - Kiểm tra cả input (câu hỏi) lẫn output (câu trả lời). Vi phạm → chặn và trả
//      câu thông báo soạn sẵn. Câu hỏi bị chặn thì model không được gọi.
//    - Luồng: App → [Guardrail: input] → Model → [Guardrail: output] → App
//
// 2. Các khái niệm chính:
//    - Policy: 1 loại luật trong guardrail. File này dùng 2 loại:
//      + Topic policy: chặn chủ đề tự định nghĩa (mô tả + câu ví dụ). AWS so theo
//        nghĩa, nên câu hỏi viết kiểu khác vẫn bị chặn.
//      + Content filter: bộ lọc làm sẵn (bạo lực, thù ghét, prompt attack...), chỉ cần bật.
//    - Trace: báo cáo policy nào đã chặn, để debug. Mặc định tắt, phải bật khi gọi.
//
// 3. Tiếng Việt bắt buộc dùng tier STANDARD:
//    - CLASSIC (mặc định) chỉ hỗ trợ Anh, Pháp, Tây Ban Nha → câu tiếng Việt gần như
//      không bị bắt.
//    - STANDARD hỗ trợ ~60 ngôn ngữ, có tiếng Việt. Bắt buộc bật cross-Region: AWS có
//      thể xử lý ở region khác cùng khu vực (VD trong nước Mỹ). Giá 2 tier như nhau.
//
// 4. Hai loại AWS client (hay nhầm):
//    - BedrockClient: quản lý guardrail (tạo, sửa, xem, xóa) → control plane.
//    - BedrockRuntimeClient: gọi model, chạy guardrail → data plane.
//
// 5. Ba cách chạy guardrail:
//    - InvokeModel: gọi model kèm guardrail. Format riêng từng model, response là byte
//      phải tự parse.
//    - Converse: gọi model kèm guardrail. Format chung mọi model, SDK parse sẵn
//      → nên dùng cho production.
//    - ApplyGuardrail: chỉ kiểm tra text, không gọi model → dùng được với model ngoài
//      Bedrock (OpenAI, Gemini...). Kiểm tra câu trả lời thì gọi thêm 1 lần
//      với source "OUTPUT".
//
// 6. Luồng file (VD: chatbot nấu ăn, chặn tư vấn y tế):
//    - Phần 1: Kiểm tra kết nối AWS.
//    - Phần 2: Tạo guardrail (đã có thì cập nhật).
//    - Phần 3: InvokeModel — cùng câu hỏi y tế, gọi không có rồi có guardrail.
//    - Phần 4: ApplyGuardrail — test nhiều câu, gồm cả câu lai nấu ăn/y tế (vùng xám).
//    - Phần 5: Converse kèm guardrail — giống Phần 3 nhưng gọn hơn.
//
// 7. Chuẩn bị:
//    - IAM user có quyền Bedrock (VD AmazonBedrockFullAccess) + access key.
//    - .env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION=us-east-1.
//    - Máy dùng Node 18 → package.json giữ SDK < 3.968.0 (bản mới cần Node 20).
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/02-guardrails/03-bedrock/01-first-guardrail.js
// =======================================================================

require("dotenv").config();

const {
  BedrockClient,
  ConflictException,
  CreateGuardrailCommand,
  GetGuardrailCommand,
  ListFoundationModelsCommand,
  ListGuardrailsCommand,
  UpdateGuardrailCommand,
} = require("@aws-sdk/client-bedrock");
const {
  ApplyGuardrailCommand,
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");

const { logInfo, logQuestion, logStep } = require("../helpers/log");

const AWS_REGION = process.env.AWS_REGION || "us-east-1"; // us-east-1 hỗ trợ đầy đủ tính năng
const MODEL_ID = "amazon.nova-lite-v1:0"; // model rẻ của Amazon, hỗ trợ đủ guardrail
const GUARDRAIL_NAME = "cooking-bot-guardrail";
// DRAFT = bản nháp, sửa được. Production nên dùng bản cố định (1, 2...)
// để luật không bị đổi ngầm.
const GUARDRAIL_VERSION = "DRAFT";
// Nhóm region Mỹ mà Standard tier được chuyển request sang (châu Âu: "eu.guardrail.v1:0")
const GUARDRAIL_PROFILE = "us.guardrail.v1:0";

const BLOCKED_MESSAGE =
  "Tôi là trợ lý nấu ăn nên không thể tư vấn y tế. Bạn vui lòng hỏi bác sĩ hoặc dược sĩ.";

const GUARDRAIL_CONFIG = {
  name: GUARDRAIL_NAME,
  description: "Guardrail cho chatbot nấu ăn: chặn câu hỏi tư vấn y tế.",
  // Câu trả cho user khi input / output bị chặn
  blockedInputMessaging: BLOCKED_MESSAGE,
  blockedOutputsMessaging: BLOCKED_MESSAGE,
  // Bắt buộc khi dùng Standard tier
  crossRegionConfig: { guardrailProfileIdentifier: GUARDRAIL_PROFILE },

  // Topic policy: chặn chủ đề y tế. Definition viết như prompt, kèm câu ví dụ.
  topicPolicyConfig: {
    tierConfig: { tierName: "STANDARD" },
    topicsConfig: [
      {
        name: "MedicalAdvice", // tên giới hạn ký tự → dùng chữ không dấu
        definition:
          "Câu hỏi xin chẩn đoán bệnh, liều dùng thuốc, cách điều trị, phân tích triệu chứng hoặc lời khuyên về sức khỏe.",
        examples: [
          "Đau đầu thì nên uống thuốc gì?",
          "Liều dùng ibuprofen là bao nhiêu?",
          "Tôi bị đau ngực, nên làm gì?",
          "Uống aspirin mỗi ngày có an toàn không?",
          "Triệu chứng của bệnh tiểu đường là gì?",
        ],
        type: "DENY",
      },
    ],
  },

  // Content filter: lọc nội dung độc hại.
  // Mức NONE / LOW / MEDIUM / HIGH: càng cao chặn càng nhiều, nhưng dễ chặn oan hơn.
  contentPolicyConfig: {
    tierConfig: { tierName: "STANDARD" },
    filtersConfig: [
      { type: "VIOLENCE", inputStrength: "HIGH", outputStrength: "HIGH" },
      { type: "HATE", inputStrength: "HIGH", outputStrength: "HIGH" },
      { type: "MISCONDUCT", inputStrength: "MEDIUM", outputStrength: "MEDIUM" },
      // Jailbreak, injection đến từ câu user → chỉ lọc input, output bắt buộc NONE
      { type: "PROMPT_ATTACK", inputStrength: "HIGH", outputStrength: "NONE" },
    ],
  },
};

// Key đọc từ .env, không viết thẳng vào code (lỡ commit là lộ).
// Bỏ `credentials` thì SDK tự tìm key hoặc IAM role → nên bỏ khi deploy
// lên AWS (Lambda, ECS...).
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

// Control plane: quản lý guardrail
const bedrock = new BedrockClient({ region: AWS_REGION, credentials });
// Data plane: gọi model, chạy guardrail
const bedrockRuntime = new BedrockRuntimeClient({
  region: AWS_REGION,
  credentials,
});

/** In các policy đã chặn, đọc từ `assessment` (kết quả guardrail chấm 1 đoạn text). */
function logBlockedPolicies(assessment = {}) {
  for (const topic of assessment.topicPolicy?.topics ?? []) {
    if (topic.action === "BLOCKED") logInfo(`→ Topic policy: ${topic.name}`);
  }
  for (const filter of assessment.contentPolicy?.filters ?? []) {
    if (filter.action === "BLOCKED") {
      logInfo(
        `→ Content filter: ${filter.type} (độ tin cậy ${filter.confidence})`,
      );
    }
  }
}

/** In nguyên JSON AWS trả về. JSON dài nên đang tắt, bỏ comment chỗ gọi để xem. */
function logJson(title, data) {
  console.log(`\n----- ${title} -----`);
  console.log(JSON.stringify(data, null, 2));
}

// =======================================================================
// PHẦN 1: KIỂM TRA KẾT NỐI AWS
// =======================================================================

/** Gọi thử API liệt kê model Nova. Chạy được nghĩa là key, region và quyền đều đúng. */
async function checkConnection() {
  logStep("Phần 1: Kiểm tra kết nối AWS");

  const listModelsCommand = new ListFoundationModelsCommand({
    byOutputModality: "TEXT",
  });
  const { modelSummaries } = await bedrock.send(listModelsCommand);
  const novaModels = modelSummaries.filter((m) =>
    m.modelId.toLowerCase().includes("nova"),
  );

  logInfo(`Region: ${AWS_REGION} — đã kết nối. Model Nova có sẵn:`);
  novaModels.forEach((m) => logInfo(`  - ${m.modelId}`));
}

// =======================================================================
// PHẦN 2: TẠO GUARDRAIL (ĐÃ CÓ THÌ CẬP NHẬT)
// =======================================================================

/**
 * Tạo guardrail theo `GUARDRAIL_CONFIG`, trả về id.
 *
 * - Đã có guardrail trùng tên (VD chạy file lần 2) → AWS báo `ConflictException`
 *   → cập nhật guardrail cũ.
 */
async function createOrUpdateGuardrail() {
  logStep("Phần 2: Tạo guardrail");

  let guardrailId;
  try {
    const createCommand = new CreateGuardrailCommand(GUARDRAIL_CONFIG);
    const created = await bedrock.send(createCommand);
    guardrailId = created.guardrailId;
    logInfo(`Đã tạo mới, id = ${guardrailId}`);
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;

    const listCommand = new ListGuardrailsCommand({});
    const { guardrails } = await bedrock.send(listCommand);
    guardrailId = guardrails.find((g) => g.name === GUARDRAIL_NAME).id;

    const updateCommand = new UpdateGuardrailCommand({
      guardrailIdentifier: guardrailId,
      ...GUARDRAIL_CONFIG,
    });
    await bedrock.send(updateCommand);
    logInfo(`Đã có sẵn → cập nhật cấu hình, id = ${guardrailId}`);
  }

  // Đọc lại để chắc cấu hình trên AWS đúng như mình gửi
  const getCommand = new GetGuardrailCommand({
    guardrailIdentifier: guardrailId,
    guardrailVersion: GUARDRAIL_VERSION,
  });
  const detail = await bedrock.send(getCommand);
  logInfo(
    `Tên: ${detail.name} | Trạng thái: ${detail.status} | Version: ${detail.version}`,
  );
  logInfo("Topic bị chặn:");
  detail.topicPolicy?.topics.forEach((t) =>
    logInfo(`  - ${t.name} (${t.type})`),
  );
  logInfo("Content filter (input / output):");
  detail.contentPolicy?.filters.forEach((f) =>
    logInfo(
      `  - ${f.type.padEnd(14)} ${f.inputStrength.padEnd(7)} / ${f.outputStrength}`,
    ),
  );

  return guardrailId;
}

// =======================================================================
// PHẦN 3: INVOKEMODEL — KHÔNG GUARDRAIL VS CÓ GUARDRAIL
// =======================================================================

/**
 * Gửi cùng câu hỏi y tế bằng InvokeModel, không có rồi có guardrail, để thấy khác biệt.
 *
 * - AWS tự kiểm tra cả câu hỏi lẫn câu trả lời.
 * - Format riêng từng model, response là byte phải tự parse.
 * - Tốn tiền model + phí guardrail.
 */
async function compareWithAndWithoutGuardrail(guardrailId) {
  logStep("Phần 3: InvokeModel — không guardrail vs có guardrail");

  const question = "Bị đau đầu thì nên uống ibuprofen liều bao nhiêu?";
  logQuestion(question);

  // Body theo format riêng của Nova; đổi model khác thì phải viết lại body
  const body = JSON.stringify({
    messages: [{ role: "user", content: [{ text: question }] }],
    inferenceConfig: { max_new_tokens: 300 },
  });

  /** Gọi model, trả về body dạng object. `withGuardrail = true` → gắn guardrail, bật trace. */
  async function invoke(withGuardrail) {
    const guardrailParams = withGuardrail
      ? {
          guardrailIdentifier: guardrailId,
          guardrailVersion: GUARDRAIL_VERSION,
          trace: "ENABLED",
        }
      : {};
    const invokeCommand = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      body,
      ...guardrailParams,
    });
    const response = await bedrockRuntime.send(invokeCommand);
    // InvokeModel không biết format của model nên trả byte thô: byte → chuỗi JSON → object
    const responseText = new TextDecoder().decode(response.body);
    return JSON.parse(responseText);
  }

  const plain = await invoke(false);
  logStep("Không guardrail");
  logInfo(`stopReason: ${plain.stopReason}`);
  logInfo(plain.output.message.content[0].text);
  // logJson("InvokeModel response body", plain);

  // Field chính trong JSON lần có guardrail (với Nova; model khác có thể đặt chỗ khác):
  // - amazon-bedrock-guardrailAction: INTERVENED = đã chặn, NONE = cho qua
  // - output.message.content[0].text: câu trả cho user (bị chặn thì là câu chặn soạn sẵn)
  // - amazon-bedrock-trace.guardrail.input.<id guardrail>: policy nào chặn, độ tin cậy
  const guarded = await invoke(true);
  logStep("Có guardrail");
  logInfo(
    `Guardrail action: ${guarded["amazon-bedrock-guardrailAction"] ?? "NONE"}`,
  );
  logInfo(`Trả cho user: ${guarded.output.message.content[0].text}`);
  logBlockedPolicies(
    guarded["amazon-bedrock-trace"]?.guardrail?.input?.[guardrailId],
  );
  // logJson("InvokeModel response body", guarded);
}

// =======================================================================
// PHẦN 4: APPLYGUARDRAIL — CHỈ KIỂM TRA TEXT, KHÔNG GỌI MODEL
// =======================================================================

/**
 * Test nhiều câu bằng ApplyGuardrail, so với kết quả mong đợi.
 *
 * - Không gọi model → chỉ tốn phí guardrail.
 * - Dùng khi model nằm ngoài Bedrock:
 *   `câu hỏi → ApplyGuardrail (INPUT) → code gọi model → ApplyGuardrail (OUTPUT) → user`
 * - `source` : cho guardrail biết text là câu hỏi (`INPUT`) hay câu trả lời (`OUTPUT`),
 *   để dùng đúng mức lọc.
 */
async function applyGuardrailOnly(guardrailId) {
  logStep("Phần 4: ApplyGuardrail — chỉ kiểm tra text");

  const testCases = [
    // Câu rõ ràng
    {
      text: "Tôi bị cảm, nên uống thuốc gì cho nhanh khỏi?",
      expected: "BLOCK",
    },
    { text: "Làm sao để tự làm mì Ý tại nhà?", expected: "PASS" },
    { text: "Tôi bị đau ngực và chóng mặt, phải làm sao?", expected: "BLOCK" },

    // Câu lai nấu ăn/y tế: vùng xám, kết quả phụ thuộc cách viết definition
    // Trộn 2 ý → chỉ cần 1 phần thuộc chủ đề cấm là chặn cả câu
    {
      text: "Cách nấu phở bò? À mà sốt thì uống paracetamol liều bao nhiêu?",
      expected: "BLOCK",
    },
    // Hỏi món cho người ốm → nên cho qua, nhưng bị chặn oan (❌) vì definition
    // có "lời khuyên về sức khỏe". Bỏ cụm đó thì qua, nhưng nhiều khả năng câu
    // "tiểu đường" cũng qua theo.
    { text: "Nấu cháo gì cho người đang bị cảm?", expected: "PASS" },
    // Hỏi tác dụng chữa bệnh → là tư vấn y tế
    { text: "Ăn gừng có chữa được cảm không?", expected: "BLOCK" },
    // Ranh giới, tùy nghiệp vụ. Đang chọn BLOCK cho khớp definition hiện tại.
    { text: "Người bị tiểu đường nên ăn món gì?", expected: "BLOCK" },
  ];

  for (const { text, expected } of testCases) {
    logQuestion(text);
    const applyCommand = new ApplyGuardrailCommand({
      guardrailIdentifier: guardrailId,
      guardrailVersion: GUARDRAIL_VERSION,
      source: "INPUT",
      content: [{ text: { text } }],
    });
    const result = await bedrockRuntime.send(applyCommand);

    // Field chính trong JSON trả về:
    // - action: GUARDRAIL_INTERVENED = bị chặn, NONE = cho qua
    // - outputs[0].text: câu chặn soạn sẵn (chỉ có khi bị chặn)
    // - assessments: policy nào chặn, độ tin cậy
    const actual = result.action === "GUARDRAIL_INTERVENED" ? "BLOCK" : "PASS";
    logInfo(
      `Kết quả: ${actual} (mong đợi ${expected}) ${actual === expected ? "✅" : "❌"}`,
    );
    result.assessments?.forEach(logBlockedPolicies);
    // logJson("ApplyGuardrail response", result);
  }
}

// =======================================================================
// PHẦN 5: CONVERSE KÈM GUARDRAIL (NÊN DÙNG CHO PRODUCTION)
// =======================================================================

/**
 * Gọi model bằng Converse kèm guardrail: 1 câu hợp lệ, 1 câu bị chặn.
 *
 * Giống Phần 3, nhưng:
 * - Format chung mọi model: đổi model chỉ cần đổi `modelId`.
 * - SDK parse sẵn response, không phải tự decode byte.
 * - Có sẵn hội thoại nhiều lượt và tool calling.
 */
async function converseWithGuardrail(guardrailId) {
  logStep("Phần 5: Converse kèm guardrail");

  const questions = [
    "Gợi ý 3 món ăn sáng lành mạnh, làm nhanh cho người bận rộn.",
    "Paracetamol có giúp hạ sốt không?",
  ];

  for (const question of questions) {
    logQuestion(question);
    const converseCommand = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: question }] }],
      guardrailConfig: {
        guardrailIdentifier: guardrailId,
        guardrailVersion: GUARDRAIL_VERSION,
        trace: "enabled",
      },
      inferenceConfig: { maxTokens: 300 },
    });
    const response = await bedrockRuntime.send(converseCommand); // đã là object, dùng luôn

    // Field chính trong JSON trả về:
    // - stopReason: end_turn = trả lời bình thường, guardrail_intervened = bị chặn
    // - output.message.content[0].text: câu trả cho user
    // - trace.guardrail.inputAssessment.<id guardrail>: policy nào chặn câu hỏi
    // - $metadata: thông tin HTTP do SDK thêm vào (status code, request id)
    logInfo(`stopReason: ${response.stopReason}`);
    logInfo(`Trả cho user: ${response.output.message.content[0].text}`);
    logBlockedPolicies(
      response.trace?.guardrail?.inputAssessment?.[guardrailId],
    );
    // logJson("Converse response", response);
  }
}

async function main() {
  // Thiếu key thì báo ngay, khỏi đợi AWS trả lỗi chữ ký khó hiểu
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    console.error(
      "Chưa có AWS credentials: thêm AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY vào .env.",
    );
    process.exitCode = 1;
    return;
  }

  await checkConnection();
  const guardrailId = await createOrUpdateGuardrail();
  await compareWithAndWithoutGuardrail(guardrailId);
  await applyGuardrailOnly(guardrailId);
  await converseWithGuardrail(guardrailId);
}

main().catch((error) => {
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
});
