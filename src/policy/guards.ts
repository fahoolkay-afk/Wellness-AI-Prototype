// Two checks on every outgoing patient message.
//
// 1. Wording check: titles and claims the clinic may not use. Defaults match the owner's EHRM rule
//    (no "Dr.", "osteopath(s)", "diagnosis/diagnose", "AI", "cure", "treat"). Ontario's RHPA protects the
//    "doctor" title and makes communicating a diagnosis a controlled act; the rest is clinic policy.
//    A clinic whose professionals may lawfully use a term (e.g. chiropractors and "Dr.") can switch
//    that one rule off in Settings.
//
// 2. Privacy check (PHIPA s.30, minimum necessary): messages the clinic starts on SMS, WhatsApp, Messenger
//    or Instagram may contain first name, clinic name, date, time and a practitioner's first name, never
//    the reason for the visit, the service type, a body part or a condition. Lock screens and shared
//    phones show these messages.
//
// Text is normalised first (look-alike letters, hidden characters, spaced-out letters) so the checks
// can't be dodged, mirroring the EHRM's wording guard.

import type { Channel, Clinic } from "../types.ts";

export const WORDING_RULES = {
  dr_title: { label: '"Dr." as a title', re: /\bd\s*\.?\s*r\b\.?(?=\s*[a-z])/ },
  osteopath: { label: '"osteopath(s)"', re: /\bosteopaths?\b/, squashed: /osteopath(?!ic)/ },
  diagnosis: { label: '"diagnosis" / "diagnose"', re: /\bdiagnos\w*/, squashed: /diagnos/ },
  ai: { label: '"AI" / "artificial intelligence"', re: /\bA\s?\.?\s?I\b\.?|\b[Aa]rtificial\s+[Ii]ntelligence\b/, caseSensitive: true },
  cure: { label: '"cure"', re: /\bcur(?:e|es|ed|ing)\b/ },
  treat: { label: '"treat" / "treatment"', re: /\btreat(?:s|ed|ing|ment|ments)?\b/ },
} as const;
export type WordingRule = keyof typeof WORDING_RULES;
export const DEFAULT_WORDING_RULES = Object.keys(WORDING_RULES) as WordingRule[];

// Cyrillic and Greek letters that look like Latin ones.
const LOOKALIKES: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", г: "r", т: "t", к: "k", м: "m", н: "h", в: "b",
  α: "a", ε: "e", ο: "o", ρ: "p", τ: "t", υ: "u", ν: "v", ι: "i", κ: "k", μ: "m", η: "n",
  А: "A", Е: "E", О: "O", Р: "P", С: "C", І: "I", Т: "T", К: "K", М: "M", Н: "H", В: "B", Α: "A", Ε: "E", Ο: "O", Ρ: "P", Τ: "T", Ι: "I",
};

function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining marks
    .replace(/[​-‏‪-‮⁠-⁤﻿­]/g, "") // zero-width, bidi, soft hyphen
    .replace(/./g, (ch) => LOOKALIKES[ch] ?? ch)
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ") // links can't trip the guard
    .replace(/\s+/g, " ");
}

export function wordingProblems(text: string, enabled: readonly WordingRule[] = DEFAULT_WORDING_RULES): string[] {
  // "t r e a t" or "t.r.e.a.t" -> "treat": single letters split by spaces or dots are joined back up.
  const norm = normalise(text).replace(/\b(?:[A-Za-z][ .\-_*]){2,}[A-Za-z]\b/g, (m) => m.replace(/[ .\-_*]/g, ""));
  const lower = norm.toLowerCase();
  const squashed = lower.replace(/[^a-z]/g, "");
  const hits: string[] = [];
  for (const key of enabled) {
    const rule = WORDING_RULES[key] as { label: string; re: RegExp; squashed?: RegExp; caseSensitive?: boolean };
    const hay = rule.caseSensitive ? norm : lower;
    if (rule.re.test(hay) || (rule.squashed && rule.squashed.test(squashed))) hits.push(rule.label);
  }
  return hits;
}

// Clinical words (same list as the EHRM's clinical guard) plus body areas and conditions.
const CLINICAL = [
  "pain", "painful", "injury", "injuries", "injured", "disc", "disk", "tear", "tears", "torn", "sprain", "strain", "fracture",
  "surgery", "surgical", "mri", "x-ray", "xray", "symptom", "symptoms", "symptomatic", "condition", "conditions", "medication",
  "medications", "concussion", "sciatica", "arthritis", "tendonitis", "tendinitis", "whiplash", "migraine", "headaches", "pregnancy",
  "pregnant", "postpartum", "pelvic", "rehab", "rehabilitation", "physio", "physiotherapy", "chiropractic", "chiropractor",
  "massage", "osteopathic", "acupuncture", "therapy", "therapist", "mva", "accident", "wsib", "claim",
];
const BODY = [
  "neck", "shoulder", "shoulders", "knee", "knees", "hip", "hips", "ankle", "ankles", "wrist", "wrists", "elbow", "elbows", "spine",
  "spinal", "jaw", "tmj", "lower back", "upper back", "back pain", "foot", "feet", "hamstring", "rotator cuff", "achilles",
];

const SENSITIVE_CHANNELS: Channel[] = ["sms", "whatsapp", "messenger", "instagram"];

export function privacyProblems(text: string, channel: Channel, clinic: Clinic): string[] {
  if (!SENSITIVE_CHANNELS.includes(channel)) return [];
  // The clinic's own name (e.g. "Harbourfront Physio & Wellness") is not a disclosure about the patient.
  const lower = normalise(text).toLowerCase().split(clinic.profile.name.toLowerCase()).join(" ");
  const hits = new Set<string>();
  for (const w of [...CLINICAL, ...BODY]) {
    if (new RegExp(`\\b${w.replace(/[-]/g, "[- ]?")}\\b`).test(lower)) hits.add(w);
  }
  for (const s of clinic.profile.services) {
    if (lower.includes(s.name.toLowerCase())) hits.add(`service "${s.name}"`);
  }
  for (const p of clinic.profile.practitioners) {
    if (p.title && lower.includes(p.title.toLowerCase())) hits.add(`title "${p.title}"`);
  }
  return [...hits];
}

export function enabledWordingRules(clinic: Clinic): WordingRule[] {
  const configured = clinic.profile.wordingRules;
  return Array.isArray(configured) ? configured.filter((r): r is WordingRule => r in WORDING_RULES) : DEFAULT_WORDING_RULES;
}
