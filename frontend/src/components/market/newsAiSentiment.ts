import type { NewsSentimentBatch } from "../../api/sentiment";

type ScoreableArticle = {
  id: string;
  title: string;
  summary?: string;
};

/** Keep an AI verdict attached only while the article content is unchanged. */
export function newsSentimentScoreKey(item: ScoreableArticle): string {
  return `${item.id}\u0000${item.title}\u0000${item.summary ?? ""}`;
}

/** Make mixed and degraded batches explicit instead of presenting all as LLM output. */
export function newsSentimentEngineLabel(batch: NewsSentimentBatch): string {
  if (batch.engine === "llm") return batch.model ?? "LLM";
  if (batch.engine === "mixed") return `${batch.model ?? "LLM"} + lexical fallback`;
  if (batch.engine === "lexical") return "LLM unavailable — lexical fallback";
  return "Sentiment unavailable";
}
