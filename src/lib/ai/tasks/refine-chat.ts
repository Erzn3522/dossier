import { z } from "zod";

import { DocumentKind, Tone } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, type Extracted, type Unit, type UnitEdit } from "@/lib/application-data";
import { emailParts } from "@/lib/application-email";
import { isFrameUnit } from "@/lib/letter-frame";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";

import { guardSources, unverifiedFacts } from "../fact-guard";

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

export const REFINE_CHAT_VERSION = "refine-chat@5";

const answerSchema = z.object({
  reply: z.string(),
  edits: z.array(z.object({ document: z.enum(DocumentKind), unitId: z.string(), text: z.string() })),
  /** A different cover letter tone, only when asked for one. */
  tone: z.enum(Tone).nullable(),
  declined: z.boolean(),
});

const INSTRUCTIONS = `You help a candidate with their application for one job: you refine their tailored resume, cover letter and application email, and you answer their questions about the application. Answer as JSON.

First decide what the message is:
- A CHANGE request ("make it shorter", "mention ROS", "sound more confident"): edit the documents, as below.
- A QUESTION to answer: an application or screening question (from the posting, or one they paste from the company's application form, e.g. "Why do you want to work at Trackman?", "Describe a project you're proud of", "What is your notice period?"), a request to answer the posting's questions, or a question about the job or the posting. Answer it in reply and make NO edits: a question never changes a document, whichever document is on screen.

For a QUESTION:
- An application question is answered as the candidate, in the first person ("I"), ready to paste into the form: specific, using their real experience from the profile and what the posting says about the job. Keep each answer to what the form needs, usually 60–200 words.
- "Answer the posting's questions" (or similar): find every question or task the posting asks applicants to answer in their application (screening questions, "tell us in your application…", "please include…"). Answer each one, writing the question on its own line, then the answer below it, with a blank line between them. Rhetorical questions in the job advert ("Are you looking for a new challenge?") aren't application questions. If the posting has none, say so in one sentence and offer to answer any the form asks.
- Never invent facts. When an answer needs something the profile doesn't say (notice period, salary expectation, visa status, start date), write a bracketed placeholder such as [your notice period] and say in one closing sentence what to fill in.
- declined stays false and tone stays null for a question.

For a CHANGE:
- Change only what the request asks for. Each edit replaces one unit's whole text: give its document (RESUME, COVER_LETTER or EMAIL), its unitId and the new text. For a role, write bullets one per line without bullet characters.
- The email goes out with the resume and cover letter attached. Its "to" unit is the recipient ("Name <address>"), "subject" its subject line and "body" the whole message, from the greeting to the sign-off and the candidate's name. It is written by the candidate to the company.
- tone: set it (WARM, DIRECT or FORMAL) only when the request asks for a different tone for the letter; otherwise null. When you change the tone, rewrite the letter's paragraphs to match. A different tone for the email is an edit to the email, not a new tone.
- If the request needs facts the profile doesn't have (a skill, employer, number, credential…), don't make them up: set declined to true, make no edits, and say in reply what the candidate could add to their profile first.
- reply: one or two friendly sentences saying what you changed, or why you didn't.`;

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type RefineInput = {
  request: string;
  /** Earlier messages, oldest first. */
  history: ChatTurn[];
  /** The unit the request is about, if the user picked one ("About: Summary"). */
  target: string | null;
  /** The document on screen, which a request without a target is most likely about. */
  viewing?: DocumentKind | null;
  resume: Unit[];
  letter: Unit[];
  /** The application's email, when it has one. */
  email?: Unit[];
  profile: ProfileData;
  extracted: Extracted;
  tone: Tone;
  note: string;
  /** The posting as pasted, for the fact guard. */
  posting: string;
};

export type Refinement = { reply: string; edits: UnitEdit[]; tone: Tone | null; declined: boolean };

/** How the request says which document is on screen. */
const LOOKING_AT: Record<DocumentKind, string> = {
  [DocumentKind.RESUME]: "the resume",
  [DocumentKind.COVER_LETTER]: "the cover letter",
  [DocumentKind.EMAIL]: "the email",
};

/** Only the last messages go along; older ones rarely matter and cost context. */
const HISTORY = 10;

/** APP-7, APP-9: a reply plus unit edits (with what they replace, for Undo), or a decline with guidance. */
export const refineChat: Task<RefineInput, Refinement> = async (provider, input, options) => {
  const { request, history, target, viewing, resume, letter, email = [], profile, extracted, tone, note, posting } = input;
  const looking = viewing ? LOOKING_AT[viewing] : null;
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, `Current letter tone: ${TONES[tone].label}.`, truthfulness(options.strict), CREATIVITY[options.creativity], languageRule(options.language), UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, null)}`,
          posting.trim() && `The posting, for its questions and details:\n${postingForPrompt(posting)}`,
          `The resume's units:\n${JSON.stringify(resume, null, 2)}`,
          `The cover letter's units:\n${JSON.stringify(letter, null, 2)}`,
          email.length > 0 && `The email's units:\n${JSON.stringify(email, null, 2)}`,
          note.trim() && `The candidate added earlier: ${note.trim()}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      { role: "assistant", content: "Understood. What would you like to change, or what should I answer?" },
      ...history.slice(-HISTORY).map((turn) => ({ role: turn.role, content: turn.text })),
      { role: "user", content: target ? `About ${target}: ${request}` : looking ? `(I'm looking at ${looking}.) ${request}` : request },
    ],
    schema: answerSchema,
    schemaName: "refinement",
    creativity: options.creativity,
    signal: options.signal,
  });

  const newTone = answer.tone && answer.tone !== tone ? answer.tone : null;
  // The email's recipient counts too: its greeting names them, from the posting or typed in by the user.
  const sources = options.strict ? guardSources(profile, extracted, [posting, emailParts(email).to].join("\n")) : null;
  const documents = { [DocumentKind.RESUME]: resume, [DocumentKind.COVER_LETTER]: letter, [DocumentKind.EMAIL]: email };
  // Only units that exist, each once; the text they replace is kept for Undo (APP-8).
  const edits = new Map<string, UnitEdit>();
  if (!answer.declined) {
    for (const edit of answer.edits) {
      const unit = documents[edit.document].find((entry) => entry.id === edit.unitId);
      const text = edit.text.trim();
      if (unit && text && text !== unit.text) {
        // E6-6: in strict mode, note what the profile and posting don't back.
        const checked = edit.document === DocumentKind.EMAIL ? unit.id !== "to" : unit.id !== SIGN_OFF_UNIT && !isFrameUnit(unit.id);
        const unverified = sources && checked ? unverifiedFacts(text, sources) : [];
        edits.set(`${edit.document} ${unit.id}`, {
          document: edit.document,
          unitId: unit.id,
          text,
          previousText: unit.text,
          ...(unverified.length > 0 ? { unverified } : {}),
          ...(unit.unverified?.length ? { previousUnverified: unit.unverified } : {}),
        });
      }
    }
    // A new tone brings its own sign-off in English letters (APP-10).
    const signOff = letter.find((unit) => unit.id === SIGN_OFF_UNIT);
    const english = /^english$/i.test(options.language ?? extracted.language ?? "English");
    if (newTone && signOff && english) {
      edits.set(`${DocumentKind.COVER_LETTER} ${SIGN_OFF_UNIT}`, {
        document: DocumentKind.COVER_LETTER,
        unitId: SIGN_OFF_UNIT,
        text: TONES[newTone].signOff,
        previousText: signOff.text,
      });
    }
  }
  return {
    data: { reply: answer.reply.trim(), edits: [...edits.values()], tone: answer.declined ? null : newTone, declined: answer.declined },
    promptVersion: REFINE_CHAT_VERSION,
  };
};
