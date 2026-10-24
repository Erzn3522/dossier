import { z } from "zod";

import type { Tone } from "@/generated/prisma/enums";
import type { Extracted, Match, Unit } from "@/lib/application-data";
import { emailUnits, isEmailAddress } from "@/lib/application-email";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";

import { guardSources, guardUnits } from "../fact-guard";

import {
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  postingForPrompt,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";
import { withoutFrame } from "./write-cover-letter";

export const WRITE_EMAIL_VERSION = "write-email@3";

const answerSchema = z.object({
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  subject: z.string(),
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  signOff: z.string(),
});

const INSTRUCTIONS = `You write the email a candidate sends their job application with, as JSON. The resume and the cover letter are attached to it, so the email doesn't repeat them: it's a short, friendly note that gets them opened.

Who writes to whom: the CANDIDATE is the sender and writes in the first person ("I", "my"). The COMPANY's hiring team is the reader ("you", "your team"). Never write from the company's side: no "we are interested in you", "your experience fits our team" or "we would like to talk to you". Never greet or address the candidate; their name appears only after the sign-off. For example: "Dear Trackman team, I'm applying for the Computer Vision Engineer role. At my last job I cut robot camera calibration from 90 to 15 minutes, which is the kind of work your launch monitors depend on. My resume and cover letter are attached, and I'd be glad to talk."

- contactName and contactEmail: the person and the email address the posting says to send applications to, exactly as the posting writes them. Use null for anything the posting doesn't give; never guess an address.
- subject: a clear subject line with the role and the candidate's name, e.g. "Application: Senior Product Designer, Jane Doe". If the posting asks for a reference number or a particular subject line, use that.
- greeting: the salutation to the company, usual for an email in its language, with its punctuation: the contact person by name when the posting names one, else the company's hiring team, e.g. "Dear Ledgerly team,". Never the candidate's name.
- paragraphs: two or three short paragraphs in the candidate's voice, about 80–150 words together: the role I am applying for, the one or two things that make me a strong fit for it (not a summary of the resume or the letter), that my resume and cover letter are attached, and that I'd be glad to talk. No greeting, sign-off or name in them: those are separate.
- signOff: the closing line before the name, matching the tone, with its punctuation (e.g. "Warm regards,").
- The candidate's name is added after the sign-off; don't write it.`;

export type EmailInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  tone: Tone;
  note: string;
  /** The posting as pasted: where to send the application, and for the fact guard. */
  posting: string;
  /** The cover letter's paragraphs, so the email doesn't repeat them. */
  letter: string[];
};

/**
 * The application's email (its Email tab): the recipient the posting names,
 * a subject and the message, as the units "to", "subject" and "body". The
 * message ends with the sign-off and the candidate's name. An address the
 * posting doesn't contain is never used, so the recipient may be empty.
 */
export const writeEmail: Task<EmailInput, Unit[]> = async (provider, { profile, extracted, match, tone, note, posting, letter }, options) => {
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      `Tone: ${TONES[tone].label}. ${TONES[tone].description}`,
      truthfulness(options.strict),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, match)}`,
          letter.length > 0 && `The cover letter it goes with:\n${letter.join("\n\n")}`,
          note.trim() && `The candidate adds: ${note.trim()}`,
          `The posting, for who to send it to and how:\n${postingForPrompt(posting)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "application_email",
    creativity: options.creativity,
    signal: options.signal,
  });

  // English emails get the tone's own sign-off, as letters do; other languages keep the model's.
  const language = options.language ?? extracted.language ?? "English";
  const signOff = /^english$/i.test(language) || !answer.signOff.trim() ? TONES[tone].signOff : answer.signOff.trim();
  const greeting = companyGreeting(answer.greeting, profile.basics.name, extracted.contactName ?? answer.contactName, extracted.company);
  const paragraphs = withoutFrame(answer.paragraphs.map((text) => ({ text })), signOff)
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean)
    // A greeting repeated as the first paragraph, or one to the candidate.
    .filter((paragraph) => !isGreetingLine(paragraph, [answer.greeting, greeting], profile.basics.name));
  const body = [greeting, ...paragraphs, [signOff, profile.basics.name.trim()].filter(Boolean).join("\n")]
    .filter(Boolean)
    .join("\n\n");

  const [to, ...written] = emailUnits({
    to: recipient(extracted.contactName ?? answer.contactName, extracted.contactEmail ?? answer.contactEmail, posting),
    subject: oneLine(answer.subject),
    body,
  });
  return {
    // The recipient comes from the posting; the subject and message are checked like the letter's paragraphs.
    data: [to, ...(options.strict ? guardUnits(written, guardSources(profile, extracted, posting)) : written)],
    promptVersion: WRITE_EMAIL_VERSION,
  };
};

/**
 * "John Doe <john@example.com>", or just the address. Empty unless the
 * posting has the address, so a guessed one is never used.
 */
export function recipient(name: string | null, address: string | null, posting: string): string {
  const email = address?.trim().replace(/^mailto:/i, "") ?? "";
  if (!isEmailAddress(email) || !posting.toLowerCase().includes(email.toLowerCase())) return "";
  const who = oneLine(name ?? "").replace(/[<>"]/g, "");
  return who && who.toLowerCase() !== email.toLowerCase() ? `${who} <${email}>` : email;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const words = (text: string) => text.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];

/** Whether `greeting` names the candidate, which only an email written from the company's side does. */
function addressesCandidate(greeting: string, candidate: string): boolean {
  const names = new Set(words(candidate).filter((word) => word.length > 1));
  return words(greeting).some((word) => names.has(word));
}

/**
 * The model's greeting, unless it greets the candidate (small models write
 * from the company's side): then one to the posting's contact or the
 * company's hiring team.
 */
export function companyGreeting(greeting: string, candidate: string, contactName: string | null, company: string | null): string {
  const written = greeting.trim();
  if (written && !addressesCandidate(written, candidate)) return written;
  if (contactName?.trim() && !addressesCandidate(contactName, candidate)) return `Dear ${contactName.trim()},`;
  return company?.trim() ? `Dear ${company.trim()} team,` : "Dear hiring team,";
}

/** A short line that is a greeting: the same as one given, or one naming the candidate. */
function isGreetingLine(paragraph: string, greetings: string[], candidate: string): boolean {
  if (paragraph.length > 60 || /[.!?]\s*\S/.test(paragraph)) return false;
  const key = words(paragraph).join(" ");
  return greetings.some((greeting) => words(greeting).join(" ") === key) || addressesCandidate(paragraph, candidate);
}
