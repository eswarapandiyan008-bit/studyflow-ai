import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, bookmarksTable, documentsTable, notesTable } from "@workspace/db";
import {
  AskAssistantBody,
  AskAssistantResponse,
  CreateBookmarkBody,
  CreateBookmarkResponse,
  CreateDocumentBody,
  CreateDocumentResponse,
  CreateNoteBody,
  CreateNoteResponse,
  GetAnalyticsResponse,
  GetBookmarksResponse,
  GetDashboardResponse,
  GetDocumentsResponse,
  GetNotesResponse,
  UpdateDocumentBody,
  UpdateDocumentParams,
  UpdateDocumentResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const colors = ["blue", "violet", "amber", "rose", "emerald", "sky"];

function toDocument(document: typeof documentsTable.$inferSelect) {
  return {
    id: document.id,
    filename: document.filename,
    currentPage: document.currentPage,
    totalPages: document.totalPages,
    progress: Math.round((document.currentPage / document.totalPages) * 100),
    lastStudiedAt: document.lastStudiedAt.toISOString(),
    color: document.color,
  };
}

async function ensureSeedData(): Promise<void> {
  const existing = await db.select().from(documentsTable).limit(1);
  if (existing.length > 0) return;

  const seeded = await db
    .insert(documentsTable)
    .values([
      { filename: "DSA.pdf", currentPage: 82, totalPages: 100, color: "blue" },
      { filename: "Operating Systems.pdf", currentPage: 51, totalPages: 100, color: "violet" },
      { filename: "Machine Learning.pdf", currentPage: 35, totalPages: 100, color: "amber" },
      { filename: "Computer Networks.pdf", currentPage: 21, totalPages: 100, color: "rose" },
    ])
    .returning();

  await db.insert(notesTable).values([
    { documentId: seeded[0].id, page: 82, content: "Remember this concept for the exam.", type: "text" },
    { documentId: seeded[1].id, page: 34, content: "Compare paging and segmentation before the revision session.", type: "text" },
    { documentId: seeded[2].id, page: 18, content: "Review the intuition behind gradient descent.", type: "text" },
  ]);

  await db.insert(bookmarksTable).values([
    { documentId: seeded[0].id, page: 82, title: "Binary search intuition", category: "Exam" },
    { documentId: seeded[1].id, page: 34, title: "Virtual memory overview", category: "Important" },
    { documentId: seeded[2].id, page: 18, title: "Gradient descent", category: "Revise" },
  ]);
}

async function getDocuments() {
  const documents = await db.select().from(documentsTable).orderBy(desc(documentsTable.lastStudiedAt));
  return documents.map(toDocument);
}

async function getNotes() {
  const [notes, documents] = await Promise.all([
    db.select().from(notesTable).orderBy(desc(notesTable.createdAt)),
    db.select().from(documentsTable),
  ]);
  const documentNames = new Map(documents.map((document) => [document.id, document.filename]));
  return notes.map((note) => ({
    id: note.id,
    documentId: note.documentId,
    documentName: documentNames.get(note.documentId) ?? "Study document",
    page: note.page,
    content: note.content,
    type: note.type as "text" | "image" | "audio",
    createdAt: note.createdAt.toISOString(),
  }));
}

async function getBookmarks() {
  const [bookmarks, documents] = await Promise.all([
    db.select().from(bookmarksTable).orderBy(desc(bookmarksTable.id)),
    db.select().from(documentsTable),
  ]);
  const documentNames = new Map(documents.map((document) => [document.id, document.filename]));
  return bookmarks.map((bookmark) => ({
    id: bookmark.id,
    documentId: bookmark.documentId,
    documentName: documentNames.get(bookmark.documentId) ?? "Study document",
    page: bookmark.page,
    title: bookmark.title,
    category: bookmark.category as "Important" | "Exam" | "Doubt" | "Revise",
  }));
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const [documents, notes, bookmarks] = await Promise.all([getDocuments(), getNotes(), getBookmarks()]);
  const recent = documents[0] ?? null;
  const response = {
    documents,
    notes,
    bookmarks,
    stats: {
      pagesRead: documents.reduce((total, document) => total + document.currentPage, 0),
      studyTime: "2h 40m",
      documentsStudied: documents.filter((document) => document.currentPage > 1).length,
      notesCreated: notes.length,
    },
    recommendation: recent
      ? {
          documentId: recent.id,
          title: `Continue ${recent.filename.replace(".pdf", "")}`,
          reason: `You are already ${recent.progress}% through this document and recently studied it.`,
        }
      : { documentId: 0, title: "Upload your first document", reason: "Your next study session starts here." },
    recentActivity: [
      { id: 1, label: "Page progress saved", detail: `${recent?.filename ?? "Your document"} · page ${recent?.currentPage ?? 1}`, time: "Just now" },
      { id: 2, label: "Note created", detail: `${notes[0]?.documentName ?? "Study document"} · page ${notes[0]?.page ?? 1}`, time: "Today" },
      { id: 3, label: "Bookmark added", detail: `${bookmarks[0]?.title ?? "Important concept"}`, time: "Yesterday" },
    ],
  };
  res.json(GetDashboardResponse.parse(response));
});

router.get("/documents", async (_req, res): Promise<void> => {
  await ensureSeedData();
  res.json(GetDocumentsResponse.parse(await getDocuments()));
});

router.post("/documents", async (req, res): Promise<void> => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [document] = await db.insert(documentsTable).values({
    filename: parsed.data.filename,
    totalPages: parsed.data.totalPages,
    currentPage: 1,
    color: colors[(parsed.data.filename.length + parsed.data.totalPages) % colors.length],
  }).returning();
  res.status(201).json(CreateDocumentResponse.parse(toDocument(document)));
});

router.patch("/documents/:id", async (req, res): Promise<void> => {
  const params = UpdateDocumentParams.safeParse(req.params);
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [document] = await db.update(documentsTable)
    .set({
      ...(parsed.data.currentPage !== undefined ? { currentPage: parsed.data.currentPage } : {}),
      lastStudiedAt: parsed.data.lastStudiedAt ? new Date(parsed.data.lastStudiedAt) : new Date(),
    })
    .where(eq(documentsTable.id, params.data.id))
    .returning();
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(UpdateDocumentResponse.parse(toDocument(document)));
});

router.get("/notes", async (_req, res): Promise<void> => {
  await ensureSeedData();
  res.json(GetNotesResponse.parse(await getNotes()));
});

router.post("/notes", async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [note] = await db.insert(notesTable).values(parsed.data).returning();
  const [document] = await db.select().from(documentsTable).where(eq(documentsTable.id, note.documentId));
  res.status(201).json(CreateNoteResponse.parse({
    ...note,
    documentName: document?.filename ?? "Study document",
    type: note.type as "text" | "image" | "audio",
    createdAt: note.createdAt.toISOString(),
  }));
});

router.get("/bookmarks", async (_req, res): Promise<void> => {
  await ensureSeedData();
  res.json(GetBookmarksResponse.parse(await getBookmarks()));
});

router.post("/bookmarks", async (req, res): Promise<void> => {
  const parsed = CreateBookmarkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [bookmark] = await db.insert(bookmarksTable).values(parsed.data).returning();
  const [document] = await db.select().from(documentsTable).where(eq(documentsTable.id, bookmark.documentId));
  res.status(201).json(CreateBookmarkResponse.parse({
    ...bookmark,
    documentName: document?.filename ?? "Study document",
    category: bookmark.category as "Important" | "Exam" | "Doubt" | "Revise",
  }));
});

router.get("/analytics", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const [documents, notes] = await Promise.all([getDocuments(), getNotes()]);
  res.json(GetAnalyticsResponse.parse({
    weekly: [
      { day: "Mon", minutes: 42, pages: 18 },
      { day: "Tue", minutes: 28, pages: 12 },
      { day: "Wed", minutes: 54, pages: 27 },
      { day: "Thu", minutes: 35, pages: 16 },
      { day: "Fri", minutes: 48, pages: 22 },
      { day: "Sat", minutes: 32, pages: 14 },
      { day: "Sun", minutes: 41, pages: 19 },
    ],
    totals: {
      pagesRead: documents.reduce((total, document) => total + document.currentPage, 0),
      documentsStudied: documents.length,
      notesCreated: notes.length,
    },
    streak: 6,
    weeklyGoal: 300,
  }));
});

router.post("/assistant/messages", async (req, res): Promise<void> => {
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const message = parsed.data.message.toLowerCase();
  let content = "Think of this as a small idea you can test: break the concept into its inputs, its repeatable steps, and the result each step produces.";
  if (message.includes("revision") || message.includes("question")) {
    content = "Here are 5 revision questions:\\n\\n1. What problem does this concept solve?\\n2. Can you explain the core steps without looking at your notes?\\n3. What is the time and space complexity?\\n4. Which edge case would break a naive implementation?\\n5. How would you explain it to a beginner?";
  } else if (message.includes("binary search")) {
    content = "Binary search finds an item in a sorted list by repeatedly checking the middle. If the middle value is too small, keep the right half; if it is too large, keep the left half. Each step removes half the remaining options, so it runs in O(log n) time.";
  } else if (message.includes("complexity") || message.includes("time")) {
    content = "The key idea is how much work remains after each step. If the search space is cut in half, the time complexity is O(log n). If every item may be visited once, it is O(n). If each item is compared with every other item, it becomes O(n²).";
  } else if (message.includes("summar")) {
    content = `Summary for ${parsed.data.documentName ?? "this study session"}: focus on the definition, the mechanism that makes the idea work, and one concrete example. Then write a one-sentence explanation in your own words.`;
  } else if (message.includes("beginner") || message.includes("simple")) {
    content = "Imagine you are sorting a pile of cards. Instead of checking every card, you keep picking the middle card and throwing away the half that cannot contain your answer. That is the beginner-friendly intuition.";
  }
  res.json(AskAssistantResponse.parse({
    id: Date.now(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  }));
});

export default router;