import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";

// --- Global Types ---
declare global {
  interface Window {
    pdfjsLib: any;
    mammoth: any;
  }
}

// --- Constants ---
const APP_VERSION = 'V2025.12';

// --- Data Structures ---
type QuestionType = 'single' | 'multiple';

// 1. Types for Syllabus Management
interface SyllabusTopic {
  id: string;
  title: string;
  topics?: SyllabusTopic[];
}

interface SyllabusBook {
  id: string;
  title: string;
  topics: SyllabusTopic[];
}

interface SyllabusPreset {
  id: string;
  name: string;
  books: SyllabusBook[];
}

type QuizOption = { id: string; text: string };

type QuizQuestion = {
  id: string;
  type: QuestionType; // Derived or explicitly set
  stem: string; // The question text
  options: QuizOption[];
  answerIds: string[]; // Correct option IDs
  
  // --- Structured Explanation Fields ---
  analysis?: string; // Fallback
  coreConcept?: string; 
  optionAnalyses?: Record<string, string>; 
  extendedCases?: string[]; 

  sourceDocument?: string; 
  
  // --- Auto-tagging Fields ---
  bookTitle?: string;
  chapterTitle?: string;
  assignedBookId?: string;
  assignedTopicId?: string;

  // Legacy field support for older saved data if any
  question?: string; 
  correctOptions?: string[];
};

type QuestionMeta = {
  id: string | number;
  tags?: string[];
  // 2. Meta Fields for Manual Classification
  assignedBookId?: string;
  assignedTopicId?: string;
};

type QuizBank = {
  id: string;
  title: string;
  createdAt: string;
  sourceFiles: string[];
  questionCount: number;
  questions: QuizQuestion[];
};

type FavoriteItem = {
  id: string;
  question: QuizQuestion;
  fromBankId?: string;
  fromBankTitle?: string;
  addedAt: string;
};

type MistakeItem = {
  id: string; 
  question: QuizQuestion;
  fromBankId?: string;
  fromBankTitle?: string;
  userAnswer?: string[];
  addedAt: string;
};

type TrashItem = MistakeItem & {
  removedAt: string;
};

type TagPreset = {
  id: string;
  name: string;
};

type ApiConfigHistoryItem = {
  id: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  customPath?: string;
  apiKey?: string;
  createdAt: string;
};

// --- New Progress Persistence Types ---
type StoredQuizAnswer = {
  answerIds: string[]; // Changed from 'selected' to match new structure, but keeping compatibility logic might be needed
  selected?: string[]; // Legacy
  isCorrect: boolean;
};

type StoredQuizProgress = {
  questionIds: string[];
  currentIndex: number;
  answers: Record<string, StoredQuizAnswer>;
  answeredCount: number; // Added for stats
  correctCount: number;  // Added for stats
  updatedAt: number;
};

type StoredQuizProgressMap = {
  [sessionKey: string]: StoredQuizProgress;
};

type GenerationStage = 'idle' | 'parsing' | 'callingModel' | 'postProcessing';
type Theme = 'light' | 'dark';
type GenerationSpeedMode = 'quality' | 'fast';
type HistoryViewMode = 'byBank' | 'byBook' | 'byTag';
type MistakeViewMode = 'mistakes' | 'trash';

// --- API Config Types ---
type ApiProtocol = 'openai-compatible' | 'gemini-native';

interface ApiConfig {
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  customPath?: string;
  preset?: string;
}

const QUIZ_HISTORY_KEY = 'quizHistory.v1';
const THEME_KEY = 'app_theme';
const APP_TITLE_KEY = 'quiz_app_title'; 
const API_CONFIG_KEY = 'apiConfig.v2';
const API_HISTORY_KEY = 'apiPresets.v1';
const BATCH_SIZE_KEY = 'quizBatchSize.v1';
const SPEED_MODE_KEY = 'generationSpeedMode.v1';
const FAVORITES_KEY = 'favoriteQuestions.v1';
const MISTAKE_KEY = 'mistakeBook.v1';
const MISTAKE_TRASH_KEY = 'mistakeTrash.v1';
const QUESTION_META_KEY = 'questionMeta.v1';
const TAG_PRESETS_KEY = 'tagPresets.v1';
const SYLLABUS_PRESETS_KEY = 'quiz_syllabus_presets_v1';
const QUIZ_PROGRESS_KEY = 'quiz_progress_v1';

// --- Constants & Config ---
const DEFAULT_TAG_PRESETS: TagPreset[] = [
  { id: 'easy-wrong', name: '易错' },
  { id: 'key-hard', name: '重难' },
  { id: 'sprint', name: '冲刺' },
  { id: 'non-heritage', name: '非遗案例' },
  { id: 'concept', name: '核心概念' }
];

interface PresetConfig {
  id: string;
  label: string;
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  customPath?: string;
}

const MODEL_PRESETS: PresetConfig[] = [
  { id: 'deepseek-v3', label: 'DeepSeek V3 (Chat)', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', customPath: '/v1/chat/completions' },
  { id: 'deepseek-r1', label: 'DeepSeek R1 (Reasoner)', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-reasoner', customPath: '/v1/chat/completions' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', customPath: '/v1/chat/completions' },
  { id: 'openai', label: 'OpenAI (GPT-4o)', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', customPath: '/v1/chat/completions' },
  { id: 'gemini-openai', label: 'Google Gemini (OpenAI 兼容)', protocol: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gpt-4.1-mini', customPath: '/v1/chat/completions' },
  { id: 'gemini-native', label: 'Google Gemini 原生 (推荐)', protocol: 'gemini-native', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash' },
];

const COLORS = {
  light: {
    primary: '#2563eb', // Blue 600
    primaryHover: '#1d4ed8', // Blue 700
    primaryLight: '#dbeafe', // Blue 100
    disabled: '#cbd5e1', // Slate 300
    success: '#16a34a', // Green 600
    successLight: '#dcfce7', // Green 100
    successBorder: '#16a34a', // Green 600
    successText: '#14532d', // Green 900
    error: '#dc2626', // Red 600
    errorBg: '#fee2e2', // Red 100
    errorBorder: '#b91c1c', // Red 700
    errorText: '#7f1d1d', // Red 900
    background: '#f8fafc',
    surface: '#ffffff',
    textMain: '#1e293b', // Slate 800
    textSub: '#475569', // Slate 600
    textSubLight: '#cbd5e1', // Slate 300
    border: '#e2e8f0', // Slate 200
    inputBg: '#ffffff',
  },
  dark: {
    primary: '#3b82f6', // Blue 500
    primaryHover: '#60a5fa', // Blue 400
    primaryLight: '#1e3a8a', // Blue 900
    disabled: '#475569', // Slate 600
    success: '#059669', // Green 600
    successLight: '#064e3b', // Green 900
    successBorder: '#059669', // Green 600
    successBg: '#374151', // Gray 700 - 更接近灰色背景，提高对比度
    successText: '#ffffff', // White - 提高对比度
    error: '#dc2626', // Red 600
    errorBg: '#7f1d1d', // Red 900
    errorBorder: '#dc2626', // Red 600
    errorText: '#fecaca', // Red 200
    background: '#0f172a', // Slate 900
    surface: '#1e293b', // Slate 800
    textMain: '#ffffff', // White - 提高对比度
    textSub: '#cbd5e1', // Slate 300 - 提高对比度
    textSubLight: '#94a3b8', // Slate 400 - 提高对比度
    border: '#334155', // Slate 700
    inputBg: '#0f172a', // Slate 900
  }
};

// --- Helper Functions ---
const indexToLetter = (index: number) => String.fromCharCode(65 + index);

// Shuffling removed to support deterministic progress/resume
const prepareOrderedQuestions = (questions: QuizQuestion[]): QuizQuestion[] => {
  return [...questions]; // Return copy, do not shuffle
};

const normalizeQuestionText = (text: string): string => {
  return (text || '').toLowerCase().replace(/\s+/g, '').replace(/[，。,\.、；;！!？?\-—_（）()【】\[\]"'“”‘’]/g, '');
};

// --- ROBUST JSON PARSING HELPERS ---

function stripCodeFences(raw: string): string {
  if (!raw) return '';
  // remove json ... fences
  const fence = raw.match(/(?:json)?\s*([\s\S]*?)/i);
  if (fence && fence[1]) {
      // If match is inside markdown code block ```json ... ```
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (match && match[1]) return match[1].trim();
  }
  // remove leading/trailing markdown text lines around a JSON block if code block regex failed
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  return trimmed;
}

function tryJsonParse<T = any>(s: string): T | null {
  try { return JSON.parse(s); } catch { return null; }
}

// Extract first JSON-like block: try direct parse → try to locate first {..} or [..] by bracket balance.
function extractFirstJsonBlock(raw: string): string | null {
  const s = stripCodeFences(raw);
  if (!s) return null;
  if (tryJsonParse(s)) return s;

  // Try to extract content from OpenAI / Gemini responses that wrap content in choices[0].message.content
  const asObj = tryJsonParse<any>(s);
  if (asObj && asObj.choices && asObj.choices[0]?.message?.content) {
    const inner = asObj.choices[0].message.content as string;
    const innerStripped = stripCodeFences(inner);
    if (tryJsonParse(innerStripped)) return innerStripped;
  }
  if (asObj && asObj.candidates && asObj.candidates[0]?.content?.parts?.[0]?.text) {
    const inner = asObj.candidates[0].content.parts[0].text as string;
    const innerStripped = stripCodeFences(inner);
    if (tryJsonParse(innerStripped)) return innerStripped;
  }

  // Fallback: scan for first balanced {...} or [...]
  const openers = ['{', '['];
  const closers = ['}', ']'];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const pairIdx = openers.indexOf(ch);
    if (pairIdx >= 0) {
      const open = openers[pairIdx];
      const close = closers[pairIdx];
      let depth = 0;
      for (let j = i; j < s.length; j++) {
        if (s[j] === open) depth++;
        else if (s[j] === close) depth--;
        if (depth === 0) {
          const candidate = s.slice(i, j + 1);
          if (tryJsonParse(candidate)) return candidate;
          break;
        }
      }
    }
  }
  return null;
}

function safeTrimCommas(jsonStr: string): string {
  // best-effort: remove trailing commas like ", }" or ", ]"
  return jsonStr.replace(/,\s*([}\]])/g, '$1');
}

function slugId(prefix: string, title: string, idx: number) {
  const base = (title || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/-+$/, '');
  return `${prefix}-${base || 'item'}-${idx}`;
}

// --- Normalize Classification JSON --- 
function normalizeClassificationJson(raw: string): { questionId: string; bookId: string; topicId: string | null }[] | null {
  try {
    const block = extractFirstJsonBlock(raw);
    if (!block) throw new Error('no json block');
    const rawObj = tryJsonParse<any>(block) ?? tryJsonParse<any>(safeTrimCommas(block));
    if (!rawObj) throw new Error('json parse failed');

    let mappings: any[] | null = null;
    if (Array.isArray(rawObj)) mappings = rawObj;
    else if (Array.isArray(rawObj.mappings)) mappings = rawObj.mappings;
    else if (Array.isArray(rawObj.data)) mappings = rawObj.data;
    else if (Array.isArray(rawObj.classifications)) mappings = rawObj.classifications;

    if (!mappings) throw new Error('no mappings array');

    const normalized: { questionId: string; bookId: string; topicId: string | null }[] = [];
    mappings.forEach((map: any) => {
      const questionId = String(map.questionId ?? map.id ?? '');
      if (!questionId) return;
      
      normalized.push({
        questionId,
        bookId: map.bookId ? String(map.bookId) : '',
        topicId: map.topicId ? String(map.topicId) : null
      });
    });

    return normalized;
  } catch (e) {
    console.error('Classification JSON parsing failed:', e);
    return null;
  }
}

// --- Normalize Quiz JSON ---
function normalizeQuizJson(raw: string): QuizQuestion[] | null {
  try {
    const block = extractFirstJsonBlock(raw);
    if (!block) throw new Error('no json block');
    const rawObj = tryJsonParse<any>(block) ?? tryJsonParse<any>(safeTrimCommas(block));
    if (!rawObj) throw new Error('json parse failed');

    let arr: any[] | null = null;
    if (Array.isArray(rawObj)) arr = rawObj;
    else if (Array.isArray(rawObj.questions)) arr = rawObj.questions;
    else if (Array.isArray(rawObj.data)) arr = rawObj.data;
    else if (rawObj.result && Array.isArray(rawObj.result.questions)) arr = rawObj.result.questions;
    else if (rawObj.mappings && Array.isArray(rawObj.mappings)) {
      // unrelated structure; not quiz
      arr = null;
    } else {
      // In case the object itself is a single question
      if (rawObj && (rawObj.stem || rawObj.question) && (rawObj.options || rawObj.choices)) arr = [rawObj];
    }
    if (!arr) throw new Error('no questions array');

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const toOptions = (options: any[]): QuizOption[] => {
      if (!Array.isArray(options)) return [];
      if (options.length && typeof options[0] === 'string') {
        return options.map((t, i) => ({ id: letters[i] ?? String(i + 1), text: String(t) }));
      }
      return options.map((opt: any, i: number) => {
        if (opt && typeof opt === 'object') {
          const id = String(opt.id ?? opt.label ?? letters[i] ?? String(i + 1));
          const text = String(opt.text ?? opt.value ?? opt.title ?? '');
          return { id, text };
        }
        return { id: letters[i] ?? String(i + 1), text: String(opt) };
      });
    };

    const normalizeAnswers = (q: any, normalizedOptions: QuizOption[]): string[] => {
      const ids = new Set<string>();
      const byIndex = (idx: number) => {
        const opt = normalizedOptions[idx];
        if (opt) ids.add(opt.id);
      };
      const byIdOrLabel = (x: any) => {
        if (x == null) return;
        const s = String(x).trim();
        const hit = normalizedOptions.find(o => o.id === s || o.id.toUpperCase() === s.toUpperCase());
        if (hit) ids.add(hit.id);
      };

      const a = q.answerIds ?? q.answers ?? q.answer ?? q.answerId ?? q.correctOption ?? q.correctOptions ?? q.correctIndex ?? q.correctIndices;
      if (Array.isArray(a)) {
        // Could be ["A","B"] or [0,2]
        for (const v of a) {
          if (typeof v === 'number') byIndex(v);
          else byIdOrLabel(v);
        }
      } else if (typeof a === 'string') {
        // Could be "AC" or "B"
        const str = a.trim();
        if (str.includes(',') || /\s/.test(str)) {
          str.split(/[, \t]+/).forEach(byIdOrLabel);
        } else {
          // treat as letters sequence if looks like "ABC"
          str.split('').forEach(byIdOrLabel);
        }
      } else if (typeof a === 'number') {
        byIndex(a);
      }

      // If still empty and there is legacy field 'answerIndex'
      if (ids.size === 0 && typeof q.answerIndex === 'number') byIndex(q.answerIndex);

      return Array.from(ids);
    };

    const out: QuizQuestion[] = [];
    arr.forEach((item: any, idx: number) => {
      if (!item) return;
      const stem = String(item.stem ?? item.question ?? item.title ?? '');
      const options = toOptions(item.options ?? item.choices ?? []);
      const answerIds = normalizeAnswers(item, options);
      if (!stem || options.length === 0) return;

      const id = String(item.id ?? item.qid ?? `q-${Date.now()}-${idx}`);
      
      const q: QuizQuestion = {
        id,
        type: answerIds.length > 1 ? 'multiple' : 'single',
        stem, // mapped from stem/question
        question: stem, // legacy compat
        options,
        answerIds,
        correctOptions: answerIds, // legacy compat
        
        analysis: item.analysis ?? item.explanation ?? item.解析 ?? undefined,
        coreConcept: item.coreConcept ?? undefined,
        optionAnalyses: item.optionAnalyses ?? undefined,
        extendedCases: Array.isArray(item.extendedCases) ? item.extendedCases : undefined,

        bookTitle: item.bookTitle ?? undefined,
        chapterTitle: item.chapterTitle ?? undefined,
        assignedBookId: item.assignedBookId ?? undefined,
        assignedTopicId: item.assignedTopicId ?? undefined,
        
        sourceDocument: item.sourceDocument
      };
      out.push(q);
    });

    if (!out.length) throw new Error('no valid questions after normalization');
    return out;
  } catch (e) {
    console.debug('normalizeQuizJson failed', e, raw);
    return null;
  }
}

// --- Normalize Syllabus JSON ---
function normalizeSyllabusJson(raw: string): SyllabusPreset | null {
  try {
    const block = extractFirstJsonBlock(raw);
    if (!block) throw new Error('no json block');
    const rawObj = tryJsonParse<any>(block) ?? tryJsonParse<any>(safeTrimCommas(block));
    if (!rawObj) throw new Error('json parse failed');

    let books: any[] | null = null;
    let name: string | undefined;

    if (Array.isArray(rawObj)) books = rawObj;
    else if (Array.isArray(rawObj.books)) { books = rawObj.books; name = rawObj.name ?? rawObj.title; }
    else if (rawObj.preset && Array.isArray(rawObj.preset.books)) { books = rawObj.preset.books; name = rawObj.preset.name ?? rawObj.name; }
    else if (Array.isArray(rawObj.data)) books = rawObj.data;

    if (!books) throw new Error('no books array');

    // Recursive function to process topics and their children
    const processTopics = (topicsRaw: any[], parentIndex: number): SyllabusTopic[] => {
      return topicsRaw.map((t: any, ti: number) => {
        // Handle both string array and object array cases
        if (typeof t === 'string') {
          // For string topics, use the exact string
          return {
            id: slugId('topic', t, ti),
            title: t.trim(),
            topics: undefined,
          };
        } else if (typeof t === 'object' && t !== null) {
          // For object topics, require title or name
          const topicTitle = t.title ?? t.name;
          if (!topicTitle) {
            throw new Error(`Topic at index ${ti} is missing title/name`);
          }
          
          // Process subtopics if they exist
          let subTopics: SyllabusTopic[] = [];
          if (Array.isArray(t.topics)) {
            subTopics = processTopics(t.topics, ti);
          } else if (Array.isArray(t.subtopics)) {
            subTopics = processTopics(t.subtopics, ti);
          } else if (Array.isArray(t.children)) {
            subTopics = processTopics(t.children, ti);
          }
          
          return {
            id: String(t.id ?? slugId('topic', topicTitle, ti)),
            title: String(topicTitle).trim(),
            topics: subTopics.length > 0 ? subTopics : undefined,
          };
        }
        throw new Error(`Invalid topic format at index ${ti}`);
      });
    };

    const normBooks: SyllabusBook[] = books.map((b: any, bi: number) => {
      const bTitle = String(b.title ?? b.name ?? `书本${bi + 1}`);
      const topicsRaw = Array.isArray(b.topics) ? b.topics : Array.isArray(b.modules) ? b.modules : [];
      const normTopics: SyllabusTopic[] = processTopics(topicsRaw, bi);
      
      return {
        id: String(b.id ?? slugId('book', bTitle, bi)),
        title: bTitle,
        topics: normTopics,
      };
    });

    const preset: SyllabusPreset = {
      id: String(rawObj.id ?? slugId('syllabus', name ?? 'preset', 0)),
      name: String(name ?? `导入大纲 ${new Date().toLocaleString()}`),
      books: normBooks,
    };
    return preset;
  } catch (e) {
    console.debug('normalizeSyllabusJson failed', e, raw);
    return null;
  }
}

const checkAnswerIsCorrect = (q: QuizQuestion, selected: string[]): boolean => {
  if (!q.answerIds) return false;
  if (selected.length !== q.answerIds.length) return false;
  const correctSet = new Set(q.answerIds);
  return selected.every(opt => correctSet.has(opt));
};

const buildSuggestedTutorQuestions = (q: QuizQuestion): string[] => {
  const correctLetters = q.answerIds || [];
  if (correctLetters.length === 0) return [];
  // Need to map IDs back to Text if IDs are labels A,B... or just use IDs if they are readable
  // Assuming IDs are typically A, B, C... for suggested questions.
  return [
    `请详细解释一下，为什么本题的正确答案是 ${correctLetters.join('、')}？`,
    `这道题主要考察了什么核心概念？请系统梳理这一知识点。`,
    `能结合2024-2025年的最新案例，对这道题涉及的知识点进行拓展吗？`
  ];
};

// --- New Structured Explanation Renderer ---
const renderFormattedExplanation = (q: QuizQuestion, theme: Theme) => {
  const colors = COLORS[theme];
  const textColor = colors.textMain;
  const titleColor = colors.primary;
  
  const SectionHeader = ({ title }: { title: string }) => (
    <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: titleColor, marginTop: '16px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ width: '4px', height: '14px', background: titleColor, borderRadius: '2px', display: 'inline-block' }}></span>
      {title}
    </h3>
  );

  return (
    <div style={{ fontSize: '14px', lineHeight: '1.6', color: textColor }}>
      {(q.coreConcept || q.analysis) && (
        <section>
          <SectionHeader title="核心概念" />
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {q.coreConcept || q.analysis}
          </div>
        </section>
      )}

      {q.optionAnalyses && Object.keys(q.optionAnalyses).length > 0 && (
        <section>
          <SectionHeader title="选项分析" />
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {q.options.map((opt, idx) => {
              const letter = indexToLetter(idx); // Fallback if IDs are not letters
              // Try to find analysis by Option ID first, then by index letter
              const analysis = q.optionAnalyses?.[opt.id] ?? q.optionAnalyses?.[letter];
              if (!analysis) return null;
              return (
                <li key={opt.id} style={{ marginBottom: '6px', display: 'flex', gap: '8px' }}>
                  <span style={{ fontWeight: 'bold', minWidth: '20px' }}>{letter}.</span>
                  <span>{analysis}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {q.extendedCases && q.extendedCases.length > 0 && (
        <section>
          <SectionHeader title="延伸案例 (2024-2025)" />
          <ul style={{ paddingLeft: '20px', margin: 0 }}>
            {q.extendedCases.map((c, idx) => (
              <li key={idx} style={{ marginBottom: '4px' }}>{c}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

// --- Grouping Logic Helpers ---

// 1. Types for Mapping
type QuestionSyllabusMapping = {
  bookId: string | null;
  topicId: string | null;
};

// 2. Refined Mapping Function (Scoring Based)
const mapQuestionToSyllabus = (
  q: QuizQuestion, 
  preset: SyllabusPreset | null,
  metaMap: Record<string, QuestionMeta>,
  bankInfo?: { title?: string }
): QuestionSyllabusMapping | null => {
  if (!preset) return null;

  // --- Step 1: Manual Assignment (Highest Priority) ---
  const meta = metaMap[q.id];
  // Check both meta (user override) and question's own assigned IDs (from generation)
  const targetBookId = meta?.assignedBookId || q.assignedBookId;
  const targetTopicId = meta?.assignedTopicId || q.assignedTopicId;

  if (targetBookId) {
    const book = preset.books.find(b => b.id === targetBookId);
    if (book) {
      let topicId = targetTopicId || null;
      if (topicId && topicId !== 'other') {
        // Check if topic exists in any level of the topic hierarchy
        const findTopicById = (id: string, topics: SyllabusTopic[]): boolean => {
          for (const topic of topics) {
            if (topic.id === id) return true;
            if (topic.topics && findTopicById(id, topic.topics)) return true;
          }
          return false;
        };
        
        const hasTopic = findTopicById(topicId, book.topics);
        if (!hasTopic) topicId = null;
      }
      return { bookId: book.id, topicId };
    }
  }

  // --- Step 2: Scoring-based Matching ---
  const normalize = (s?: string) => (s ?? '').toLowerCase().trim();
  const containsLoose = (a: string, b: string) => a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));

  // Build candidate text blobs
  const qBookTitle = normalize(bankInfo?.title); // Often bank title is book title
  // Also check sourceDocument if it exists
  const qSourceDoc = normalize(q.sourceDocument);
  
  const questionText = normalize(
    [
      bankInfo?.title,
      q.sourceDocument,
      q.stem,
      q.coreConcept,
      q.analysis
    ].filter(Boolean).join(' ')
  );

  let bestBookId: string | null = null;
  let bestBookScore = 0;

  let bestTopicBookId: string | null = null;
  let bestTopicId: string | null = null;
  let bestTopicScore = 0;

  for (const book of preset.books) {
    const nBookTitleS = normalize(book.title);
    if (!nBookTitleS) continue;

    let bookScore = 0;

    // Book Score Rules
    if (containsLoose(qBookTitle, nBookTitleS)) bookScore += 3;
    if (containsLoose(qSourceDoc, nBookTitleS)) bookScore += 3;
    if (containsLoose(questionText, nBookTitleS)) bookScore += 1;

    if (bookScore > bestBookScore) {
      bestBookScore = bookScore;
      bestBookId = book.id;
    }

    // Check Topics within this book (recursively handle nested topics)
    const checkTopicsRecursively = (topics: SyllabusTopic[], depth: number = 0) => {
      for (const topic of topics) {
        const nTopicTitle = normalize(topic.title);
        if (!nTopicTitle) continue;

        let topicScore = 0;
        
        // Topic Score Rules
        // 1. If bank/source explicitly mentions topic
        if (containsLoose(qBookTitle, nTopicTitle)) topicScore += 2;
        
        // 2. If text contains topic
        if (containsLoose(questionText, nTopicTitle)) topicScore += 2;
        
        // 3. Core Concept matches topic highly
        const nCore = normalize(q.coreConcept);
        if (containsLoose(nCore, nTopicTitle)) topicScore += 2;

        // 4. Analysis contains topic
        const nAnalysis = normalize(q.analysis);
        if (containsLoose(nAnalysis, nTopicTitle)) topicScore += 1;

        // Add depth bonus (prioritize higher-level topics slightly)
        topicScore += (3 - Math.min(depth, 2)) * 0.5;

        if (topicScore > bestTopicScore) {
          bestTopicScore = topicScore;
          bestTopicId = topic.id;
          bestTopicBookId = book.id;
        }

        // Recursively check subtopics
        if (topic.topics && topic.topics.length > 0) {
          checkTopicsRecursively(topic.topics, depth + 1);
        }
      }
    };

    checkTopicsRecursively(book.topics || []);
  }

  const TOPIC_THRESHOLD = 3;
  const BOOK_THRESHOLD = 2;

  // Decision Priority: High Score Topic > High Score Book > Null
  if (bestTopicScore >= TOPIC_THRESHOLD && bestTopicBookId && bestTopicId) {
    return { bookId: bestTopicBookId, topicId: bestTopicId };
  }

  if (bestBookScore >= BOOK_THRESHOLD && bestBookId) {
    return { bookId: bestBookId, topicId: null };
  }

  // Fallback: If we found a "best book" but score is low (e.g. 1), 
  // but NO other book matched at all, maybe we can be lenient? 
  // For now, strict threshold to avoid wrong classification.
  
  return null; 
};

type GroupedTopic = {
  topic: SyllabusTopic;
  questions: QuizQuestion[];
  subtopics?: {
    [subtopicId: string]: GroupedTopic;
  };
};

type GroupedByBook = {
  [bookId: string]: {
    book: SyllabusBook; 
    topics: {
      [topicId: string]: GroupedTopic;
    };
    otherQuestions: QuizQuestion[]; 
  };
};

// Legacy Grouping (Simple)
const groupQuestionsByBookSimple = (quizHistory: QuizBank[]): Record<string, {questionCount: number, questions: QuizQuestion[]}> => {
  const result: any = {};
  const seenQuestionIds = new Set<string>();
  quizHistory.forEach(bank => {
    bank.questions.forEach(q => {
      const id = q.id.toString();
      if (seenQuestionIds.has(id)) return;
      seenQuestionIds.add(id);
      let bookName = q.sourceDocument?.trim();
      if (!bookName) bookName = bank.sourceFiles?.[0] || bank.title || '未命名题库';
      if (!result[bookName]) result[bookName] = { questionCount: 0, questions: [] };
      result[bookName].questionCount += 1;
      result[bookName].questions.push(q);
    });
  });
  return result;
};

type TagGroupedQuestions = {
  [tagName: string]: {
    questionCount: number;
    questions: QuizQuestion[];
  };
};

const groupQuestionsByTag = (quizHistory: QuizBank[], metaMap: Record<string, QuestionMeta>): TagGroupedQuestions => {
  const result: TagGroupedQuestions = {};
  const seenQuestionIds = new Set<string>();
  
  quizHistory.forEach(bank => {
    bank.questions.forEach(q => {
      const id = q.id.toString();
      if (seenQuestionIds.has(id)) return;
      seenQuestionIds.add(id);

      const meta = metaMap[id];
      if (meta && meta.tags && meta.tags.length > 0) {
        meta.tags.forEach(tag => {
          if (!result[tag]) {
            result[tag] = { questionCount: 0, questions: [] };
          }
          result[tag].questionCount += 1;
          result[tag].questions.push(q);
        });
      }
    });
  });
  
  return result;
};

// --- Export Helper ---
function exportQuizBankToJson(bank: QuizBank) {
  try {
    const data = JSON.stringify(bank.questions, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = bank.title?.replace(/[\/:*?"<>|]/g, '_') || '题库';
    a.href = url;
    a.download = `${safeTitle}_${bank.questionCount}题.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('导出题库为 JSON 失败：', e);
  }
}

// --- Persistence Helpers for Quiz Progress ---
const buildBankSessionKey = (bankId: string) => `bank:${bankId}`;
const buildBookSessionKey = (syllabusId: string, bookId: string) => `syllabus:${syllabusId}:book:${bookId}`;
const buildTopicSessionKey = (syllabusId: string, bookId: string, topicId: string) => `syllabus:${syllabusId}:topic:${bookId}:${topicId}`;
const buildSyllabusSessionKey = (syllabusId: string) => `syllabus:${syllabusId}:all`;

function loadAllProgress(): StoredQuizProgressMap {
    try {
      const raw = localStorage.getItem(QUIZ_PROGRESS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch (e) {
      console.warn('Failed to load quiz progress', e);
      return {};
    }
  }
  
  function saveAllProgress(map: StoredQuizProgressMap) {
    try {
      localStorage.setItem(QUIZ_PROGRESS_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('Failed to save quiz progress', e);
    }
  }
  
  function loadProgress(sessionKey: string): StoredQuizProgress | null {
    const map = loadAllProgress();
    return map[sessionKey] ?? null;
  }
  
  function saveProgress(sessionKey: string, progress: StoredQuizProgress) {
    const map = loadAllProgress();
    map[sessionKey] = progress;
    saveAllProgress(map);
  }
  
  function clearProgress(sessionKey: string) {
    const map = loadAllProgress();
    delete map[sessionKey];
    saveAllProgress(map);
  }

// --- LLM Call Abstraction ---
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function callLLM(
  config: ApiConfig,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const { protocol, baseUrl, model, apiKey, customPath } = config;

  if (!apiKey || !baseUrl || !model) {
    throw new Error('请先在配置中填写完整的 Base URL、模型名称和 API Key。');
  }

  if (protocol === 'openai-compatible') {
    const path = customPath || '/v1/chat/completions';
    const url = baseUrl.replace(/\/+$/, '') + path;

    const body: any = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (options?.maxTokens) body.max_tokens = options.maxTokens;
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 402) throw new Error("API 余额不足 (402)。");
      const text = await res.text();
      throw new Error(`OpenAI 兼容接口调用失败：${res.status} ${text}`);
    }

    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.message?.parts?.map((p: any) => p.text || '').join('') ??
      '';
    if (!content) throw new Error('模型未返回有效内容。');
    return content;

  } else {
    // --- Gemini Native Protocol ---
    const trimmedBase = baseUrl.replace(/\/+$/, '');
    const systemMsg = messages.find(m => m.role === 'system');
    const otherMsgs = messages.filter(m => m.role !== 'system');
    const contents = otherMsgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: any = { contents };
    if (systemMsg) {
      body.system_instruction = {
        parts: [{ text: systemMsg.content }],
      };
    }
    if (options?.maxTokens) body.generationConfig = { maxOutputTokens: options.maxTokens };
    if (options?.temperature !== undefined) {
      body.generationConfig = body.generationConfig || {};
      body.generationConfig.temperature = options.temperature;
    }

    const callGeminiOnce = async (version: 'v1beta' | 'v1') => {
      const url = `${trimmedBase}/${version}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res;
    };

    let res = await callGeminiOnce('v1beta');
    if (res.status === 404) {
      console.warn("Gemini v1beta endpoint not found, retrying with v1...");
      res = await callGeminiOnce('v1');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini 原生接口调用失败 (${res.status}): ${text}`);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text || '').join('');
    
    if (!text) throw new Error('Gemini 未返回有效内容。');
    return text;
  }
}

// --- Components ---

const ResponsiveStyles = ({ theme }: { theme: Theme }) => (
  <style>{`
    body { background-color: ${COLORS[theme].background}; color: ${COLORS[theme].textMain}; transition: background-color 0.3s, color 0.3s; }
    .ai-fab {
      position: fixed; bottom: 100px; right: 30px; width: 60px; height: 60px;
      border-radius: 50%; background: ${COLORS[theme].primary}; color: white;
      border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-size: 24px;
      cursor: pointer; z-index: 40; display: flex; align-items: center; justify-content: center;
      transition: all 0.3s ease;
    }
    .quiz-nav-bar {
      position: fixed; bottom: 0; left: 0; right: 0; background: ${COLORS[theme].surface};
      padding: 16px; border-top: 1px solid ${COLORS[theme].border};
      display: flex; justify-content: space-between; max-width: 800px; margin: 0 auto;
      z-index: 30; transition: background-color 0.3s;
    }
    .chat-input-field {
      flex: 1; padding: 10px; border-radius: 20px; border: 1px solid ${COLORS[theme].border};
      outline: none; background-color: ${COLORS[theme].inputBg}; color: ${COLORS[theme].textMain}; font-size: 14px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .animate-spin { animation: spin 1s linear infinite; }
    @media (max-width: 768px) {
      .ai-fab { bottom: 100px !important; right: 20px !important; }
      .chat-input-field { font-size: 16px !important; }
      .quiz-nav-bar { padding-bottom: max(20px, env(safe-area-inset-bottom)); }
    }
  `}</style>
);

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error', onClose: () => void }) => (
  <div style={{
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    backgroundColor: type === 'success' ? '#16a34a' : '#dc2626',
    color: 'white', padding: '12px 24px', borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.2)', zIndex: 1000, fontWeight: '600',
    display: 'flex', alignItems: 'center', gap: '10px'
  }}>
    <span>{message}</span>
    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '18px' }}>×</button>
  </div>
);

const ChatSidebar = ({ isOpen, onClose, messages, onSend, isLoading, theme }: any) => {
  const [input, setInput] = useState("");
  const [position, setPosition] = useState({ x: window.innerWidth - 350, y: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const colors = COLORS[theme];
  
  // 拖拽开始
  const handleDragStart = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    // 阻止默认文本选择行为
    e.preventDefault();
    isDragging.current = true;
    startPos.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', handleDragEnd);
  };
  
  // 拖拽中
  const handleDrag = (e: MouseEvent) => {
    if (!isDragging.current) return;
    // 获取窗口尺寸限制
    const maxX = window.innerWidth - 350;
    const maxY = window.innerHeight - 50;
    
    // 计算新位置并限制在窗口内
    let newX = e.clientX - startPos.current.x;
    let newY = e.clientY - startPos.current.y;
    
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));
    
    setPosition({ x: newX, y: newY });
  };
  
  // 拖拽结束，取消自动吸附，让用户可以自由放置
  const handleDragEnd = () => {
    isDragging.current = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', handleDragEnd);
  };
  
  // 响应窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      const screenWidth = window.innerWidth;
      if (position.x > screenWidth - 350) {
        setPosition(prev => ({ ...prev, x: screenWidth - 350 }));
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position.x]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  return (
    <>
      {isOpen && <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 40 }} />}
      <div ref={dragRef} style={{
        position: 'fixed', top: position.y, bottom: 0, width: '350px', maxWidth: '85vw',
        left: position.x,
        backgroundColor: colors.surface, zIndex: 50,
        boxShadow: '-4px 0 15px rgba(0,0,0,0.3)',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease-in-out',
        display: 'flex', flexDirection: 'column'
      }}>
        <div 
          style={{ 
            padding: '16px', 
            borderBottom: '1px solid ' + colors.border + '', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            background: colors.background,
            cursor: 'move',
            userSelect: 'none'
          }}
          onMouseDown={handleDragStart}
        >
          <h3 style={{ margin: 0, color: colors.textMain }}>🤖 AI 答疑助手</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: '24px', cursor: 'pointer', color: colors.textSub }}>×</button>
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: colors.surface }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: colors.textSub, marginTop: '40px' }}>
              <p>👋 你好！我是你的学习助手。</p>
              <p>关于这道题有什么不懂的吗？</p>
            </div>
          )}
          {messages.map((msg: any, i: number) => (
            <div key={i} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
              {msg.reasoning && (
                 <details style={{ fontSize: '12px', color: colors.textSub, background: theme === 'dark' ? '#334155' : '#f1f5f9', padding: '8px', borderRadius: '8px', marginBottom: '4px', border: '1px dashed ' + colors.border + '' }}>
                   <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>🤔 深度思考过程</summary>
                   <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap' }}>{msg.reasoning}</div>
                 </details>
              )}
              <div style={{
                backgroundColor: msg.role === 'user' ? colors.primary : (theme === 'dark' ? '#334155' : '#f3f4f6'),
                color: msg.role === 'user' ? 'white' : colors.textMain,
                padding: '10px 14px', borderRadius: '12px',
                borderBottomRightRadius: msg.role === 'user' ? '2px' : '12px',
                borderBottomLeftRadius: msg.role === 'user' ? '12px' : '2px',
                fontSize: '14px', lineHeight: '1.5',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
              }}>
                {msg.role === 'user' ? msg.content : (
                  <div className="ai-markdown" dangerouslySetInnerHTML={{ 
                    __html: msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>').replace(/- (.*)/g, '• $1')
                  }} />
                )}
              </div>
            </div>
          ))}
          {isLoading && <div style={{ alignSelf: 'flex-start', color: colors.textSub, fontSize: '12px' }}>思考中...</div>}
        </div>
        <div style={{ padding: '16px', borderTop: '1px solid ' + colors.border + '', background: colors.surface }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="chat-input-field" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="输入你的问题..." />
            <button onClick={handleSend} disabled={isLoading} style={{ width: '40px', height: '40px', borderRadius: '50%', border: 'none', backgroundColor: colors.primary, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>➤</button>
          </div>
        </div>
      </div>
    </>
  );
};

// --- Main App Component ---
const App = () => {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || 'light');
  const colors = COLORS[theme];

  const [appTitle, setAppTitle] = useState(() => localStorage.getItem(APP_TITLE_KEY) || "AI 智能刷题助手");
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [pendingTitle, setPendingTitle] = useState("");

  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => {
    try {
      const raw = localStorage.getItem(API_CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      protocol: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',
      customPath: '/v1/chat/completions',
      preset: 'deepseek-v3'
    };
  });

  const [apiPresets, setApiPresets] = useState<ApiConfigHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(API_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [pendingPresetName, setPendingPresetName] = useState("");

  const [syllabusPresets, setSyllabusPresets] = useState<SyllabusPreset[]>(() => {
    try {
      const raw = localStorage.getItem(SYLLABUS_PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [selectedSyllabusId, setSelectedSyllabusId] = useState<string | null>(() => {
    try {
        const raw = localStorage.getItem(SYLLABUS_PRESETS_KEY);
        const presets = raw ? JSON.parse(raw) : [];
        return presets.length > 0 ? presets[0].id : null;
    } catch { return null; }
  });
  const [syllabusRawText, setSyllabusRawText] = useState("");
  const [isProcessingSyllabus, setIsProcessingSyllabus] = useState(false);
  
  // New States for Syllabus Naming and Renaming
  const [newSyllabusName, setNewSyllabusName] = useState("");
  const [editingSyllabusId, setEditingSyllabusId] = useState<string | null>(null);
  const [pendingSyllabusName, setPendingSyllabusName] = useState("");
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);

  // State for collapsible books in History View
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});

  const [pendingDeleteBankId, setPendingDeleteBankId] = useState<string | null>(null);

  // NEW: Generation Context State
  const [genSyllabusId, setGenSyllabusId] = useState<string | null>(null);
  const [genBookId, setGenBookId] = useState<string | null>(null);
  const [genTopicId, setGenTopicId] = useState<string | null>(null);

  const [settings, setSettings] = useState({
    numQuestions: 10,
    questionMode: 'single-only' as 'single-only' | 'multiple-only' | 'mixed'
  });

  const [batchSize, setBatchSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 10;
    try {
      const raw = localStorage.getItem(BATCH_SIZE_KEY);
      const n = raw ? parseInt(raw, 10) : 10;
      if (Number.isNaN(n) || n <= 0) return 10;
      return n;
    } catch { return 10; }
  });
  
  const [speedMode, setSpeedMode] = useState<GenerationSpeedMode>(() => {
    if (typeof window === 'undefined') return 'quality';
    try {
      const raw = localStorage.getItem(SPEED_MODE_KEY);
      return raw === 'fast' ? 'fast' : 'quality';
    } catch { return 'quality'; }
  });

  const [tagPresets, setTagPresets] = useState<TagPreset[]>(() => {
    try {
      const raw = localStorage.getItem(TAG_PRESETS_KEY);
      const parsed = raw ? JSON.parse(raw) : DEFAULT_TAG_PRESETS;
      return Array.isArray(parsed) ? parsed : DEFAULT_TAG_PRESETS;
    } catch { return DEFAULT_TAG_PRESETS; }
  });

  const saveBatchSize = (value: number) => {
    const n = Math.min(Math.max(1, Math.round(value)), 50);
    setBatchSize(n);
    if (typeof window !== 'undefined') localStorage.setItem(BATCH_SIZE_KEY, String(n));
  };

  const saveSpeedMode = (mode: GenerationSpeedMode) => {
    setSpeedMode(mode);
    if (typeof window !== 'undefined') localStorage.setItem(SPEED_MODE_KEY, mode);
  };

  const saveTagPresets = (next: TagPreset[]) => {
    setTagPresets(next);
    localStorage.setItem(TAG_PRESETS_KEY, JSON.stringify(next));
  };

  const saveApiPresets = (next: ApiConfigHistoryItem[]) => {
    setApiPresets(next);
    localStorage.setItem(API_HISTORY_KEY, JSON.stringify(next));
  };

  const [quizSettings, setQuizSettings] = useState({
    mode: 'practice', 
    confirmSubmit: false,
    autoNextCorrect: false,
    showExplanationCorrect: true,
    autoNextWrong: false,
    showExplanationWrong: true, 
    showNavButtons: true
  });
  
  const [screen, setScreen] = useState<'home' | 'quiz' | 'result' | 'mistakes' | 'history'>('home');
  const [uploadedFiles, setUploadedFiles] = useState<{name: string, content: string}[]>([]);
  const [loading, setLoading] = useState(false);
  const [generationStage, setGenerationStage] = useState<GenerationStage>('idle');
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [toast, setToast] = useState<{msg: string, type: 'success'|'error'} | null>(null);
  const [isGeneratingInBank, setIsGeneratingInBank] = useState(false);
  const [showAnswerSheetModal, setShowAnswerSheetModal] = useState(false);

  const isGenerating = false; // 不再显示前端阻塞弹窗，所有生成操作都在后台运行

  // 答题记录状态

  const [quizData, setQuizData] = useState<QuizQuestion[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, StoredQuizAnswer>>({});
  const [tempSelection, setTempSelection] = useState<string[]>([]);
  const [quizTime, setQuizTime] = useState(0); // 答题时间（秒）
  
  // --- Persistent State ---
  // Using normalizeQuizJson to ensure stored mistakes/trash are valid, but if array is valid, keep it.
  const [mistakes, setMistakes] = useState<MistakeItem[]>(() => {
    try {
      const saved = localStorage.getItem(MISTAKE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const [mistakeTrash, setMistakeTrash] = useState<TrashItem[]>(() => {
    try {
      const saved = localStorage.getItem(MISTAKE_TRASH_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const [mistakeViewMode, setMistakeViewMode] = useState<MistakeViewMode>('mistakes');

  const [history, setHistory] = useState<QuizBank[]>(() => {
    try {
      const saved = localStorage.getItem(QUIZ_HISTORY_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const [questionMetaMap, setQuestionMetaMap] = useState<Record<string, QuestionMeta>>(() => {
    try {
      const raw = localStorage.getItem(QUESTION_META_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: string, content: string, reasoning?: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [showStats, setShowStats] = useState(false);

    const [editingBankId, setEditingBankId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const [historyViewMode, setHistoryViewMode] = useState<HistoryViewMode>('byBank');
    
    // 合并题库功能状态
    const [selectedBankIds, setSelectedBankIds] = useState<string[]>([]);
const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
    
    // 多任务队列状态
    type TaskType = 'mergeBanks' | 'exportBanks' | 'other';
    type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
    type Task = {
      id: string;
      type: TaskType;
      title: string;
      status: TaskStatus;
      progress: number;
      banks: QuizBank[];
      result?: any;
      error?: string;
    };
    const [taskQueue, setTaskQueue] = useState<Task[]>([]);
    
    // Jump to Question State (moved from renderQuiz to fix Hook rules violation)
    const [jumpInput, setJumpInput] = useState('');
  const [jumpError, setJumpError] = useState('');
  
  // 格式化时间函数
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const [showClearMistakesDialog, setShowClearMistakesDialog] = useState(false);
  const [showClearTrashDialog, setShowClearTrashDialog] = useState(false);

  // New: Persistent Progress State
  const [sessionKey, setSessionKey] = useState("");
  const [confirmClearProgress, setConfirmClearProgress] = useState(false);

  // New: Progress Stats Map for History View
  const [progressMap, setProgressMap] = useState<StoredQuizProgressMap>({});

  // NEW: Unified Resume Dialog State
  type ResumeDialogState = {
    visible: boolean;
    title?: string;
    sessionKey: string;
    questions: QuizQuestion[];
    stored?: StoredQuizProgress | null;
  };
  const [resumeDialog, setResumeDialog] = useState<ResumeDialogState | null>(null);

  // --- Hook Refs ---
  const currentTagInput = useRef<HTMLInputElement>(null);
  const presetTagInput = useRef<HTMLInputElement>(null);

  // --- Effects ---
  useEffect(() => {
    const savedSettings = localStorage.getItem('quiz_settings_v3');
    if (savedSettings) setSettings(prev => ({ ...prev, ...JSON.parse(savedSettings) }));
    const savedQuizSettings = localStorage.getItem('quiz_advanced_settings');
    if (savedQuizSettings) setQuizSettings(JSON.parse(savedQuizSettings));
    const savedFiles = sessionStorage.getItem('quiz_uploaded_files');
    if (savedFiles) setUploadedFiles(JSON.parse(savedFiles));
  }, []);

  useEffect(() => { localStorage.setItem(API_CONFIG_KEY, JSON.stringify(apiConfig)); }, [apiConfig]);
  useEffect(() => { localStorage.setItem('quiz_settings_v3', JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem('quiz_advanced_settings', JSON.stringify(quizSettings)); }, [quizSettings]);
  useEffect(() => { localStorage.setItem(MISTAKE_KEY, JSON.stringify(mistakes)); }, [mistakes]);
  useEffect(() => { localStorage.setItem(MISTAKE_TRASH_KEY, JSON.stringify(mistakeTrash)); }, [mistakeTrash]);
  useEffect(() => { localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(history)); }, [history]);
  useEffect(() => { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem(QUESTION_META_KEY, JSON.stringify(questionMetaMap)); }, [questionMetaMap]);
  useEffect(() => { sessionStorage.setItem('quiz_uploaded_files', JSON.stringify(uploadedFiles)); }, [uploadedFiles]);
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);
  
  // 答题时间计时器
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (screen === 'quiz') {
      timer = setInterval(() => {
        setQuizTime(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [screen]);
  useEffect(() => { localStorage.setItem(APP_TITLE_KEY, appTitle); }, [appTitle]);
  useEffect(() => { localStorage.setItem(SYLLABUS_PRESETS_KEY, JSON.stringify(syllabusPresets)); }, [syllabusPresets]);

  // Load progress map when switching to history screen
  useEffect(() => {
    if (screen === 'history') {
      setProgressMap(loadAllProgress());
    }
  }, [screen]);

  // NEW: Save Quiz Progress Effect
  useEffect(() => {
      if (screen !== 'quiz' || !sessionKey || quizData.length === 0) return;
      
      const allQuestionIds = quizData.map(q => String(q.id));
      const answeredEntries = Object.entries(userAnswers).filter(([id]) => allQuestionIds.includes(id));
      const answeredCount = answeredEntries.length;
      const correctCount = answeredEntries.filter(([, v]) => v && v.isCorrect).length;

      const progress: StoredQuizProgress = {
          questionIds: allQuestionIds,
          currentIndex: currentQIndex,
          answers: userAnswers,
          answeredCount,
          correctCount,
          updatedAt: Date.now()
      };
      saveProgress(sessionKey, progress);
  }, [screen, sessionKey, quizData, currentQIndex, userAnswers]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const handleRenameAppTitle = () => {
    setPendingTitle(appTitle);
    setIsEditingTitle(true);
  };

  const handleSaveAppTitle = () => {
    const trimmed = pendingTitle.trim();
    if (trimmed) {
      setAppTitle(trimmed);
      localStorage.setItem(APP_TITLE_KEY, trimmed);
    }
    setIsEditingTitle(false);
  };

  const updateQuestionMeta = (id: string, updater: (meta: QuestionMeta) => QuestionMeta) => {
    setQuestionMetaMap(prev => {
      const current = prev[id] || { id };
      const updated = updater(current);
      const next = { ...prev, [id]: updated };
      return next;
    });
  };

  const isQuestionFavorited = (q: QuizQuestion) => favorites.some(f => f.id === q.id);
  
  const toggleFavorite = (q: QuizQuestion, fromBankTitle?: string) => {
    setFavorites(prev => {
      const exists = prev.some(f => f.id === q.id);
      if (exists) return prev.filter(f => f.id !== q.id);
      return [{ id: q.id as string, question: q, fromBankTitle, addedAt: new Date().toISOString() }, ...prev];
    });
  };

  // --- Unified Quiz Start Logic ---
  const startQuizWithResume = (opts: {
    title?: string;
    sessionKey: string;
    questions: QuizQuestion[];
  }) => {
    const ordered = prepareOrderedQuestions(opts.questions);
    const stored = loadProgress(opts.sessionKey);

    const idsNow = ordered.map(q => String(q.id)).sort();
    const idsStored = stored ? [...stored.questionIds].sort() : [];
    const same =
        !!stored &&
        idsNow.length === idsStored.length &&
        idsNow.every((id, i) => id === idsStored[i]);

    if (same) {
        setResumeDialog({
            visible: true,
            title: opts.title,
            sessionKey: opts.sessionKey,
            questions: ordered,
            stored,
        });
    } else {
        openQuizSession({ sessionKey: opts.sessionKey, questions: ordered, initialIndex: 0 });
    }
  };

  const openQuizSession = (args: {
    sessionKey: string;
    questions: QuizQuestion[];
    initialIndex: number;
    restoredAnswers?: Record<string, StoredQuizAnswer>;
  }) => {
      setSessionKey(args.sessionKey);
      setQuizData(args.questions);
      setCurrentQIndex(args.initialIndex);
      setUserAnswers(args.restoredAnswers || {});
      setTempSelection([]);
      setScreen('quiz');
      setConfirmClearProgress(false);
      setQuizTime(0); // 重置答题时间
  };

  const handleResumeConfirm = () => {
      if (resumeDialog && resumeDialog.stored) {
          openQuizSession({ 
              sessionKey: resumeDialog.sessionKey, 
              questions: resumeDialog.questions, 
              initialIndex: Math.min(Math.max(resumeDialog.stored.currentIndex, 0), resumeDialog.questions.length - 1),
              restoredAnswers: resumeDialog.stored.answers
          });
      }
      setResumeDialog(null);
  };

  const handleResumeRestart = () => {
      if (resumeDialog) {
          clearProgress(resumeDialog.sessionKey);
          openQuizSession({ 
              sessionKey: resumeDialog.sessionKey, 
              questions: resumeDialog.questions, 
              initialIndex: 0 
          });
      }
      setResumeDialog(null);
  };

  const restartProgress = () => {
      clearProgress(sessionKey);
      setCurrentQIndex(0);
      setUserAnswers({});
      setTempSelection([]);
  };

  const handleClearCurrentProgress = () => {
      restartProgress();
      setConfirmClearProgress(false);
      showToast("进度已重置", "success");
  };

  const startFavoritePractice = () => {
    if (favorites.length === 0) return showToast("当前没有收藏的题目", "error");
    const questions = prepareOrderedQuestions(favorites.map(f => f.question));
    startQuizWithResume({ sessionKey: 'favorites-session', questions, title: '收藏题库' });
  };

  const moveMistakeToTrash = (item: MistakeItem) => {
    const trashItem: TrashItem = { ...item, removedAt: new Date().toISOString() };
    setMistakes(prev => prev.filter(m => m.id !== item.id));
    setMistakeTrash(prev => [trashItem, ...prev]);
    showToast("已移入垃圾篓", "success");
  };

  const confirmClearMistakes = () => {
    if (mistakes.length === 0) return;
    const toTrash: TrashItem[] = mistakes.map(m => ({ ...m, removedAt: new Date().toISOString() }));
    setMistakes([]);
    setMistakeTrash(prev => [...toTrash, ...prev]);
    setShowClearMistakesDialog(false);
    showToast("已全部移入垃圾篓", "success");
  };

  const confirmClearTrash = () => {
    setMistakeTrash([]);
    setShowClearTrashDialog(false);
    showToast("垃圾篓已清空", "success");
  };

  const restoreMistakeFromTrash = (item: TrashItem) => {
    const exists = mistakes.some(m => m.id === item.id);
    if (!exists) setMistakes(prev => [{ ...item }, ...prev]);
    setMistakeTrash(prev => prev.filter(t => t.id !== item.id));
    showToast("已恢复到错题本", "success");
  };

  const handleRestoreAllTrash = () => {
    if (mistakeTrash.length === 0) return;
    const newMistakes = [...mistakes, ...mistakeTrash];
    setMistakes(newMistakes);
    setMistakeTrash([]);
    localStorage.setItem(MISTAKE_KEY, JSON.stringify(newMistakes));
    localStorage.setItem(MISTAKE_TRASH_KEY, JSON.stringify([]));
    showToast(`成功恢复 ${mistakeTrash.length} 个错题`, 'success');
  };

  const permanentlyDeleteFromTrash = (item: TrashItem) => {
    setMistakeTrash(prev => prev.filter(t => t.id !== item.id));
    showToast("错题已彻底删除", "success");
  };

  const handleAddPreset = () => {
    const name = presetTagInput.current?.value.trim();
    if (!name) return;
    if (tagPresets.some(p => p.name === name)) {
      showToast("预设标签已存在", "error");
      return;
    }
    const newPreset: TagPreset = { id: `preset-${Date.now()}`, name };
    saveTagPresets([...tagPresets, newPreset]);
    if (presetTagInput.current) presetTagInput.current.value = '';
  };

  const handleRemovePreset = (id: string) => {
    saveTagPresets(tagPresets.filter(p => p.id !== id));
  };

  const restoreDefaultTagPresets = () => {
      saveTagPresets(DEFAULT_TAG_PRESETS);
  };

  const handleSaveCurrentApiPreset = () => {
    if (!apiConfig.apiKey) {
      showToast('错误：API Key 为空，无法保存', 'error');
      return;
    }
    const defaultName = apiConfig.model || `Config ${new Date().toLocaleTimeString()}`;
    const newPreset: ApiConfigHistoryItem = {
      id: Date.now().toString(),
      name: defaultName,
      protocol: apiConfig.protocol,
      baseUrl: apiConfig.baseUrl,
      model: apiConfig.model,
      customPath: apiConfig.customPath,
      apiKey: apiConfig.apiKey,
      createdAt: new Date().toISOString()
    };
    const updatedPresets = [newPreset, ...apiPresets];
    setApiPresets(updatedPresets);
    localStorage.setItem(API_HISTORY_KEY, JSON.stringify(updatedPresets));
    showToast(`已保存配置：${defaultName}`, 'success');
  };

  const handleApplyApiPreset = (id: string) => {
    const item = apiPresets.find(h => h.id === id);
    if (!item) return;
    setApiConfig(prev => ({
      ...prev,
      protocol: item.protocol,
      baseUrl: item.baseUrl,
      model: item.model,
      customPath: item.customPath,
      apiKey: item.apiKey || '',
      preset: undefined 
    }));
    showToast(`已应用预设: ${item.name}`, "success");
  };

  const handleDeleteApiPreset = (id: string) => {
    const next = apiPresets.filter(h => h.id !== id);
    saveApiPresets(next);
  };
  
  const handleStartRenamePreset = (id: string, currentName: string) => {
    setEditingPresetId(id);
    setPendingPresetName(currentName);
  };

  const handleSavePresetName = (id: string) => {
      const trimmed = pendingPresetName.trim();
      if(trimmed) {
          const updated = apiPresets.map(p => p.id === id ? {...p, name: trimmed} : p);
          saveApiPresets(updated);
      }
      setEditingPresetId(null);
      setPendingPresetName("");
  };

  const handleStartRenameSyllabus = (id: string, currentName: string) => {
    setEditingSyllabusId(id);
    setPendingSyllabusName(currentName);
  };

  const handleSaveSyllabusPresetName = (id: string) => {
    const trimmed = pendingSyllabusName.trim();
    if(trimmed) {
        setSyllabusPresets(prev => {
            const updated = prev.map(p => p.id === id ? {...p, name: trimmed} : p);
            return updated;
        });
    }
    setEditingSyllabusId(null);
    setPendingSyllabusName("");
  };

  const handleAutoClassifyUnmatched = async (unmatchedQs: QuizQuestion[]) => {
    const syllabus = syllabusPresets.find(p => p.id === selectedSyllabusId);
    if (!syllabus || unmatchedQs.length === 0 || !apiConfig.apiKey) {
        showToast("无法执行：请检查大纲、未分类题目和 API Key", "error");
        return;
    }

    setIsAutoClassifying(true);
    let successCount = 0;
    
    // Batching to avoid context limits
    const BATCH_SIZE = 20;
    const chunks = [];
    for (let i = 0; i < unmatchedQs.length; i += BATCH_SIZE) {
        chunks.push(unmatchedQs.slice(i, i + BATCH_SIZE));
    }

    try {
        // Recursive function to build context for all topic levels
    const buildTopicContext = (topics: SyllabusTopic[], indentLevel: number = 1): string => {
        return topics.map(t => {
            const indent = '  '.repeat(indentLevel);
            let topicStr = `${indent}Topic ID: "${t.id}", Title: "${t.title}"\n`;
            // Recursively include subtopics if they exist
            if (t.topics && t.topics.length > 0) {
                topicStr += buildTopicContext(t.topics, indentLevel + 1);
            }
            return topicStr;
        }).join('');
    };
    
    // Construct Syllabus Context String (includes all levels)
    const syllabusContext = syllabus.books.map(b => 
        `Book ID: "${b.id}", Title: "${b.title}"\n` + 
        buildTopicContext(b.topics, 1)
    ).join('\n\n');

        for (const chunk of chunks) {
            const questionsContext = chunk.map(q => 
                `Question ID: "${q.id}"\nContent: ${q.stem}\nCore Concept: ${q.coreConcept || 'N/A'}\nBook Hint: ${q.bookTitle || 'N/A'}`
            ).join('\n---\n');

            const prompt = `
            Task: Classify these questions into the provided Syllabus structure.
            
            Syllabus:
            ${syllabusContext}

            Questions:
            ${questionsContext}

            Requirements:
            1. Return a JSON object with a "mappings" array.
            2. Each mapping must have "questionId", "bookId", and optionally "topicId".
            3. "bookId" MUST be one of the IDs from Syllabus.
            4. "topicId" MUST be one of the IDs from that Book's topics, or null if no specific topic fits.
            5. Output pure JSON only.

            Example JSON:
            {
              "mappings": [
                { "questionId": "q123", "bookId": "book-1", "topicId": "topic-1-1" },
                { "questionId": "q124", "bookId": "book-2", "topicId": null }
              ]
            }
            `;

            const response = await callLLM(apiConfig, [{ role: 'user', content: prompt }]);
            const mappings = normalizeClassificationJson(response);

            // Update Meta Map
            if (mappings.length > 0) {
                setQuestionMetaMap(prev => {
                    const next = { ...prev };
                    mappings.forEach(m => {
                        // Verify IDs exist in syllabus
                        const book = syllabus.books.find(b => b.id === m.bookId);
                        if (!book) return;
                        
                        // Helper function to find topic by ID recursively
                        const findTopicById = (topicId: string, topics: SyllabusTopic[]): SyllabusTopic | undefined => {
                            for (const topic of topics) {
                                if (topic.id === topicId) {
                                    return topic;
                                }
                                if (topic.topics) {
                                    const found = findTopicById(topicId, topic.topics);
                                    if (found) {
                                        return found;
                                    }
                                }
                            }
                            return undefined;
                        };
                        
                        let finalTopicId: string | undefined = undefined;
                        if (m.topicId) {
                            const topic = findTopicById(m.topicId, book.topics);
                            if (topic) finalTopicId = topic.id;
                        }

                        next[m.questionId] = {
                            ...(next[m.questionId] || { id: m.questionId }),
                            assignedBookId: m.bookId,
                            assignedTopicId: finalTopicId || 'other'
                        };
                    });
                    return next;
                });
                successCount += mappings.length;
            }
        }
        showToast(`智能归类完成，成功归类 ${successCount} 题`, 'success');
    } catch (e: any) {
        showToast(`归类过程中出错: ${e.message}`, 'error');
    } finally {
        setIsAutoClassifying(false);
    }
  };

  const handleGenerateSyllabusPresetFromText = async () => {
    if (!syllabusRawText.trim() || !apiConfig.apiKey) {
        showToast("请填写 API Key 并输入大纲文本", "error");
        return;
    }
    setIsProcessingSyllabus(true);
    try {
        const prompt = `
        Task: Parse the following Exam Syllabus Text into a structured JSON format.
        Rules:
        1. Identify top-level subjects or book titles as "books".
        2. Identify ALL levels of topics, modules, chapters, or sections under each book as "topics".
        3. Preserve the exact titles from the original text, including all secondary and lower-level headings.
        4. For nested topics, use a hierarchical structure with "topics" arrays inside each topic object.
        5. Output strict JSON format with nested structure:
        {
          "books": [
            {
              "title": "Book Name",
              "topics": [
                {
                  "title": "Exact Topic Title 1",
                  "topics": [
                    { "title": "Exact Subtopic Title 1" },
                    { "title": "Exact Subtopic Title 2" }
                  ]
                },
                { "title": "Exact Topic Title 2" }
              ]
            }
          ]
        }
        6. Do not include Markdown formatting. Return only JSON.
        7. Do NOT create generic topic names like "Module 1", "Topic 2" - use the exact titles from the input.
        
        Syllabus Text:
        ${syllabusRawText}
        `;
        
        const response = await callLLM(apiConfig, [{ role: 'user', content: prompt }]);
        const newPreset = normalizeSyllabusJson(response);
        
        if (!newPreset) {
            console.error("Syllabus Generation Failed. Raw Response:", response);
            throw new Error("生成失败：无法识别大纲结构，请检查控制台日志。");
        }

        // Apply custom name if provided
        if (newSyllabusName.trim()) {
            newPreset.name = newSyllabusName.trim();
        }

        const nextPresets = [newPreset, ...syllabusPresets];
        setSyllabusPresets(nextPresets);
        setSelectedSyllabusId(newPreset.id);
        setSyllabusRawText("");
        setNewSyllabusName(""); // Reset name input
        showToast("考纲预设生成成功！", "success");

    } catch (e: any) {
        showToast(`生成失败: ${e.message}`, "error");
    } finally {
        setIsProcessingSyllabus(false);
    }
  };

  const bookGroupsLegacy = useMemo(() => groupQuestionsByBookSimple(history), [history]);
  const tagGroups = useMemo(() => groupQuestionsByTag(history, questionMetaMap), [history, questionMetaMap]);

  // --- Grouping Memo for New "Study By Book" (Req 1.2) ---
  const groupedBySyllabus = useMemo(() => {
    const selectedSyllabus = syllabusPresets.find(p => p.id === selectedSyllabusId);
    if (!selectedSyllabus) return null;

    // Helper function to find topic by ID recursively
    const findTopicById = (topicId: string, topics: SyllabusTopic[]): SyllabusTopic | undefined => {
        for (const topic of topics) {
            if (topic.id === topicId) {
                return topic;
            }
            if (topic.topics) {
                const found = findTopicById(topicId, topic.topics);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    };

    const grouped: GroupedByBook = {};
    const unmatched: QuizQuestion[] = [];
    const seenIds = new Set<string>();

    history.forEach(bank => {
        bank.questions.forEach(q => {
             const qId = q.id.toString();
             if (seenIds.has(qId)) return;
             seenIds.add(qId);

             const mapping = mapQuestionToSyllabus(q, selectedSyllabus, questionMetaMap, { title: bank.title });
             
             if (!mapping || !mapping.bookId) {
                 unmatched.push(q);
                 return;
             }

             const book = selectedSyllabus.books.find(b => b.id === mapping.bookId);
             if (!book) {
                 unmatched.push(q);
                 return;
             }

             if (!grouped[book.id]) {
                 grouped[book.id] = { book, topics: {}, otherQuestions: [] };
             }

             if (mapping.topicId) {
                 const topic = findTopicById(mapping.topicId, book.topics);
                 if (topic) {
                     if (!grouped[book.id].topics[topic.id]) {
                         grouped[book.id].topics[topic.id] = { topic, questions: [] };
                     }
                     grouped[book.id].topics[topic.id].questions.push(q);
                 } else {
                     grouped[book.id].otherQuestions.push(q);
                 }
             } else {
                 grouped[book.id].otherQuestions.push(q);
             }
        });
    });

    return { grouped, unmatched };
  }, [history, selectedSyllabusId, syllabusPresets, questionMetaMap]);

  const handleStartWholeSyllabusQuiz = () => {
    if (!groupedBySyllabus || !selectedSyllabusId) return;
    const allQuestions: QuizQuestion[] = [];
    
    // Flatten all questions in the syllabus deterministically
    // DO NOT SHUFFLE
    const syllabus = syllabusPresets.find(p => p.id === selectedSyllabusId);
    if(syllabus) {
        syllabus.books.forEach(b => {
            const group = groupedBySyllabus.grouped[b.id];
            if(group) {
                b.topics.forEach(t => {
                    if(group.topics[t.id]) allQuestions.push(...group.topics[t.id].questions);
                });
                allQuestions.push(...group.otherQuestions);
            }
        });
    }

    if (allQuestions.length === 0) {
        showToast("当前大纲下没有已匹配的题目", "error");
        return;
    }
    
    const key = buildSyllabusSessionKey(selectedSyllabusId);
    startQuizWithResume({ sessionKey: key, questions: allQuestions, title: syllabus?.name || '整套大纲' });
  };

  const currentQuizStats = useMemo(() => {
    if (!quizData || quizData.length === 0) return null;
    const byBook: Record<string, number> = {};
    quizData.forEach(q => {
        const source = q.sourceDocument || '未分类';
        if(!byBook[source]) byBook[source] = 0;
        byBook[source]++;
    });
    return { byBook };
  }, [quizData]);

  const showToast = (msg: string, type: 'success'|'error' = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handlePresetChange = (presetId: string) => {
    const preset = MODEL_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setApiConfig(prev => ({
        ...prev,
        preset: presetId,
        protocol: preset.protocol, 
        baseUrl: preset.baseUrl,
        model: preset.model,
        customPath: preset.customPath || '/v1/chat/completions'
      }));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    const newFiles: {name: string, content: string}[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let text = "";
        if (uploadedFiles.some(f => f.name === file.name) || newFiles.some(f => f.name === file.name)) continue;
        if (file.type === "application/pdf") {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          for (let j = 1; j <= pdf.numPages; j++) {
            const page = await pdf.getPage(j);
            const content = await page.getTextContent();
            text += content.items.map((item: any) => item.str).join(" ") + "\n";
          }
        } else if (file.name.endsWith(".docx")) {
           const arrayBuffer = await file.arrayBuffer();
           const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
           text = result.value;
        } else if (file.type === "application/json") {
           text = await file.text();
        } else { continue; }
        if (text && text.length > 20) newFiles.push({ name: file.name, content: text });
      }
      if (newFiles.length === 0) {
        if (files.length > 0) showToast("未提取到有效文本或文件已存在。", "error");
        return;
      }
      setUploadedFiles(prev => [...prev, ...newFiles]);
      showToast(`成功添加 ${newFiles.length} 个文件`, 'success');
    } catch (err: any) {
      showToast(err.message);
    } finally {
      setLoading(false);
      e.target.value = ''; 
    }
  };

  const handleImportJsonQuiz = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      // Use robust parser
      const validQuestions = normalizeQuizJson(text);
      
      if (!validQuestions || validQuestions.length === 0) throw new Error("无法从返回内容中解析出结构，请查看 Console 的 DEBUG 日志");
      
      const newBank: QuizBank = {
          id: `imported-${Date.now()}`,
          title: file.name.replace('.json', '') + ' (导入)',
          createdAt: new Date().toISOString(),
          sourceFiles: [file.name],
          questionCount: validQuestions.length,
          questions: validQuestions
      };
      setHistory(prev => [newBank, ...prev]);
      startQuizWithResume({ sessionKey: buildBankSessionKey(newBank.id), questions: validQuestions, title: newBank.title });
      showToast(`已成功导入 JSON 题库，共 ${validQuestions.length} 题`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleRemoveFile = (index: number) => {
      const updated = [...uploadedFiles];
      updated.splice(index, 1);
      setUploadedFiles(updated);
  };

  // --- Batch Generation Logic ---
  const generateQuiz = async (addToBank: boolean = false) => {
    if (!apiConfig.apiKey) return showToast("请输入 API Key");
    if (uploadedFiles.length === 0) return showToast("请先上传文件");

    setLoading(true);
    setGenerationStage('parsing');
    setCurrentBatchIndex(0);
    setTotalBatches(0);

    try {
      let combinedContent = "";
      const fileNames = uploadedFiles.map(f => f.name).join('、');
      uploadedFiles.forEach((file, idx) => {
          combinedContent += `\n\n--- Document ${idx + 1}: ${file.name} ---\n${file.content}`;
      });
      const MAX_CHARS = 30000; 
      if (combinedContent.length > MAX_CHARS) {
          combinedContent = combinedContent.slice(0, MAX_CHARS) + "\n...(content truncated due to length limit)...";
      }

      setGenerationStage('callingModel');

      const totalCount = settings.numQuestions;
      const safeBatchSize = Math.max(1, Math.min(batchSize, totalCount));
      const batches = Math.ceil(totalCount / safeBatchSize);
      setTotalBatches(batches);

      const allQuestions: QuizQuestion[] = [];
      const existingSet = new Set<string>();
      history.forEach(bank => bank.questions.forEach(q => existingSet.add(normalizeQuestionText(q.stem))));
      
      const llmMaxTokens = speedMode === 'fast' ? 2048 : 4096;

      for (let i = 0; i < batches; i++) {
        const batchIndex = i + 1;
        setCurrentBatchIndex(batchIndex);

        const remaining = totalCount - allQuestions.length;
        const batchCount = remaining > safeBatchSize ? safeBatchSize : remaining;

        let systemPrompt = `你是一名专业出题老师。
        请根据提供的复习资料，生成 ${batchCount} 道客观题。请严格按照下面的 JSON 结构输出，不要输出 Markdown：
        [
          {
            "id": "唯一ID字符串",
            "type": "single" 或 "multiple",
            "question": "题干(简体中文)",
            "options": ["A选项内容", "B选项内容", "C选项内容", "D选项内容"],
            "correctOptions": ["B", "C"],
            
            "coreConcept": "一句话概括本题考核的核心概念或知识点",
            "optionAnalyses": {
               "A": "为什么A错/对",
               "B": "为什么B错/对",
               "C": "...",
               "D": "..."
            },
            "extendedCases": [
               "2024年真实案例1：名称+背景+设计点",
               "2025年真实案例2：名称+背景+设计点"
            ],
            
            "sourceDocument": "来源文件名(必须是提供的文件之一)"
          }
        ]
        
        IMPORTANT RULES:
        1. All output MUST be in Simplified Chinese.
        2. 'correctOptions' must be an array of strings.
        3. Output ONLY raw JSON.
        4. **extendedCases**: You MUST provide 1-2 REAL cases from 2024-2025 related to the topic. Be specific about the case name and design/art details.
        5. **optionAnalyses**: Analyze each option briefly.
        `;

        let typeInstruction = '';
        if (settings.questionMode === 'single-only') typeInstruction = '本次所有题目必须是单选题（type 固定为 "single"，correctOptions 只包含一个字母）。';
        else if (settings.questionMode === 'multiple-only') typeInstruction = '本次所有题目必须是多选题（type 固定为 "multiple"，每题 correctOptions 至少包含 2 个正确选项）。';
        else typeInstruction = '本次题目为单选题和多选题混合，大约 70% 单选、30% 多选。';

        let userContent = `Context:\n${combinedContent}`;
        
        // NEW: Context Instruction
        const genSyllabus = syllabusPresets.find(p => p.id === genSyllabusId);
        const genBook = genSyllabus?.books.find(b => b.id === genBookId);
        const genTopic = genBook?.topics.find(t => t.id === genTopicId);

        if (genSyllabus && genBook) {
            userContent += `\n\n**出题背景约束**:
            当前大纲：${genSyllabus.name}
            目标书本：${genBook.title}
            ${genTopic ? `目标章节/模块：${genTopic.title}` : ''}
            请确保生成的题目紧密围绕上述书本${genTopic ? '和章节' : ''}的内容。
            请在返回的 JSON 中，将 "bookTitle" 字段设为 "${genBook.title}"${genTopic ? `, "chapterTitle" 字段设为 "${genTopic.title}"` : ''}。`;
        }
        
        userContent += `\n\n**TASK (Batch ${batchIndex}/${batches})**:\nGenerate exactly ${batchCount} NEW questions.\n${typeInstruction}`;
        userContent += `\n\n本次出题所依据的学习资料文件包括：${fileNames}`;
        userContent += `\n\n请尽量覆盖资料中的不同知识点，避免与之前的题目重复。`;
        
        if (speedMode === 'fast') {
          userContent += `\n\n(Speed Mode Enabled: Please be concise. Skip verbose reasoning steps. Just output the valid JSON directly to save time.)`;
        }

        userContent += `\n\n对每一道题，请严格填充以下字段（全部使用简体中文）：
        1. "sourceDocument": 必须从上述文件名列表中选择一个最主要的来源，原样拷贝字符串。
        2. "coreConcept": 核心概念界定。
        3. "optionAnalyses": 逐项分析。
        4. "extendedCases": 必须包含 2024-2025 年前沿案例。`;

        let messages: ChatMessage[] = [];
        if (apiConfig.model.includes("reasoner")) {
           messages = [{ role: "user", content: systemPrompt + "\n\n" + userContent }];
        } else {
           messages = [
             { role: "system", content: systemPrompt },
             { role: "user", content: userContent }
           ];
        }

        const rawText = await callLLM(apiConfig, messages, { maxTokens: llmMaxTokens });
        
        let batchQuestions: QuizQuestion[] = [];
        try {
           // Use robust parser instead of manual/flimsy JSON.parse
           const validArr = normalizeQuizJson(rawText);

           if (!validArr || validArr.length === 0) {
               console.warn("Parsed JSON has no valid questions array. Raw:", rawText);
               throw new Error("无法从返回内容中解析出结构，请查看 Console 的 DEBUG 日志");
           }

           batchQuestions = validArr;
        } catch (parseErr: any) {
           console.error(`Batch ${batchIndex} Parse Error`, parseErr);
           throw new Error(`Batch ${batchIndex} generation failed: ${parseErr.message}`);
        }

        batchQuestions.forEach((q) => {
          const key = normalizeQuestionText(q.stem);
          if (!existingSet.has(key)) {
            existingSet.add(key);
            allQuestions.push(q);
          }
        });

        if (allQuestions.length >= totalCount) break;
      }

      setGenerationStage('postProcessing');

      if (allQuestions.length === 0) throw new Error("生成的题目与题库完全重复或生成失败！");

      // NEW: Enhance Questions with ID tags and construct title
      const genSyllabus = syllabusPresets.find(p => p.id === genSyllabusId);
      const genBook = genSyllabus?.books.find(b => b.id === genBookId);
      const genTopic = genBook?.topics.find(t => t.id === genTopicId);

      const enhancedQuestions = allQuestions.map(q => ({
        ...q,
        bookTitle: genBook ? genBook.title : q.bookTitle,
        chapterTitle: genTopic ? genTopic.title : q.chapterTitle,
        assignedBookId: genBook ? genBook.id : q.assignedBookId,
        assignedTopicId: genTopic ? genTopic.id : q.assignedTopicId,
      }));

      // const finalQuiz = shuffleArray(enhancedQuestions); // DISABLED SHUFFLE
      const finalQuiz = enhancedQuestions;
      
      let bankTitle = `第 ${history.length + 1} 套题`;
      if (genSyllabus && genBook) {
          const parts = [genSyllabus.name, genBook.title, genTopic?.title].filter(Boolean);
          bankTitle = `${parts.join(' - ')} (${new Date().toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})})`;
      }

      const newBank: QuizBank = {
        id: Date.now().toString(),
        title: bankTitle,
        createdAt: new Date().toISOString(),
        sourceFiles: uploadedFiles.map(f => f.name),
        questionCount: finalQuiz.length,
        questions: finalQuiz
      };

      setHistory(prev => [newBank, ...prev]);
      setChatMessages([]); 
      showToast("题目生成成功，已添加到题库列表", "success");

    } catch (err: any) {
      showToast(err.message);
    } finally {
      setLoading(false);
      setGenerationStage('idle');
      setCurrentBatchIndex(0);
      setTotalBatches(0);
      // 如果是后台生成题库，关闭生成进度弹窗
      setIsGeneratingInBank(false);
    }
  };

  const handleSelectOption = (letter: string) => {
    if (quizSettings.mode === 'review') return;
    const currentQ = quizData[currentQIndex];
    if (userAnswers[currentQ.id]) return; 

    const isMultiple = currentQ.type === 'multiple';
    if (isMultiple) {
      setTempSelection(prev => prev.includes(letter) ? prev.filter(l => l !== letter) : [...prev, letter].sort());
    } else {
      if (quizSettings.confirmSubmit) setTempSelection([letter]);
      else submitAnswer([letter]);
    }
  };

  const submitAnswer = (selected: string[]) => {
    if (quizSettings.mode === 'review') return;
    const currentQ = quizData[currentQIndex];
    if (selected.length === 0) return showToast("请至少选择一个选项", "error");

    const isCorrect = checkAnswerIsCorrect(currentQ, selected);
    // Updated structure for storing answers
    setUserAnswers(prev => ({ ...prev, [currentQ.id]: { answerIds: selected, isCorrect, selected } }));
    setTempSelection([]);

    if (!isCorrect) {
      setMistakes(prev => prev.find(m => m.id === currentQ.id) ? prev : [
        { id: currentQ.id as string, question: currentQ, userAnswer: selected, addedAt: new Date().toISOString() },
        ...prev
      ]);
    }

    if (quizSettings.mode === 'exam') {
      setTimeout(() => { if (currentQIndex < quizData.length - 1) { setCurrentQIndex(prev => prev + 1); setTempSelection([]); } }, 300); 
    } else if (quizSettings.mode === 'practice') {
      const shouldAutoNext = isCorrect ? quizSettings.autoNextCorrect : quizSettings.autoNextWrong;
      if (shouldAutoNext) {
        setTimeout(() => { if (currentQIndex < quizData.length - 1) { setCurrentQIndex(prev => prev + 1); setTempSelection([]); } }, 1500); 
      }
    }
  };

  const handleRetakeMistakes = () => {
    if (mistakes.length === 0) return showToast("没有错题可复习！", "success");
    startQuizWithResume({ sessionKey: 'mistakes-session', questions: prepareOrderedQuestions(mistakes.map(m => m.question)), title: '错题复习' });
  };

  const loadHistoryQuiz = (bank: QuizBank) => {
    startQuizWithResume({ sessionKey: buildBankSessionKey(bank.id), questions: prepareOrderedQuestions([...bank.questions]), title: bank.title });
  };

  const handleDeleteHistoryBank = (id: string) => {
    const nextHistory = history.filter(h => h.id !== id);
    setHistory(nextHistory);
    localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(nextHistory));
    showToast("题库已删除", "success");
    if(pendingDeleteBankId === id) setPendingDeleteBankId(null);
  };

  const handleSaveRename = () => {
     if(!editingBankId || !editingTitle.trim()) return;
     setHistory(prev => prev.map(b => b.id === editingBankId ? { ...b, title: editingTitle.trim() } : b));
     setEditingBankId(null);
     setEditingTitle("");
  };
  
  // 合并选中题库的逻辑
  const handleMergeSelectedBanks = () => {
    if (selectedBankIds.length < 2) return;
    
    // 获取选中的题库
    const selectedBanks = history.filter(bank => selectedBankIds.includes(bank.id));
    if (selectedBanks.length < 2) return;
    
    // 创建新的合并题库 - 保留所有题目，为每个题目和选项生成新的唯一ID
    const mergedQuestions = selectedBanks.flatMap(bank => bank.questions);
    
    // 为每个合并的题目和选项生成新的唯一ID，确保所有题目都被保留且无冲突
    const uniqueQuestions = mergedQuestions.map((question, questionIndex) => {
      // 为当前题目生成新ID
      const newQuestionId = `merged_${Date.now()}_${questionIndex}`;
      
      // 为每个选项生成新ID
      const newOptions = question.options.map((option, optionIndex) => ({
        ...option,
        id: `opt_${newQuestionId}_${optionIndex}` // 基于新题目ID生成选项ID
      }));
      
      // 更新answerIds以匹配新的选项ID
      // 我们需要根据选项的原始文本或其他标识来找到正确的选项
      const newAnswerIds = question.answerIds.map(oldAnswerId => {
        // 找到原始选项
        const originalOption = question.options.find(opt => opt.id === oldAnswerId);
        if (!originalOption) return '';
        
        // 找到新选项中对应的选项
        const newOption = newOptions.find(opt => opt.text === originalOption.text);
        return newOption ? newOption.id : '';
      }).filter(id => id !== ''); // 过滤掉找不到的选项
      
      return {
        ...question,
        id: newQuestionId,
        options: newOptions,
        answerIds: newAnswerIds
      };
    });
    
    // 创建合并后的新题库
    const newBank: QuizBank = {
      id: `bank_${Date.now()}`,
      title: `合并题库_${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      sourceFiles: Array.from(new Set(selectedBanks.flatMap(bank => bank.sourceFiles))),
      questionCount: uniqueQuestions.length,
      questions: uniqueQuestions
    };
    
    // 添加到任务队列
    const newTask: Task = {
      id: `task_${Date.now()}`,
      type: 'mergeBanks',
      title: `合并 ${selectedBanks.length} 个题库`,
      status: 'in_progress',
      progress: 50,
      banks: selectedBanks
    };
    
    setTaskQueue(prev => [...prev, newTask]);
    
    // 更新历史记录，移除旧题库并添加新题库
    setTimeout(() => {
      const updatedHistory = history.filter(bank => !selectedBankIds.includes(bank.id));
      setHistory([newBank, ...updatedHistory]);
      
      // 更新任务状态
      setTaskQueue(prev => prev.map(task => 
        task.id === newTask.id 
          ? { ...task, status: 'completed', progress: 100, result: newBank } 
          : task
      ));
      
      // 清空选择
      setSelectedBankIds([]);
    }, 1000);
  };

  // 处理文件上传生成题库
  const handleFileUploadForBank = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // 设置生成状态
    setIsGeneratingInBank(true);
    setLoading(true);
    setGenerationStage('解析文件');
    setCurrentBatchIndex(0);
    setTotalBatches(files.length);
    setUploadedFiles(files);

    try {
      // 调用generateQuiz生成题目
      await generateQuiz(true); // 传入addToBank参数
    } catch (error) {
      showToast((error as Error).message || '题目生成失败');
      setIsGeneratingInBank(false);
      setLoading(false);
    }
  };

  const startBookPractice = (bookName: string) => {
    const group = bookGroupsLegacy[bookName];
    if (!group || group.questionCount === 0) return;
    const questions = prepareOrderedQuestions([...group.questions]);
    startQuizWithResume({ sessionKey: `legacy-book:${bookName}`, questions, title: bookName });
  };

  const startTagPractice = (tagName: string) => {
    const group = tagGroups[tagName];
    if (!group || group.questionCount === 0) return;
    const questions = prepareOrderedQuestions([...group.questions]);
    startQuizWithResume({ sessionKey: `tag:${tagName}`, questions, title: tagName });
  };

  const finishQuiz = () => setScreen('result');

  const handleChatSend = async (userMsg: string) => {
    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setChatLoading(true);
    try {
      const currentQ = screen === 'quiz' ? quizData[currentQIndex] : null;
      let contextSystem = "You are a helpful AI Tutor. Explain things clearly in Chinese.";
      if (currentQ) {
        contextSystem += ` User is asking about: Q: ${currentQ.stem} Type: ${currentQ.type} Options: ${currentQ.options.map(o=>o.id+'.'+o.text).join(', ')} Correct Answer: ${currentQ.answerIds.join(', ')} Explanation: ${currentQ.analysis || currentQ.coreConcept}`;
      }
      let messages: ChatMessage[] = [];
      if (apiConfig.model.includes("reasoner")) {
        const historyText = chatMessages.map(m => `${m.role}: ${m.content}`).join("\n");
        messages = [{ role: "user", content: `${contextSystem}\n\nChat History:\n${historyText}\n\nUser: ${userMsg}` }];
      } else {
        messages = [{ role: "system", content: contextSystem }, ...chatMessages.map(m => ({role: m.role as any, content: m.content})), { role: "user", content: userMsg }];
      }
      const content = await callLLM(apiConfig, messages);
      setChatMessages(prev => [...prev, { role: "assistant", content }]);
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `出错: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleQuickAsk = (question: string) => {
    setIsChatOpen(true);
    handleChatSend(question);
  };

  const renderStepIcon = (step: GenerationStage, current: GenerationStage) => {
    const stages = ['idle', 'parsing', 'callingModel', 'postProcessing'];
    const stepIdx = stages.indexOf(step);
    const currentIdx = stages.indexOf(current);
    if (currentIdx > stepIdx) return <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>✔</span></div>;
    else if (currentIdx === stepIdx && current !== 'idle') return <div className="animate-spin" style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid #3b82f6', borderTopColor: 'transparent' }}></div>;
    else return <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#d1d5db' }}></div>;
  };

  const renderHome = () => (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px' }} className="fade-in-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '30px' }}>
        {isEditingTitle ? (
             <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input 
                  value={pendingTitle} 
                  onChange={(e) => setPendingTitle(e.target.value)}
                  style={{ fontSize: '24px', fontWeight: '800', padding: '4px', borderRadius: '4px', border: '1px solid ' + colors.primary + '', background: '#ffffff', color: '#1e293b', width: '300px' }}
                  autoFocus
                />
                <button onClick={handleSaveAppTitle} style={{ padding: '4px 8px', background: colors.successBg, color: colors.successText, border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>保存</button>
                <button onClick={() => setIsEditingTitle(false)} style={{ padding: '4px 8px', background: colors.disabled, color: colors.textSub, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>取消</button>
             </div>
        ) : (
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: colors.textMain, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {appTitle}
              <button onClick={handleRenameAppTitle} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px', color: colors.textSub }} title="修改标题">✎</button>
              <span style={{ fontSize: '12px', fontWeight: 'normal', color: colors.textSub, background: theme === 'dark' ? '#334155' : '#e2e8f0', padding: '2px 6px', borderRadius: '4px', marginLeft: '4px', verticalAlign: 'middle' }}>{APP_VERSION}</span>
            </h1>
        )}
        <button onClick={toggleTheme} style={{ background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer' }}>{theme === 'light' ? '🌙' : '☀️'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
        <button onClick={() => setScreen('mistakes')} style={{ padding: '20px', borderRadius: '12px', border: 'none', background: theme === 'dark' ? '#7f1d1d' : '#fee2e2', color: theme === 'dark' ? '#fecaca' : '#991b1b', cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{mistakes.length}</div>
          <div style={{ fontSize: '14px' }}>错题待复习</div>
        </button>
        <button onClick={() => setScreen('history')} style={{ padding: '20px', borderRadius: '12px', border: 'none', background: theme === 'dark' ? '#1e3a8a' : '#dbeafe', color: theme === 'dark' ? '#bfdbfe' : '#1e40af', cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{history.length}</div>
          <div style={{ fontSize: '14px' }}>题库</div>
        </button>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <button onClick={startFavoritePractice} style={{ width: '100%', padding: '20px', borderRadius: '12px', border: 'none', background: theme === 'dark' ? '#713f12' : '#fef9c3', color: theme === 'dark' ? '#fef08a' : '#854d0e', cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{favorites.length}</div>
          <div style={{ fontSize: '14px' }}>收藏题库 (开始刷题)</div>
        </button>
      </div>

      <div style={{ background: colors.surface, padding: '20px', borderRadius: '16px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', marginBottom: '20px', border: '1px solid ' + colors.border + '', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
         <div>
            <h3 style={{ margin: '0 0 5px 0', fontSize: '16px', fontWeight: 'bold', color: colors.textMain }}>📥 导入现成题库 (JSON)</h3>
            <p style={{ margin: 0, fontSize: '12px', color: colors.textSub }}>已有 JSON 格式题目？直接导入练习</p>
         </div>
         <div style={{ position: 'relative', overflow: 'hidden', display: 'inline-block' }}>
            <button style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: theme === 'dark' ? '#1e293b' : 'white', color: colors.textMain, cursor: 'pointer', fontWeight: '600' }} className="btn-touch">选择文件...</button>
            <input type="file" accept=".json" onChange={handleImportJsonQuiz} style={{ position: 'absolute', left: 0, top: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
         </div>
      </div>

      <div style={{ background: colors.surface, padding: '25px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', marginBottom: '20px', border: '1px solid ' + colors.border + '' }}>
        <h3 style={{ marginTop: 0, marginBottom: '20px', color: colors.textMain }}>⚙️ 出题配置</h3>
        
        <div style={{ marginBottom: '20px', padding: '15px', background: theme === 'dark' ? '#1e293b' : '#f1f5f9', borderRadius: '12px', border: '1px dashed ' + colors.border + '' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: colors.textSub }}>API 预设 (本地)</h4>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
             <select 
               onChange={(e) => {
                 const id = e.target.value;
                 if (id) handleApplyApiPreset(id);
               }} 
               value="" 
               style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '13px' }}
             >
               <option value="" disabled>-- 选择已保存的配置 --</option>
               {apiPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
             </select>
             <button 
               type="button"
               onClick={handleSaveCurrentApiPreset} 
               style={{ 
                 padding: '8px 12px', 
                 borderRadius: '6px', 
                 background: colors.primary, 
                 color: 'white', 
                 border: 'none', 
                 cursor: 'pointer', 
                 fontSize: '12px',
                 fontWeight: '600',
                 boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
               }}
               title="点击保存当前配置"
             >
               保存当前
             </button>
          </div>
          {apiPresets.length > 0 && (
             <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {apiPresets.map(p => (
                   <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: colors.surface, padding: '2px 6px', borderRadius: '4px', border: '1px solid ' + colors.border + '', color: colors.textSub }}>
                      {editingPresetId === p.id ? (
                          <>
                             <input 
                               value={pendingPresetName} 
                               onChange={(e) => setPendingPresetName(e.target.value)}
                               style={{ width: '80px', padding: '2px', border: '1px solid ' + colors.primary + '', borderRadius: '2px', fontSize: '11px' }}
                             />
                             <button onClick={() => handleSavePresetName(p.id)} style={{ border: 'none', background: 'transparent', color: colors.successText, cursor: 'pointer', fontWeight: 'bold' }}>✓</button>
                             <button onClick={() => setEditingPresetId(null)} style={{ border: 'none', background: 'transparent', color: colors.textSub, cursor: 'pointer' }}>✕</button>
                          </>
                      ) : (
                          <>
                              {p.name}
                              <button onClick={() => handleStartRenamePreset(p.id, p.name)} style={{ border: 'none', background: 'transparent', color: colors.primary, cursor: 'pointer', padding: '0 2px' }} title="重命名">✎</button>
                              <button onClick={() => handleDeleteApiPreset(p.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: 0 }} title="删除">×</button>
                          </>
                      )}
                   </span>
                ))}
             </div>
          )}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>模型预设</label>
          <select value={apiConfig.preset || 'custom'} onChange={(e) => handlePresetChange(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }}>
            {MODEL_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>接口协议类型</label>
          <select value={apiConfig.protocol} onChange={(e) => setApiConfig({...apiConfig, protocol: e.target.value as any})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }}>
            <option value="openai-compatible">OpenAI 兼容接口</option>
            <option value="gemini-native">Google Gemini 原生接口</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
          <div style={{ flex: 1 }}>
             <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>Base URL</label>
             <input type="text" value={apiConfig.baseUrl} placeholder={apiConfig.protocol === 'gemini-native' ? "https://generativelanguage.googleapis.com" : "https://api.example.com"} onChange={(e) => setApiConfig({...apiConfig, baseUrl: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }} />
          </div>
          <div style={{ flex: 1 }}>
             <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>模型名称</label>
             <input type="text" value={apiConfig.model} placeholder={apiConfig.protocol === 'gemini-native' ? "Google AI Studio 模型 ID" : "模型名称 (如 gpt-4o)"} onChange={(e) => setApiConfig({...apiConfig, model: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }} />
          </div>
        </div>
        {apiConfig.protocol === 'openai-compatible' && (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>自定义接口路径</label>
            <input type="text" value={apiConfig.customPath} onChange={(e) => setApiConfig({...apiConfig, customPath: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }} />
          </div>
        )}
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>API Key</label>
          <input type="password" value={apiConfig.apiKey} onChange={(e) => setApiConfig({...apiConfig, apiKey: e.target.value})} placeholder="sk-..." style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }} />
        </div>

        {/* NEW: Syllabus Context Selection */}
        <div style={{ marginBottom: '20px', padding: '15px', background: theme === 'dark' ? 'rgba(16, 185, 129, 0.1)' : '#ecfdf5', borderRadius: '12px', border: '1px dashed ' + colors.successBorder + '' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: theme === 'dark' ? '#34d399' : '#059669' }}>📝 生成题目归属 (可选)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <select
                    value={genSyllabusId || ''}
                    onChange={(e) => {
                        setGenSyllabusId(e.target.value || null);
                        setGenBookId(null);
                        setGenTopicId(null);
                    }}
                    style={{ padding: '8px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '13px' }}
                >
                    <option value="">-- 不指定大纲 --</option>
                    {syllabusPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>

                {genSyllabusId && (
                    <div style={{ display: 'flex', gap: '10px' }}>
                         <select
                            value={genBookId || ''}
                            onChange={(e) => {
                                setGenBookId(e.target.value || null);
                                setGenTopicId(null);
                            }}
                            style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '13px' }}
                        >
                            <option value="">-- 选择书本 --</option>
                            {syllabusPresets.find(p => p.id === genSyllabusId)?.books.map(b => (
                                <option key={b.id} value={b.id}>{b.title}</option>
                            ))}
                        </select>
                         <select
                            value={genTopicId || ''}
                            onChange={(e) => setGenTopicId(e.target.value || null)}
                            disabled={!genBookId}
                            style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '13px', opacity: genBookId ? 1 : 0.6 }}
                        >
                            <option value="">-- 选择章节/模块 --</option>
                            {genBookId && syllabusPresets.find(p => p.id === genSyllabusId)?.books.find(b => b.id === genBookId)?.topics.map((t) => {
                                // Recursively render nested topics
                                const renderNestedTopics = (topic: SyllabusTopic, level: number = 0) => {
                                    const indent = '  '.repeat(level);
                                    return (
                                        <React.Fragment key={topic.id}>
                                            <option value={topic.id}>{indent}{topic.title}</option>
                                            {topic.topics?.map((subTopic) => renderNestedTopics(subTopic, level + 1))}
                                        </React.Fragment>
                                    );
                                };
                                return renderNestedTopics(t);
                            })}
                        </select>
                    </div>
                )}
            </div>
        </div>

        <div style={{ marginBottom: '20px', padding: '15px', background: theme === 'dark' ? 'rgba(59, 130, 246, 0.1)' : '#eff6ff', borderRadius: '12px', border: '1px dashed ' + colors.primary + '' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: colors.primary }}>📚 考试大纲管理</h4>
            
            {/* New: Custom Name Input */}
            <input
                type="text"
                placeholder="在此输入新大纲名称（可选，如：2025 工艺美术史）"
                value={newSyllabusName}
                onChange={(e) => setNewSyllabusName(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '13px', marginBottom: '8px' }}
            />

            <textarea
                value={syllabusRawText}
                onChange={(e) => setSyllabusRawText(e.target.value)}
                placeholder="在此粘贴考试院校发布的考试大纲文本（需包含书名和章节标题），AI 将自动解析生成预设..."
                style={{ width: '100%', height: '80px', padding: '8px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '12px', marginBottom: '8px' }}
            />
            <button 
                onClick={handleGenerateSyllabusPresetFromText} 
                disabled={isProcessingSyllabus || !syllabusRawText.trim()}
                style={{ 
                    width: '100%', 
                    padding: '8px', 
                    borderRadius: '6px', 
                    background: isProcessingSyllabus ? colors.disabled : colors.primary, 
                    color: 'white', 
                    border: 'none', 
                    cursor: isProcessingSyllabus ? 'not-allowed' : 'pointer', 
                    fontSize: '12px',
                    fontWeight: 'bold'
                }}
            >
                {isProcessingSyllabus ? "正在解析大纲..." : "✨ 从文本生成大纲预设"}
            </button>

            {/* List for Renaming Syllabus Presets */}
            {syllabusPresets.length > 0 && (
                <div style={{ marginTop: '15px', borderTop: '1px solid ' + colors.border + '', paddingTop: '10px' }}>
                    <h5 style={{ margin: '0 0 8px 0', fontSize: '12px', color: colors.textSub }}>已保存的大纲:</h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {syllabusPresets.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: colors.textMain }}>
                                {editingSyllabusId === p.id ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                                        <input 
                                            autoFocus
                                            value={pendingSyllabusName}
                                            onChange={(e) => setPendingSyllabusName(e.target.value)}
                                            style={{ flex: 1, padding: '4px', borderRadius: '4px', border: '1px solid ' + colors.primary + '', background: colors.inputBg, fontSize: '13px' }}
                                        />
                                        <button onClick={() => handleSaveSyllabusPresetName(p.id)} style={{ padding: '2px 8px', borderRadius: '4px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px' }}>保存</button>
                                        <button onClick={() => setEditingSyllabusId(null)} style={{ padding: '2px 8px', borderRadius: '4px', background: colors.disabled, color: colors.textSub, border: 'none', cursor: 'pointer', fontSize: '12px' }}>取消</button>
                                    </div>
                                ) : (
                                    <>
                                        <span>{p.name}</span>
                                        <button onClick={() => handleStartRenameSyllabus(p.id, p.name)} style={{ background: 'transparent', border: 'none', color: colors.primary, cursor: 'pointer', fontSize: '12px' }}>重命名</button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>学习资料 (支持多选 PDF / Word / JSON)</label>
          <div style={{ position: 'relative', overflow: 'hidden', display: 'inline-block', width: '100%' }}>
            <button style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '2px dashed ' + colors.primary + '', background: theme === 'dark' ? 'rgba(59, 130, 246, 0.1)' : '#eff6ff', color: colors.primary, cursor: 'pointer', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} className="btn-touch">📂 批量上传文件 (已选 {uploadedFiles.length})</button>
            <input type="file" accept=".pdf,.docx,.json" multiple onChange={handleFileUpload} style={{ position: 'absolute', left: 0, top: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
          </div>
          {uploadedFiles.length > 0 && (
            <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {uploadedFiles.map((file, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: theme === 'dark' ? '#334155' : '#f3f4f6', borderRadius: '6px', fontSize: '13px', color: colors.textMain }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}><span style={{ fontSize: '16px' }}>📄</span><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{file.name}</span></div>
                  <button onClick={() => handleRemoveFile(idx)} style={{ background: 'transparent', border: 'none', color: colors.textSub, cursor: 'pointer', fontSize: '16px' }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
           <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>生成题型</label>
              <select value={settings.questionMode} onChange={(e) => setSettings({...settings, questionMode: e.target.value as any})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }}>
                <option value="single-only">仅单选题</option>
                <option value="multiple-only">仅多选题</option>
                <option value="mixed">混合模式</option>
              </select>
           </div>
           <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>题目数量: {settings.numQuestions}</label>
              <input type="number" min="5" max="200" step="5" value={settings.numQuestions} onChange={(e) => setSettings({...settings, numQuestions: parseInt(e.target.value)})} style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }} />
           </div>
        </div>
        <div style={{ marginBottom: '25px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '5px', color: colors.textSub }}>每批生成题量 (建议 8-15)</label>
          <input type="number" min="5" max="30" step="1" value={batchSize} onChange={(e) => saveBatchSize(parseInt(e.target.value))} style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }} />
          <p style={{ fontSize: '12px', color: colors.textSub, marginTop: '5px' }}>建议单批 8–15 题。当前总题量 {settings.numQuestions} 题，大约分为 {Math.ceil(settings.numQuestions / batchSize)} 批调用。</p>
        </div>
        <button onClick={async () => { setIsGeneratingInBank(true); await generateQuiz(true); }} disabled={loading || uploadedFiles.length === 0} style={{ width: '100%', padding: '12px', borderRadius: '8px', fontWeight: '600', fontSize: '16px', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', transition: 'background 0.3s', cursor: (loading || uploadedFiles.length === 0) ? 'not-allowed' : 'pointer', backgroundColor: (loading || uploadedFiles.length === 0) ? colors.disabled : colors.primary, color: (loading || uploadedFiles.length === 0) ? colors.textSub : 'white' }}>{loading ? "生成中..." : "✨ 生成试卷"}</button>
      </div>

      <div style={{ background: theme === 'dark' ? '#1e293b' : '#f9fafb', padding: '20px', borderRadius: '16px', border: '1px solid ' + colors.border + '', marginBottom: '40px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '16px', fontWeight: 'bold', color: colors.textMain, display: 'flex', alignItems: 'center', gap: '8px' }}>🛠️ 刷题设置</h3>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: colors.textMain, marginBottom: '8px' }}>答题模式</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {['practice', 'exam', 'review'].map(m => (
              <button key={m} onClick={() => setQuizSettings({...quizSettings, mode: m as any})} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid ' + quizSettings.mode === m ? colors.primary : colors.border + '', background: quizSettings.mode === m ? (theme === 'dark' ? '#1e3a8a' : '#eff6ff') : colors.surface, color: quizSettings.mode === m ? colors.primary : colors.textSub, fontWeight: '600', cursor: 'pointer' }}>{m === 'practice' ? '📝 练习模式' : m === 'exam' ? '🎓 模拟考试' : '📖 背题模式'}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: colors.textMain, marginBottom: '8px' }}>生成速度模式</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => saveSpeedMode('quality')} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid ' + speedMode === 'quality' ? colors.primary : colors.border + '', background: speedMode === 'quality' ? (theme === 'dark' ? '#1e3a8a' : '#eff6ff') : colors.surface, color: speedMode === 'quality' ? colors.primary : colors.textSub, fontWeight: '600', cursor: 'pointer' }}>⭐ 质量优先</button>
            <button onClick={() => saveSpeedMode('fast')} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid ' + speedMode === 'fast' ? colors.primary : colors.border + '', background: speedMode === 'fast' ? (theme === 'dark' ? '#1e3a8a' : '#eff6ff') : colors.surface, color: speedMode === 'fast' ? colors.primary : colors.textSub, fontWeight: '600', cursor: 'pointer' }}>⚡ 速度优先</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', opacity: quizSettings.mode === 'review' ? 0.4 : 1, pointerEvents: quizSettings.mode === 'review' ? 'none' : 'auto' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: colors.textMain, cursor: 'pointer' }}><input type="checkbox" checked={quizSettings.confirmSubmit} onChange={(e) => setQuizSettings({...quizSettings, confirmSubmit: e.target.checked})} style={{ width: '16px', height: '16px' }} /> 需确认提交</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: colors.textMain, cursor: 'pointer' }}><input type="checkbox" checked={quizSettings.showNavButtons} onChange={(e) => setQuizSettings({...quizSettings, showNavButtons: e.target.checked})} style={{ width: '16px', height: '16px' }} /> 显示翻页按钮</label>
          {quizSettings.mode === 'practice' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: colors.textMain, cursor: 'pointer' }}><input type="checkbox" checked={quizSettings.autoNextCorrect} onChange={(e) => setQuizSettings({...quizSettings, autoNextCorrect: e.target.checked})} style={{ width: '16px', height: '16px' }} /> 答对自动下一题</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: colors.textMain, cursor: 'pointer' }}><input type="checkbox" checked={quizSettings.showExplanationCorrect} onChange={(e) => setQuizSettings({...quizSettings, showExplanationCorrect: e.target.checked})} style={{ width: '16px', height: '16px' }} /> 答对显示解析</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: colors.textMain, cursor: 'pointer' }}><input type="checkbox" checked={quizSettings.autoNextWrong} onChange={(e) => setQuizSettings({...quizSettings, autoNextWrong: e.target.checked})} style={{ width: '16px', height: '16px' }} /> 答错自动下一题</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: colors.textMain, cursor: 'pointer' }}><input type="checkbox" checked={quizSettings.showExplanationWrong} onChange={(e) => setQuizSettings({...quizSettings, showExplanationWrong: e.target.checked})} style={{ width: '16px', height: '16px' }} /> ❌ 答错显示解析</label>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const renderQuiz = () => {
    const question = quizData[currentQIndex];
    if (!question) return null;

    const stats = currentQuizStats;

    const userAnswer = userAnswers[question.id];
    const isAnswered = !!userAnswer;
    const isPractice = quizSettings.mode === 'practice';
    const isReview = quizSettings.mode === 'review';
    const isLastQuestion = currentQIndex === quizData.length - 1;
    const isMultiple = question.type === 'multiple';
    const showFeedback = (isPractice && isAnswered) || isReview;
    const showExplanation = isReview || (showFeedback && ((userAnswer?.isCorrect && quizSettings.showExplanationCorrect) || (!userAnswer?.isCorrect && quizSettings.showExplanationWrong)));
    const suggestedQuestions = showExplanation ? buildSuggestedTutorQuestions(question) : [];
    
    const isFav = isQuestionFavorited(question);
    const meta = questionMetaMap[question.id] || { id: question.id };
    
    const selectedSyllabus = syllabusPresets.find(p => p.id === selectedSyllabusId);
    
    // 获取当前题目的自动分类结果
    const autoMapping = selectedSyllabus ? mapQuestionToSyllabus(question, selectedSyllabus, questionMetaMap) : null;
    
    // 使用手动分类（如果存在），否则使用自动分类
    const currentAssignedBookId = meta.assignedBookId || autoMapping?.bookId || '';
    const currentAssignedTopicId = meta.assignedTopicId || autoMapping?.topicId || '';
    const currentBookTopics = selectedSyllabus?.books.find(b => b.id === currentAssignedBookId)?.topics || [];

    // 答题卡弹窗状态已移至组件顶层
    
    // 答题卡组件
    const renderAnswerSheet = () => {
      return (
        <div style={{ 
          background: colors.surface, 
          padding: '15px', 
          borderRadius: '12px', 
          border: '1px solid ' + colors.border + '',
          maxHeight: '400px',
          overflowY: 'auto'
        }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: colors.textSub }}>📋 答题卡</h4>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', 
            gap: '8px'
          }}>
            {quizData.map((q, index) => {
              const answer = userAnswers[q.id];
              let bgColor = theme === 'dark' ? '#1e293b' : '#f3f4f6';
              let borderColor = colors.border;
              let textColor = colors.textMain;
              let badge = '';
              
              if (answer) {
                if (answer.isCorrect) {
                  bgColor = colors.successBg;
                  borderColor = colors.successBorder;
                  textColor = colors.successText;
                  badge = '✓';
                } else {
                  bgColor = colors.errorBg;
                  borderColor = colors.errorBorder;
                  textColor = colors.errorText;
                  badge = '✕';
                }
              } else if (index === currentQIndex) {
                bgColor = theme === 'dark' ? '#1e3a8a' : '#dbeafe';
                borderColor = colors.primary;
                textColor = theme === 'dark' ? '#bfdbfe' : '#1e40af';
              }
              
              return (
                <button
                  key={q.id}
                  onClick={() => {
                    setCurrentQIndex(index);
                    setTempSelection([]);
                    setShowAnswerSheetModal(false);
                  }}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    border: '2px solid ' + borderColor + '',
                    background: bgColor,
                    color: textColor,
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  {index + 1}
                  {badge && (
                    <span style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: 'white',
                      background: answer?.isCorrect ? colors.successBorder : colors.errorBorder,
                      borderRadius: '50%',
                      width: '16px',
                      height: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      );
    };
    
    // 答题卡弹窗组件
    const renderAnswerSheetModal = () => {
      if (!showAnswerSheetModal) return null;
      
      return (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            background: colors.surface,
            borderRadius: '16px',
            padding: '20px',
            maxWidth: '600px',
            width: '100%',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
            border: '1px solid ' + colors.border + ''
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: colors.textMain }}>📋 题目切换</h3>
              <button
                onClick={() => setShowAnswerSheetModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  color: colors.textSub,
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
            {renderAnswerSheet()}
            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowAnswerSheetModal(false)}
                style={{
                  background: colors.primary,
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      );
    };

    // Jump to Question State (moved to App component level)

    const handleJumpToQuestion = () => {
        const trimmed = jumpInput.trim();
        const total = quizData.length;
        const value = Number.parseInt(trimmed, 10);
        if (!trimmed || Number.isNaN(value) || value < 1 || value > total) {
            setJumpError(`请输入 1 到 ${total} 之间的整数`);
            return;
        }
        setJumpError('');
        setCurrentQIndex(value - 1);
        setJumpInput('');
    };

    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', paddingBottom: '100px' }}>
        {/* Progress prompt removed from here, now handled via modal before entering */}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px' }}>🏠</button>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: colors.textSub }}>题目 {currentQIndex + 1} / {quizData.length}</div>
          <div style={{ display: 'flex', gap: '10px' }}>
             {!confirmClearProgress ? (
                 <button onClick={() => setConfirmClearProgress(true)} style={{ color: colors.textSub, background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>重置进度</button>
             ) : (
                 <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                     <span style={{ fontSize: '12px', color: colors.textSub }}>确认重置?</span>
                     <button onClick={handleClearCurrentProgress} style={{ fontSize: '12px', padding: '2px 6px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>是</button>
                     <button onClick={() => setConfirmClearProgress(false)} style={{ fontSize: '12px', padding: '2px 6px', background: colors.disabled, color: colors.textMain, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>否</button>
                 </div>
             )}
             <button onClick={() => setScreen('result')} style={{ color: colors.primary, background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>{isReview ? "结束背题" : (isPractice ? "结束练习" : "交卷")}</button>
          </div>
        </div>
        <div style={{ height: '6px', background: theme === 'dark' ? '#334155' : '#e2e8f0', borderRadius: '3px', marginBottom: '30px' }}>
          <div style={{ height: '100%', width: '' + ((currentQIndex + 1) / quizData.length) * 100 + '%', background: colors.primary, borderRadius: '3px', transition: 'width 0.3s' }} />
        </div>

        {/* 答题卡按钮 */}
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setShowAnswerSheetModal(true)}
            style={{
              background: colors.primary,
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            📋 切换题目 ({currentQIndex + 1} / {quizData.length})
          </button>
        </div>

        {/* 渲染答题卡弹窗 */}
        {renderAnswerSheetModal()}
        <div style={{ background: colors.surface, padding: '30px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', marginBottom: '20px', border: '1px solid ' + colors.border + '' }} className="card-touch fade-in-up">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', background: isMultiple ? (theme === 'dark' ? '#78350f' : '#fef3c7') : (theme === 'dark' ? '#1e3a8a' : '#dbeafe'), color: isMultiple ? '#fbbf24' : '#60a5fa' }}>{isMultiple ? '多选题' : '单选题'}</span>
              {question.sourceDocument && <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', background: theme === 'dark' ? '#334155' : '#f1f5f9', color: colors.textSub }}>📄 {question.sourceDocument}</span>}
            </div>
            <button onClick={() => toggleFavorite(question)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '24px', color: isFav ? '#eab308' : colors.textSub }}>{isFav ? '★' : '☆'}</button>
          </div>
          
          <h2 style={{ marginTop: 0, fontSize: '20px', lineHeight: '1.6', color: colors.textMain }}>{question.stem}</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
            {question.options.map((opt, idx) => {
              const letter = indexToLetter(idx); // Use visual index for consistency if ID logic differs
              let bgColor = theme === 'dark' ? '#1e293b' : '#f3f4f6';
              let textColor = colors.textMain;
              let borderColor = 'transparent';
              let badge = letter; // 显示字母而不是选项ID
              let badgeBg = 'rgba(0,0,0,0.1)';
              let badgeColor = colors.textMain;

              const isSelected = isAnswered 
                ? (userAnswer.answerIds || userAnswer.selected).includes(opt.id) // Support new/old field
                : tempSelection.includes(opt.id);
              
              const isCorrectOption = question.answerIds.includes(opt.id);

              if (showFeedback) {
                if (isCorrectOption) {
                  bgColor = colors.successBg; textColor = colors.successText; borderColor = colors.successBorder; badge = '✓'; badgeBg = colors.successBorder; badgeColor = 'white';
                } else if (!isReview && isSelected && !userAnswer.isCorrect) {
                  bgColor = colors.errorBg; textColor = colors.errorText; borderColor = colors.errorBorder; badge = '✕'; badgeBg = colors.errorBorder; badgeColor = 'white';
                } else if (!isReview && isSelected && userAnswer.isCorrect) { 
                   bgColor = colors.successBg; textColor = colors.successText; borderColor = colors.successBorder;
                }
              } else {
                if (isSelected) { bgColor = theme === 'dark' ? '#172554' : '#eff6ff'; textColor = theme === 'dark' ? '#93c5fd' : '#1e3a8a'; borderColor = colors.primary; }
              }

              return (
                <button key={opt.id} onClick={() => handleSelectOption(opt.id)} disabled={isAnswered || isReview} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '16px', background: bgColor, color: textColor, border: '2px solid ' + borderColor + '', borderRadius: '12px', cursor: (isAnswered || isReview) ? 'default' : 'pointer', fontSize: '16px', textAlign: 'left', transition: 'all 0.2s', opacity: isReview && !isCorrectOption ? 0.6 : 1 }}>
                  <span style={{ width: '28px', height: '28px', borderRadius: isMultiple ? '4px' : '50%', background: badgeBg, color: badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '14px', flexShrink: 0 }}>{badge}</span>
                  <span>{opt.text}</span>
                </button>
              );
            })}
          </div>
          {!isReview && !isAnswered && ((isMultiple || quizSettings.confirmSubmit) && tempSelection.length > 0 && (
            <button onClick={() => submitAnswer(tempSelection)} style={{ width: '100%', marginTop: '20px', padding: '14px', background: colors.primary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>{isMultiple ? `确认提交 (已选 ${tempSelection.length} 项)` : "确认提交"}</button>
          ))}
        </div>

        {showExplanation && (
          <div style={{ animation: 'fadeIn 0.5s', background: theme === 'dark' ? '#1e3a8a' : '#eff6ff', borderLeft: '5px solid ' + colors.primary + '', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 10px 0', color: colors.primary }}>💡 正确答案: {question.answerIds.map(id => {
              const idx = question.options.findIndex(opt => opt.id === id);
              return idx >= 0 ? indexToLetter(idx) : id;
            }).join('、')}</h4>
            {renderFormattedExplanation(question, theme)}
            <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
               <button onClick={() => setIsChatOpen(true)} style={{ background: colors.surface, color: colors.primary, border: '1px solid ' + colors.primary + '', padding: '8px 16px', borderRadius: '20px', cursor: 'pointer', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>🤖 问问 AI</button>
               {suggestedQuestions.length > 0 && (
                 <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>
                   {suggestedQuestions.map((sq, i) => (
                     <button key={i} onClick={() => handleQuickAsk(sq)} style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '16px', background: theme === 'dark' ? '#1e3a8a' : '#dbeafe', color: theme === 'dark' ? '#bfdbfe' : '#1e40af', border: 'none', cursor: 'pointer', textAlign: 'left', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                       {sq.length > 20 ? sq.slice(0, 20) + '...' : sq}
                     </button>
                   ))}
                 </div>
               )}
            </div>
          </div>
        )}

        {selectedSyllabus && (
            <div style={{ marginBottom: '20px', padding: '12px', background: theme === 'dark' ? '#1e293b' : '#f8fafc', borderRadius: '8px', fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', border: '1px dashed ' + colors.border + '' }}>
               <span style={{ color: colors.textSub, fontWeight: 'bold' }}>📁 归类修正:</span>
               <select 
                 value={currentAssignedBookId || ''} 
                 onChange={(e) => updateQuestionMeta(question.id.toString(), m => ({...m, assignedBookId: e.target.value, assignedTopicId: 'other' }))}
                 style={{ padding: '6px', borderRadius: '4px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, maxWidth: '200px' }}
               >
                 <option value="">-- 未归类 (自动匹配) --</option>
                 {selectedSyllabus.books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
               </select>
               {currentAssignedBookId && (
                 <select 
                   value={currentAssignedTopicId || 'other'}
                   onChange={(e) => updateQuestionMeta(question.id.toString(), m => ({...m, assignedTopicId: e.target.value}))}
                   style={{ padding: '6px', borderRadius: '4px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, maxWidth: '200px' }}
                 >
                   <option value="other">其他 / 未分类</option>
                   {currentBookTopics.map((t) => {
                       // Recursively render nested topics
                       const renderNestedTopics = (topic: SyllabusTopic, level: number = 0) => {
                           const indent = '  '.repeat(level);
                           return (
                               <React.Fragment key={topic.id}>
                                   <option value={topic.id}>{indent}{topic.title}</option>
                                   {topic.topics?.map((subTopic) => renderNestedTopics(subTopic, level + 1))}
                               </React.Fragment>
                           );
                       };
                       return renderNestedTopics(t);
                   })}
                 </select>
               )}
            </div>
        )}

        <div style={{ background: theme === 'dark' ? '#1e293b' : '#f9fafb', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px dashed ' + colors.border + '' }}>
           <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: colors.textSub }}>🏷️ 标签管理</h4>
           
           <div style={{ marginBottom: '10px' }}>
             <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px', color: colors.textSub }}>预设标签 (点击添加)</label>
             <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {tagPresets.map(p => (
                  <span key={p.id} style={{ fontSize: '12px', background: theme === 'dark' ? '#1e3a8a' : '#dbeafe', color: theme === 'dark' ? '#bfdbfe' : '#1e40af', padding: '4px 8px', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} 
                    onClick={() => {
                      updateQuestionMeta(question.id.toString(), m => {
                        const tags = m.tags || [];
                        if (tags.includes(p.name)) return m;
                        return { ...m, tags: [...tags, p.name] };
                      });
                    }}
                  >
                    {p.name}
                    <button onClick={(e) => { e.stopPropagation(); handleRemovePreset(p.id); }} style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: '10px', marginLeft: '2px', cursor: 'pointer' }}>×</button>
                  </span>
                ))}
             </div>
             <div style={{ display: 'flex', gap: '8px' }}>
                <input ref={presetTagInput} type="text" placeholder="新增预设..." style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '12px' }} />
                <button onClick={handleAddPreset} style={{ padding: '4px 10px', borderRadius: '6px', background: colors.surface, border: '1px solid ' + colors.border + '', color: colors.textMain, fontSize: '12px', cursor: 'pointer' }}>添加预设</button>
                <button onClick={restoreDefaultTagPresets} style={{ padding: '4px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: colors.textSub, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>恢复默认</button>
             </div>
           </div>

           <div>
             <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px', color: colors.textSub }}>本题标签</label>
             <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
               {(!meta.tags || meta.tags.length === 0) && <span style={{ fontSize: '12px', color: colors.textSub }}>暂无标签</span>}
               {meta.tags?.map(t => (
                 <span key={t} style={{ fontSize: '12px', background: theme === 'dark' ? '#374151' : '#e5e7eb', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: colors.textMain }}>
                   {t}
                   <button 
                     onClick={() => updateQuestionMeta(question.id.toString(), m => ({ ...m, tags: m.tags?.filter(x => x !== t) }))}
                     style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: colors.textSub, padding: 0, fontSize: '14px', lineHeight: 1 }}
                   >×</button>
                 </span>
               ))}
             </div>
             <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
               <input 
                 ref={currentTagInput}
                 type="text" 
                 placeholder="手动输入标签..." 
                 style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain, fontSize: '13px' }}
               />
               <button 
                 onClick={() => {
                   const val = currentTagInput.current?.value.trim();
                   if (!val) return;
                   updateQuestionMeta(question.id.toString(), m => {
                     const tags = m.tags || [];
                     if (tags.includes(val)) return m;
                     return { ...m, tags: [...tags, val] };
                   });
                   if(currentTagInput.current) currentTagInput.current.value = '';
                 }} 
                 style={{ padding: '6px 12px', borderRadius: '6px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px' }}
               >
                 添加
               </button>
             </div>
           </div>
        </div>
        
        {stats && (
          <div style={{ marginTop: '30px', background: colors.surface, borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid ' + colors.border + '' }}>
            <button onClick={() => setShowStats(!showStats)} style={{ width: '100%', padding: '15px 20px', background: theme === 'dark' ? '#1e293b' : '#f9fafb', border: 'none', borderBottom: showStats ? '1px solid ' + colors.border + '' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
               <span style={{ fontWeight: 'bold', color: colors.textMain }}>📊 书本/来源分布统计</span>
               <span style={{ fontSize: '12px', color: colors.textSub }}>{showStats ? '收起' : '展开'}</span>
            </button>
            {showStats && (
              <div style={{ padding: '20px' }}>
                {Object.entries(stats.byBook).map(([book, count]) => {
                   const total = quizData.length;
                   const percent = Math.round((count / total) * 100);
                   return (
                     <div key={book} style={{ marginTop: '10px' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: colors.textSub, marginBottom: '4px' }}>
                         <span title={book} style={{ maxWidth: '70%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book}</span>
                         <span>{count} 题 · {percent}%</span>
                       </div>
                       <div style={{ width: '100%', height: '6px', background: theme === 'dark' ? '#334155' : '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                         <div style={{ width: '' + percent + '%', height: '100%', background: colors.primary, borderRadius: '3px' }} />
                       </div>
                     </div>
                   );
                })}
              </div>
            )}
          </div>
        )}

        {(quizSettings.showNavButtons || isReview) && (
          <div className="quiz-nav-bar">
            {/* 答题时间显示 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
                <span style={{ fontSize: '12px', color: colors.textSub }}>答题时间:</span>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: colors.primary }}>{formatTime(quizTime)}</span>
            </div>

            <button disabled={currentQIndex === 0} onClick={() => { setCurrentQIndex(prev => prev - 1); setTempSelection([]); }} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: currentQIndex === 0 ? (theme === 'dark' ? '#1e293b' : '#f3f4f6') : colors.surface, color: currentQIndex === 0 ? colors.textSub : colors.textSub, cursor: currentQIndex === 0 ? 'not-allowed' : 'pointer' }}>← 上一题</button>
            <button onClick={() => { if (isLastQuestion) finishQuiz(); else { setCurrentQIndex(prev => prev + 1); setTempSelection([]); } }} style={{ marginLeft: '10px', padding: '10px 20px', borderRadius: '8px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer' }}>{isLastQuestion ? (isReview ? "结束背题" : "📊 查看结果") : "下一题 →"}</button>
          </div>
        )}
      </div>
    );
  };

  const renderMistakes = () => (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: colors.textMain }}>📕 错题本</h1>
        <button onClick={() => setScreen('home')} style={{ background: theme === 'dark' ? '#334155' : '#e5e7eb', border: 'none', color: colors.textMain, padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>返回</button>
      </div>

      <div style={{ display: 'flex', marginBottom: '20px', background: colors.surface, borderRadius: '8px', padding: '4px', border: '1px solid ' + colors.border + '' }}>
        <button onClick={() => setMistakeViewMode('mistakes')} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: 'none', background: mistakeViewMode === 'mistakes' ? colors.primary : 'transparent', color: mistakeViewMode === 'mistakes' ? 'white' : colors.textSub, cursor: 'pointer', fontWeight: 'bold' }}>错题集 ({mistakes.length})</button>
        <button onClick={() => setMistakeViewMode('trash')} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: 'none', background: mistakeViewMode === 'trash' ? colors.primary : 'transparent', color: mistakeViewMode === 'trash' ? 'white' : colors.textSub, cursor: 'pointer', fontWeight: 'bold' }}>垃圾篓 ({mistakeTrash.length})</button>
      </div>

      {mistakeViewMode === 'mistakes' ? (
        <>
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
             <button onClick={() => setShowClearMistakesDialog(true)} style={{ background: colors.surface, border: '1px solid #ef4444', color: '#ef4444', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' }}>🗑 清空错题本</button>
             <button onClick={handleRetakeMistakes} style={{ background: colors.primary, border: 'none', color: 'white', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>🔄 重刷错题</button>
          </div>
          {mistakes.length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: colors.textSub }}>暂无错题。</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {mistakes.map((m, i) => (
                <div key={i} style={{ background: colors.surface, padding: '20px', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid ' + colors.border + '' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                       <span style={{ fontSize: '12px', padding: '2px 6px', background: theme === 'dark' ? '#334155' : '#e5e7eb', borderRadius: '4px', height: 'fit-content', color: colors.textSub }}>{m.question.type === 'multiple' ? '多选' : '单选'}</span>
                       <h3 style={{ marginTop: 0, color: colors.textMain }}>{m.question.stem}</h3>
                    </div>
                    <button onClick={() => moveMistakeToTrash(m)} style={{ color: colors.textSub, border: 'none', background: 'transparent', cursor: 'pointer' }}>×</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', marginBottom: '15px' }}>
                    {m.question.options.map((opt, idx) => {
                      const letter = indexToLetter(idx);
                      const isCorrect = m.question.answerIds.includes(opt.id);
                      return (
                        <div key={idx} style={{ padding: '8px 12px', borderRadius: '6px', background: isCorrect ? colors.successBg : (theme === 'dark' ? '#1e293b' : '#f9fafb'), color: isCorrect ? colors.successText : colors.textSub, border: isCorrect ? '1px solid ' + colors.successBorder + '' : '1px solid transparent', display: 'flex', gap: '8px', fontSize: '14px', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold', minWidth: '20px' }}>{letter}.</span>
                          <span>{opt.text}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ background: theme === 'dark' ? '#1e3a8a' : '#f0f9ff', padding: '15px', borderRadius: '8px' }}>
                    {renderFormattedExplanation(m.question, theme)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
             <button 
               onClick={handleRestoreAllTrash} 
               disabled={mistakeTrash.length === 0}
               style={{ 
                 background: colors.surface, 
                 border: '1px solid ' + mistakeTrash.length === 0 ? colors.disabled : colors.primary + '', 
                 color: mistakeTrash.length === 0 ? colors.disabled : colors.primary, 
                 padding: '10px 20px', 
                 borderRadius: '8px', 
                 cursor: mistakeTrash.length === 0 ? 'not-allowed' : 'pointer', 
                 fontWeight: 'bold' 
               }}
             >
               ♻️ 恢复所有
             </button>
             <button onClick={() => setShowClearTrashDialog(true)} style={{ background: colors.surface, border: '1px solid #ef4444', color: '#ef4444', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' }}>🗑 清空垃圾篓</button>
          </div>
          {mistakeTrash.length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: colors.textSub }}>垃圾篓是空的。</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {mistakeTrash.map((m, i) => (
                <div key={i} style={{ background: colors.surface, padding: '20px', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid ' + colors.border + '', opacity: 0.7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ fontSize: '12px', color: colors.textSub }}>删除时间: {new Date(m.removedAt).toLocaleString()}</div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={() => restoreMistakeFromTrash(m)} style={{ fontSize: '12px', color: colors.primary, background: 'transparent', border: 'none', cursor: 'pointer' }}>恢复</button>
                      <button onClick={() => permanentlyDeleteFromTrash(m)} style={{ fontSize: '12px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}>彻底删除</button>
                    </div>
                  </div>
                  <h3 style={{ marginTop: 0, color: colors.textMain, fontSize: '16px' }}>{m.question.stem}</h3>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderHistory = () => {
    // --- History: Group by Syllabus Book (Req 1.2) ---
    const selectedSyllabus = syllabusPresets.find(p => p.id === selectedSyllabusId);

    return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: colors.textMain }}>📜 题库</h1>
        <button onClick={() => setScreen('home')} style={{ background: theme === 'dark' ? '#334155' : '#e5e7eb', border: 'none', color: colors.textMain, padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>返回</button>
      </div>
      
      <div style={{ display: 'flex', marginBottom: '20px', background: colors.surface, borderRadius: '8px', padding: '4px', border: '1px solid ' + colors.border + '', overflowX: 'auto' }}>
        <button onClick={() => setHistoryViewMode('byBank')} style={{ flex: 1, minWidth: '80px', padding: '8px', borderRadius: '6px', border: 'none', background: historyViewMode === 'byBank' ? colors.primary : 'transparent', color: historyViewMode === 'byBank' ? 'white' : colors.textSub, cursor: 'pointer', fontWeight: 'bold' }}>按题库刷题</button>
        <button onClick={() => setHistoryViewMode('byBook')} style={{ flex: 1, minWidth: '80px', padding: '8px', borderRadius: '6px', border: 'none', background: historyViewMode === 'byBook' ? colors.primary : 'transparent', color: historyViewMode === 'byBook' ? 'white' : colors.textSub, cursor: 'pointer', fontWeight: 'bold' }}>按书本刷题</button>
        <button onClick={() => setHistoryViewMode('byTag')} style={{ flex: 1, minWidth: '80px', padding: '8px', borderRadius: '6px', border: 'none', background: historyViewMode === 'byTag' ? colors.primary : 'transparent', color: historyViewMode === 'byTag' ? 'white' : colors.textSub, cursor: 'pointer', fontWeight: 'bold' }}>按标签刷题</button>
      </div>

      {/* 生成新题库按钮 */}
      {/* 上传文件生成题库功能已移除 */}

      {/* 后台生成题目进度弹窗已移除，改为在按题库刷题页面显示生成卡片 */}

      {historyViewMode === 'byBank' ? (
        <>
          {/* 合并按钮和选择模式 */}
          {history.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {!isSelectMode ? (
                  <button 
                    onClick={() => setIsSelectMode(true)}
                    style={{ 
                      padding: '8px 16px', 
                      borderRadius: '12px', 
                      background: colors.primary, 
                      color: 'white', 
                      border: 'none', 
                      cursor: 'pointer', 
                      fontSize: '14px', 
                      fontWeight: 'bold'
                    }}
                  >
                    选择题库
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={() => {
                        setIsSelectMode(false);
                        setSelectedBankIds([]);
                      }}
                      style={{ 
                        padding: '8px 16px', 
                        borderRadius: '12px', 
                        background: colors.primary, 
                        color: 'white', 
                        border: 'none', 
                        cursor: 'pointer', 
                        fontSize: '14px', 
                        fontWeight: 'bold'
                      }}
                    >
                      取消选择
                    </button>
                    <button 
                      onClick={() => {
                        if (selectedBankIds.length === history.length) {
                          setSelectedBankIds([]);
                        } else {
                          setSelectedBankIds(history.map(bank => bank.id));
                        }
                      }}
                      style={{ 
                        padding: '8px 16px', 
                        borderRadius: '12px', 
                        background: selectedBankIds.length === history.length ? colors.inputBg : colors.primary, 
                        color: selectedBankIds.length === history.length ? colors.textMain : 'white', 
                        border: '1px solid ' + colors.border + '', 
                        cursor: 'pointer', 
                        fontSize: '14px', 
                        fontWeight: 'bold'
                      }}
                    >
                      {selectedBankIds.length === history.length ? '取消全选' : '全选'}
                    </button>
                    <span style={{ fontSize: '14px', color: colors.textSub }}>
                      已选择: {selectedBankIds.length}/{history.length}
                    </span>
                  </>
                )}
              </div>
              {selectedBankIds.length >= 2 && (
                <button 
                  onClick={handleMergeSelectedBanks}
                  style={{ 
                    padding: '8px 16px', 
                    borderRadius: '6px', 
                    background: colors.primary, 
                    color: 'white', 
                    border: 'none', 
                    cursor: 'pointer', 
                    fontWeight: 'bold',
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'center'
                  }}
                >
                  📦 合并选中题库
                </button>
              )}
            </div>
          )}
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {/* 正在生成的卡片 */}
            {isGeneratingInBank && (
              <div style={{ background: colors.surface, padding: '20px', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid ' + colors.primary + '' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
                    <h3 style={{ margin: 0, color: colors.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ⏳ 正在生成题目
                    </h3>
                  </div>
                  
                  {/* 生成阶段显示 */}
                  <div style={{ marginBottom: '15px' }}>
                    <div style={{ fontSize: '14px', color: colors.textSub, marginBottom: '8px' }}>当前阶段：</div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {['parsing', 'callingModel', 'postProcessing'].map((stage, idx) => (
                        <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {renderStepIcon(stage as any, generationStage)}
                          <span style={{ 
                            fontSize: '12px', 
                            color: generationStage === stage ? colors.primary : colors.textSub,
                            fontWeight: generationStage === stage ? 'bold' : 'normal'
                          }}>
                            {stage === 'parsing' ? '解析资料' : stage === 'callingModel' ? '生成题目' : '后处理'}
                          </span>
                          {idx < 2 && <span style={{ color: colors.border }}>→</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 批量进度显示 */}
                  {totalBatches > 0 && (
                    <div style={{ marginBottom: '15px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px' }}>
                        <span style={{ color: colors.textMain }}>批量进度</span>
                        <span style={{ color: colors.primary, fontWeight: 'bold' }}>
                          {currentBatchIndex}/{totalBatches}
                        </span>
                      </div>
                      <div style={{ 
                        height: '8px', background: colors.border, borderRadius: '4px', overflow: 'hidden'
                      }}>
                        <div 
                          style={{ 
                            height: '100%', 
                            width: `${(currentBatchIndex / totalBatches) * 100}%`, 
                            background: colors.primary,
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 取消按钮 */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button 
                      onClick={() => setIsGeneratingInBank(false)}
                      style={{ 
                        padding: '6px 12px', 
                        borderRadius: '6px', 
                        background: colors.disabled, 
                        color: colors.textMain, 
                        border: 'none', 
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      取消生成
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {/* 任务队列 */}
            {taskQueue.some(task => task.status === 'pending' || task.status === 'in_progress') && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '10px', color: colors.textMain }}>任务队列</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {taskQueue
                    .filter(task => task.status === 'pending' || task.status === 'in_progress')
                    .map(task => (
                    <div 
                      key={task.id} 
                      style={{ 
                        background: colors.surface, 
                        padding: '15px', 
                        borderRadius: '12px', 
                        border: '1px solid ' + colors.border + '',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '20px' }}>
                            {task.type === 'mergeBanks' ? '📦' : '⏳'}
                          </span>
                          <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{task.title}</span>
                        </div>
                        <span style={{ 
                          fontSize: '12px', 
                          padding: '4px 8px', 
                          borderRadius: '12px', 
                          backgroundColor: 
                            task.status === 'completed' ? colors.successLight : 
                            task.status === 'in_progress' ? colors.primaryLight : 
                            colors.textSubLight,
                          color: 
                            task.status === 'completed' ? colors.success : 
                            task.status === 'in_progress' ? colors.primary : 
                            colors.textSub
                        }}>
                          {task.status === 'completed' ? '已完成' : task.status === 'in_progress' ? '进行中' : '等待中'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                          <span>进度</span>
                          <span>{task.progress}%</span>
                        </div>
                        <div style={{ height: '6px', background: colors.border, borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ 
                            height: '100%', 
                            background: task.status === 'completed' ? colors.success : colors.primary, 
                            width: `${task.progress}%`, 
                            transition: 'width 0.3s ease'
                          }}></div>
                        </div>
                      </div>
                      {task.result && task.type === 'mergeBanks' && (
                        <div style={{ textAlign: 'right' }}>
                          <button 
                            onClick={() => {
                              // 可以在这里添加查看合并结果的功能
                            }}
                            style={{ 
                              padding: '4px 8px', 
                              borderRadius: '4px', 
                              background: colors.primary, 
                              color: 'white', 
                              border: 'none', 
                              cursor: 'pointer', 
                              fontSize: '12px'
                            }}
                          >
                            查看结果
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {history.length === 0 && !isGeneratingInBank && (
              <div style={{ textAlign: 'center', padding: '40px', color: colors.textSub }}>暂无历史生成记录。</div>
            )}
            
            {history.map((bank) => {
                // Calculate progress for each bank
                const sessionKey = buildBankSessionKey(bank.id);
                const stored = progressMap[sessionKey];
                const total = bank.questions.length;
                const answered = stored ? Math.min(stored.answeredCount, total) : 0;
                const correct = stored ? Math.min(stored.correctCount, answered) : 0;
                const ratio = total > 0 ? answered / total : 0;
                const accuracy = answered > 0 ? correct / answered : null;

                return (
                <div key={bank.id} style={{ background: colors.surface, padding: '20px', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid ' + (isSelectMode && selectedBankIds.includes(bank.id) ? colors.primary : colors.border) + '', opacity: isSelectMode && selectedBankIds.includes(bank.id) ? 0.9 : 1 }}>
                  {/* 选择复选框 - 仅在选择模式下显示 */}
                  {isSelectMode && (
                    <div style={{ marginRight: '15px', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedBankIds.includes(bank.id)} 
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBankIds([...selectedBankIds, bank.id]);
                          } else {
                            setSelectedBankIds(selectedBankIds.filter(id => id !== bank.id));
                          }
                        }}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    {editingBankId === bank.id ? (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '5px' }}>
                        <input autoFocus value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid ' + colors.border + '', background: colors.inputBg, color: colors.textMain }} />
                        <button onClick={handleSaveRename} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer' }}>保存</button>
                        <button onClick={() => setEditingBankId(null)} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: colors.disabled, color: colors.textSub, border: 'none', cursor: 'pointer' }}>取消</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                        <h3 style={{ margin: 0, color: colors.textMain }}>{bank.title}</h3>
                        <button onClick={() => { setEditingBankId(bank.id); setEditingTitle(bank.title); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', color: colors.textSub }}>✎</button>
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: colors.textSub }}>
                      {new Date(bank.createdAt).toLocaleString()} · {bank.questionCount} 题
                      {bank.sourceFiles && bank.sourceFiles.length > 0 && <span> · 来源: {bank.sourceFiles.join(', ')}</span>}
                    </div>
                    {/* NEW: Progress Bar for Bank */}
                    <div className="mt-1 space-y-1" style={{ marginTop: '8px', maxWidth: '300px' }}>
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden" style={{ height: '6px', background: theme === 'dark' ? '#334155' : '#e2e8f0', borderRadius: '3px' }}>
                        <div
                          className="h-full bg-blue-500 transition-all"
                          style={{ width: '' + ratio * 100 + '%', height: '100%', background: colors.primary, borderRadius: '3px' }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: colors.textSub }}>
                        <span>进度：{answered}/{total} 题</span>
                        {accuracy != null && (
                          <span>最近正确率：{Math.round(accuracy * 100)}%</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                     <button onClick={() => exportQuizBankToJson(bank)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid ' + colors.border + '', background: colors.surface, color: colors.textSub, cursor: 'pointer' }}>导出 JSON</button>
                     
                     {pendingDeleteBankId === bank.id ? (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', color: '#ef4444' }}>确认?</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteHistoryBank(bank.id); }} style={{ padding: '6px 10px', borderRadius: '4px', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px' }}>是</button>
                            <button onClick={(e) => { e.stopPropagation(); setPendingDeleteBankId(null); }} style={{ padding: '6px 10px', borderRadius: '4px', background: colors.disabled, color: colors.textMain, border: 'none', cursor: 'pointer', fontSize: '12px' }}>否</button>
                        </div>
                     ) : (
                        <button onClick={(e) => { e.stopPropagation(); setPendingDeleteBankId(bank.id); }} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ef4444', background: colors.surface, color: '#ef4444', cursor: 'pointer' }}>删除</button>
                     )}
                     
                     <button onClick={() => loadHistoryQuiz(bank)} style={{ padding: '8px 16px', borderRadius: '6px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>开始练习</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : historyViewMode === 'byBook' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {selectedSyllabusId && selectedSyllabus ? (
             <>
               <div style={{ fontSize: '12px', color: colors.textSub, marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                   <div>当前大纲: <strong>{selectedSyllabus.name}</strong></div>
                   <button 
                       onClick={handleStartWholeSyllabusQuiz} 
                       style={{ padding: '6px 12px', borderRadius: '6px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                   >
                       📚 整套大纲刷题
                   </button>
               </div>
               
               {/* 1. Render Grouped Books */}
               {selectedSyllabus.books.map(book => {
                   const bookData = groupedBySyllabus?.grouped[book.id];
                   if (!bookData && !groupedBySyllabus) return null; // Should not happen if data loaded

                   // Calculate total count (topics + others)
                   let totalCount = bookData?.otherQuestions.length || 0;
                   if (bookData?.topics) {
                       Object.values(bookData.topics).forEach(t => totalCount += t.questions.length);
                   }

                   if (totalCount === 0) return null; // Hide empty books

                   const isExpanded = expandedBooks[book.id];
                   
                   // Stats Calculation
                   const sessionKey = buildBookSessionKey(selectedSyllabus.id, book.id);
                   const stored = progressMap[sessionKey];
                   const answered = stored ? Math.min(stored.answeredCount, totalCount) : 0;
                   const correct = stored ? Math.min(stored.correctCount, answered) : 0;
                   const ratio = totalCount > 0 ? answered / totalCount : 0;
                   const accuracy = answered > 0 ? correct / answered : null;

                   return (
                       <div key={book.id} style={{ background: colors.surface, borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid ' + colors.border + '', overflow: 'hidden' }}>
                           <div 
                               onClick={() => setExpandedBooks(prev => ({...prev, [book.id]: !prev[book.id]}))}
                               style={{ padding: '15px', background: theme === 'dark' ? '#1e293b' : '#f8fafc', borderBottom: isExpanded ? '1px solid ' + colors.border + '' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                           >
                               <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                   <span style={{ fontSize: '12px', color: colors.textSub }}>{isExpanded ? '▼' : '▶'}</span>
                                   <div style={{ flex: 1 }}>
                                       <h3 style={{ margin: 0, fontSize: '16px', color: colors.textMain }}>{book.title}</h3>
                                       {/* Progress Bar & Stats */}
                                       <div style={{ marginTop: '6px', width: '100%', maxWidth: '300px' }}>
                                           <div style={{ height: '6px', width: '100%', background: theme === 'dark' ? '#334155' : '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                               <div style={{ height: '100%', width: '' + ratio * 100 + '%', background: colors.primary, borderRadius: '3px', transition: 'width 0.3s' }} />
                                           </div>
                                           <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: colors.textSub, marginTop: '4px' }}>
                                               <span>已做 {answered}/{totalCount} 题</span>
                                               {accuracy !== null && <span>正确率: {Math.round(accuracy * 100)}%</span>}
                                           </div>
                                       </div>
                                   </div>
                               </div>
                               {/* 刷整本书按钮移到卡片标题栏 */}
                               <button onClick={() => {
                                    const questions = [];
                                    Object.values(bookData.topics).forEach(t => questions.push(...t.questions));
                                    questions.push(...bookData.otherQuestions);
                                    startQuizWithResume({ sessionKey: buildBookSessionKey(selectedSyllabus.id, book.id), questions: prepareOrderedQuestions(questions), title: book.title });
                               }} style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '6px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer' }}>刷整本书</button>
                           </div>
                           
                           {isExpanded && bookData && (
                               <div style={{ padding: '10px 15px' }}>

                                   {/* Render Topics (Recursive) */}
                                   {(() => {
                                       const renderTopics = (topics: SyllabusTopic[], level: number = 1) => {
                                           return topics.map(topic => {
                                               const topicData = bookData.topics[topic.id];
                                               if (!topicData || topicData.questions.length === 0) {
                                                   // Only render parent topics if they have subtopics with questions
                                                   if (topic.topics && topic.topics.length > 0) {
                                                       const hasQuestionsInSubtopics = topic.topics.some(subtopic => {
                                                           const subtopicData = bookData.topics[subtopic.id];
                                                           return subtopicData && subtopicData.questions.length > 0;
                                                       });
                                                       if (hasQuestionsInSubtopics) {
                                                           return (
                                                               <div key={topic.id}>
                                                                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed ' + colors.border + '' }}>
                                                                       <div style={{ paddingLeft: `${20 + (level - 1) * 20}px`, fontWeight: 'bold' }}>
                                                                           <span style={{ fontSize: '14px', color: colors.textMain }}>{topic.title}</span>
                                                                       </div>
                                                                   </div>
                                                                   {renderTopics(topic.topics!, level + 1)}
                                                               </div>
                                                           );
                                                       }
                                                   }
                                                   return null;
                                               }
                                               return (
                                                   <div key={topic.id}>
                                                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed ' + colors.border + '' }}>
                                                           <div style={{ paddingLeft: `${20 + (level - 1) * 20}px` }}>
                                                               <span style={{ fontSize: '14px', color: colors.textMain }}>{topic.title}</span>
                                                               <span style={{ marginLeft: '8px', fontSize: '12px', color: colors.textSub }}>({topicData.questions.length} 题)</span>
                                                           </div>
                                                           <button onClick={() => startQuizWithResume({ sessionKey: buildTopicSessionKey(selectedSyllabus.id, book.id, topic.id), questions: prepareOrderedQuestions(topicData.questions), title: topic.title })} style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', background: colors.surface, border: '1px solid ' + colors.primary + '', color: colors.primary, cursor: 'pointer' }}>刷题</button>
                                                       </div>
                                                       {topic.topics && topic.topics.length > 0 && renderTopics(topic.topics, level + 1)}
                                                   </div>
                                               );
                                           });
                                       };
                                       return renderTopics(book.topics);
                                   })()}
                                   {/* Render Other Questions in this Book */}
                                   {bookData.otherQuestions.length > 0 && (
                                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed ' + colors.border + '' }}>
                                            <div style={{ paddingLeft: '20px' }}>
                                                <span style={{ fontSize: '14px', color: colors.textMain, fontStyle: 'italic' }}>其他 / 未归类章节</span>
                                                <span style={{ marginLeft: '8px', fontSize: '12px', color: colors.textSub }}>({bookData.otherQuestions.length} 题)</span>
                                            </div>
                                            <button onClick={() => startQuizWithResume({ sessionKey: buildTopicSessionKey(selectedSyllabus.id, book.id, 'other'), questions: prepareOrderedQuestions(bookData.otherQuestions), title: '未归类章节' })} style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', background: colors.surface, border: '1px solid ' + colors.primary + '', color: colors.primary, cursor: 'pointer' }}>刷题</button>
                                       </div>
                                   )}
                               </div>
                           )}
                       </div>
                   );
               })}

               {/* 2. Render Totally Unmatched Questions */}
               {groupedBySyllabus?.unmatched && groupedBySyllabus.unmatched.length > 0 && (
                   <div style={{ background: colors.surface, borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid ' + colors.border + '', overflow: 'hidden', marginTop: '10px' }}>
                       <div style={{ padding: '15px', background: theme === 'dark' ? '#2d3748' : '#edf2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <h3 style={{ margin: 0, fontSize: '15px', color: colors.textSub }}>⚠️ 未匹配到大纲的题目</h3>
                           <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                               <span style={{ fontSize: '12px', color: colors.textSub }}>{groupedBySyllabus.unmatched.length} 题</span>
                               {/* New: Intelligent Auto Classify Button */}
                               <button 
                                 onClick={() => handleAutoClassifyUnmatched(groupedBySyllabus.unmatched)}
                                 disabled={isAutoClassifying}
                                 style={{ 
                                   fontSize: '12px', 
                                   padding: '4px 12px', 
                                   borderRadius: '6px', 
                                   background: isAutoClassifying ? colors.disabled : colors.primary, 
                                   color: 'white', 
                                   border: 'none', 
                                   cursor: isAutoClassifying ? 'not-allowed' : 'pointer',
                                   display: 'flex',
                                   alignItems: 'center',
                                   gap: '4px'
                                 }}
                               >
                                 {isAutoClassifying ? (
                                   <>
                                     <span className="animate-spin" style={{ width: '10px', height: '10px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
                                     归类中...
                                   </>
                                 ) : '⚡ 智能归类未匹配题目'}
                               </button>
                               <button onClick={() => startQuizWithResume({ sessionKey: `legacy-unmatched:${selectedSyllabus.id}`, questions: prepareOrderedQuestions(groupedBySyllabus.unmatched), title: '未匹配题目' })} style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', background: colors.disabled, color: colors.textMain, border: 'none', cursor: 'pointer' }}>刷题</button>
                           </div>
                       </div>
                   </div>
               )}
             </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: colors.textSub, background: colors.surface, borderRadius: '12px', border: '1px dashed ' + colors.border + '' }}>
                <p>当前无可用考试大纲，无法进行按书本归类。</p>
                <p style={{fontSize: '12px'}}>请先在上方「出题配置 考试大纲管理」中生成或选择一个大纲。</p>
                {history.length > 0 && <p style={{fontSize: '12px', marginTop: '10px'}}>题库共有 {history.reduce((a,b) => a + b.questionCount, 0)} 道题目可用。</p>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {Object.keys(tagGroups).length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: colors.textSub }}>暂无标签数据，请在刷题时添加标签。</div> : 
            Object.entries(tagGroups).sort((a,b) => b[1].questionCount - a[1].questionCount).map(([tagName, group]) => (
              <div key={tagName} style={{background: colors.surface, padding: '15px', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid ' + colors.border}}>
                <div>
                  <h3 style={{ margin: '0 0 5px 0', fontSize: '16px', color: colors.textMain }}>🏷️ {tagName}</h3>
                  <div style={{ fontSize: '12px', color: colors.textSub }}>共 {group.questionCount} 题</div>
                </div>
                <button onClick={() => startTagPractice(tagName)} style={{ padding: '8px 16px', borderRadius: '6px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>开始刷本标签</button>
              </div>
            ))
          }
        </div>
      )}
    </div>
    );
  };

  const renderResult = () => {
    const correctCount = Object.values(userAnswers).filter(a => a.isCorrect).length;
    const score = Math.round((correctCount / quizData.length) * 100);
    return (
      <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '10px' }}>{score >= 90 ? "🏆" : score >= 60 ? "🎉" : "💪"}</h1>
        <h2 style={{ color: colors.textMain, marginBottom: '20px' }}>考试结束</h2>
        <div style={{ background: colors.surface, padding: '30px', borderRadius: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', marginBottom: '30px', border: '1px solid ' + colors.border + '' }}>
          <div style={{ fontSize: '48px', fontWeight: '800', color: colors.primary, marginBottom: '10px' }}>{score} <span style={{fontSize: '20px', color: colors.textSub}}>分</span></div>
          <p style={{ color: colors.textSub }}>答对 {correctCount} / {quizData.length} 题</p>
        </div>
        <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
          <button onClick={() => setScreen('home')} style={{ padding: '12px 24px', borderRadius: '10px', background: theme === 'dark' ? '#334155' : '#f3f4f6', color: colors.textMain, border: 'none', fontSize: '16px', cursor: 'pointer' }}>返回首页</button>
          <button onClick={() => setScreen('mistakes')} style={{ padding: '12px 24px', borderRadius: '10px', background: theme === 'dark' ? '#7f1d1d' : '#fee2e2', color: theme === 'dark' ? '#fecaca' : '#991b1b', border: 'none', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold' }}>查看错题</button>
        </div>
      </div>
    );
  };

  return (
    <>
      <ResponsiveStyles theme={theme} />
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      {/* Resume Dialog Modal */}
      {resumeDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div style={{ width: '90%', maxWidth: '350px', backgroundColor: colors.surface, padding: '24px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 'bold', color: colors.textMain }}>
              {resumeDialog.title ? `继续: ${resumeDialog.title}` : '继续上次进度？'}
            </h3>
            <div style={{ fontSize: '14px', color: colors.textSub, marginBottom: '20px', lineHeight: '1.5' }}>
              检测到上次的刷题记录 (已做 {resumeDialog.stored?.answeredCount}/{resumeDialog.questions.length})，是否从之前的题号 ({ (resumeDialog.stored?.currentIndex || 0) + 1 }) 继续？
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={handleResumeRestart} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: 'transparent', color: colors.textMain, cursor: 'pointer', fontSize: '13px' }}>从头开始</button>
              <button onClick={handleResumeConfirm} style={{ padding: '8px 16px', borderRadius: '8px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>继续</button>
            </div>
          </div>
        </div>
      )}

      {showClearMistakesDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div style={{ width: '90%', maxWidth: '400px', backgroundColor: colors.surface, padding: '24px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold', color: colors.textMain }}>确认清空错题本？</h3>
            <p style={{ fontSize: '14px', color: colors.textSub, lineHeight: '1.5', marginBottom: '20px' }}>本操作会把当前错题本中的所有题目移入垃圾篓，但不会立即永久删除。您仍可以在垃圾篓中恢复或彻底删除。</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowClearMistakesDialog(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: 'transparent', color: colors.textMain, cursor: 'pointer' }}>取消</button>
              <button onClick={confirmClearMistakes} style={{ padding: '8px 16px', borderRadius: '8px', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer' }}>确认清空</button>
            </div>
          </div>
        </div>
      )}

      {showClearTrashDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div style={{ width: '90%', maxWidth: '400px', backgroundColor: colors.surface, padding: '24px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold', color: colors.textMain }}>确认清空垃圾篓？</h3>
            <p style={{ fontSize: '14px', color: colors.textSub, lineHeight: '1.5', marginBottom: '20px' }}>本操作会永久删除垃圾篓中的所有题目记录，且不可恢复。</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowClearTrashDialog(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid ' + colors.border + '', background: 'transparent', color: colors.textMain, cursor: 'pointer' }}>取消</button>
              <button onClick={confirmClearTrash} style={{ padding: '8px 16px', borderRadius: '8px', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer' }}>确认清空</button>
            </div>
          </div>
        </div>
      )}

      {isGenerating && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div style={{ width: '90%', maxWidth: '400px', backgroundColor: colors.surface, padding: '24px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold', color: colors.textMain, textAlign: 'center' }}>正在生成试卷</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: colors.textMain }}>
                {renderStepIcon('parsing', generationStage)}
                <span>1. 解析学习资料</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: colors.textMain }}>
                  {renderStepIcon('callingModel', generationStage)}
                  <span>2. 调用大模型生成题库</span>
                </div>
                {generationStage === 'callingModel' && totalBatches > 1 && (
                  <div style={{ fontSize: '12px', color: colors.primary, paddingLeft: '32px' }}>
                    正在生成第 {currentBatchIndex} 批（共 {totalBatches} 批）
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: colors.textMain }}>
                {renderStepIcon('postProcessing', generationStage)}
                <span>3. 解析题目并保存</span>
              </div>
            </div>
            <p style={{ margin: '24px 0 0 0', fontSize: '12px', color: colors.textSub, textAlign: 'center' }}>请不要关闭页面，生成完成后将自动跳转。</p>
          </div>
        </div>
      )}

      {(screen === 'quiz' || screen === 'result') && (
        <button className="ai-fab" onClick={() => setIsChatOpen(true)}>🤖</button>
      )}
      <ChatSidebar isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} messages={chatMessages} onSend={handleChatSend} isLoading={chatLoading} currentContext={screen === 'quiz' ? quizData[currentQIndex] : null} theme={theme} />
      {screen === 'home' && renderHome()}
      {screen === 'quiz' && renderQuiz()}
      {screen === 'mistakes' && renderMistakes()}
      {screen === 'history' && renderHistory()}
      {screen === 'result' && renderResult()}
    </>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);