import { api } from "./base";

export type NoteContext =
  | "general"
  | "security"
  | "watchlist"
  | "news"
  | "holding"
  | "transaction";

export interface Note {
  id: string;
  symbol: string | null;
  context: NoteContext;
  ref_id: string | null;
  title: string;
  body: string;
  tags: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface NoteCreate {
  body: string;
  symbol?: string | null;
  context?: NoteContext;
  ref_id?: string | null;
  title?: string;
  tags?: string[];
}

export interface NoteUpdate {
  body?: string;
  title?: string;
  tags?: string[];
}

export async function listNotes(params?: { symbol?: string; context?: NoteContext }): Promise<Note[]> {
  const { data } = await api.get<Note[]>("/notes", { params });
  return data;
}

export async function createNote(payload: NoteCreate): Promise<Note> {
  const { data } = await api.post<Note>("/notes", payload);
  return data;
}

export async function updateNote(id: string, payload: NoteUpdate): Promise<Note> {
  const { data } = await api.put<Note>(`/notes/${id}`, payload);
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  await api.delete(`/notes/${id}`);
}
