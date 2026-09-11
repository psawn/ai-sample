// Các Tool cho phép LLM THỰC HIỆN hành động thay vì chỉ trả lời bằng văn bản.
// LLM sẽ tự quyết định gọi tool nào, với tham số gì, dựa vào mô tả (description) và
// schema bên dưới - mô tả càng rõ thì LLM chọn/điền tham số càng đúng.
// Ở đây chỉ trả về chuỗi giả lập (chưa gửi mail/xếp lịch thật).

require("../_polyfill");

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

const writeEmail = tool(
  ({ to, subject, content }) => {
    return `Email sent to ${to} with subject '${subject}'`;
  },
  {
    name: "write_email",
    description: "Write and send an email.",
    schema: z.object({
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      content: z.string().describe("Email body content"),
    }),
  },
);

const scheduleMeeting = tool(
  ({ attendees, subject, durationMinutes, preferredDay }) => {
    return `Meeting '${subject}' scheduled for ${preferredDay} with ${attendees.length} attendees`;
  },
  {
    name: "schedule_meeting",
    description: "Schedule a calendar meeting.",
    schema: z.object({
      attendees: z.array(z.string()).describe("List of attendee email addresses"),
      subject: z.string().describe("Meeting subject"),
      durationMinutes: z.number().describe("Meeting duration in minutes"),
      preferredDay: z.string().describe("Preferred day for the meeting"),
    }),
  },
);

const checkCalendarAvailability = tool(
  ({ day }) => {
    return `Available times on ${day}: 9:00 AM, 2:00 PM, 4:00 PM`;
  },
  {
    name: "check_calendar_availability",
    description: "Check calendar availability for a given day.",
    schema: z.object({
      day: z.string().describe("Day to check availability for"),
    }),
  },
);

module.exports = { writeEmail, scheduleMeeting, checkCalendarAvailability };
