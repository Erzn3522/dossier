import { describe, expect, it } from "vitest";

import { buildMime } from "./client";

describe("Gmail MIME message", () => {
  it("contains the reviewed fields and both PDF attachments", async () => {
    const raw = await buildMime({
      from: "me@example.com",
      to: ["jobs@example.com"],
      subject: "Application: Designer",
      body: "Please find my application attached.",
      attachments: [
        { filename: "Resume.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" },
        { filename: "Cover letter.pdf", content: new Uint8Array([4, 5, 6]), contentType: "application/pdf" },
      ],
    });
    const message = Buffer.from(raw, "base64url").toString("utf8");
    expect(message).toContain("To: jobs@example.com");
    expect(message).toContain("Subject: Application: Designer");
    expect(message).toContain("Please find my application attached.");
    expect(message).toContain("filename=Resume.pdf");
    expect(message).toContain('filename="Cover letter.pdf"');
    expect(message.match(/Content-Type: application\/pdf/g)).toHaveLength(2);
  });
});
