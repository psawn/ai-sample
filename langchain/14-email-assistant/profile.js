// =======================================================================
// EMAIL ASSISTANT - DỮ LIỆU DÙNG CHUNG CHO CÁC BƯỚC DEMO
//
// Gồm:
// - profile          : hồ sơ người dùng, cho LLM biết đang hỗ trợ ai.
// - triageRules      : quy tắc phân loại email thành ignore / notify / respond.
// - agentInstructions: chỉ dẫn làm việc cho response agent.
// - 2 email mẫu để chạy thử.
// =======================================================================

const profile = {
  name: "John",
  fullName: "John Doe",
  userProfileBackground:
    "Senior software engineer leading a team of 5 developers",
};

// Quy tắc phân loại, chèn vào system prompt của bước triage.
// LLM đọc mô tả này để xếp email vào nhóm.
const triageRules = {
  ignore: "Marketing newsletters, spam emails, mass company announcements",
  notify:
    "Team member out sick, build system notifications, project status updates",
  respond:
    "Direct questions from team members, meeting requests, critical bug reports",
};

// Chỉ dẫn cho response agent. Cố ý viết mơ hồ để thấy agent lạm dụng tool.
// Ví dụ: với questionEmail, agent có thể gọi schedule_meeting dù trả lời
// bằng email là đủ. Đây là hạn chế của prompt, không phải lỗi code.
//
// Muốn agent ưu tiên trả lời bằng email thì thêm rule rõ ràng, ví dụ:
// "Prefer answering directly via write_email; only use schedule_meeting when the
// sender explicitly asks for a meeting or the issue cannot be resolved by email alone."
const agentInstructions =
  "Use these tools when appropriate to help manage John's tasks efficiently.";

// Email cần trả lời: câu hỏi trực tiếp từ đồng nghiệp.
const questionEmail = {
  author: "Alice Smith <alice.smith@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Quick question about API documentation",
  emailThread: `Hi John,

I was reviewing the API documentation for the new authentication service and noticed a few endpoints seem to be missing from the specs. Could you help clarify if this was intentional or if we should update the docs?

Specifically, I'm looking at:
- /auth/refresh
- /auth/validate

Thanks!
Alice`,
};

// Email nên bỏ qua: spam quảng cáo.
const spamEmail = {
  author: "Marketing Team <marketing@amazingdeals.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "🔥 EXCLUSIVE OFFER: Limited Time Discount on Developer Tools! 🔥",
  emailThread: `Dear Valued Developer,

Don't miss out on this INCREDIBLE opportunity!

For a LIMITED TIME ONLY, get 80% OFF on our Premium Developer Suite!

Regular Price: $999/month
YOUR SPECIAL PRICE: Just $199/month!

Click here to claim your discount: https://amazingdeals.com/special-offer

Best regards,
Marketing Team
---
To unsubscribe, click here`,
};

module.exports = {
  profile,
  triageRules,
  agentInstructions,
  questionEmail,
  spamEmail,
};
