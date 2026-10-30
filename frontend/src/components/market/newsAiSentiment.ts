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
  const model = batch.model_profile ? `Fast profile · ${batch.model}` : batch.model ?? "LLM";
  if (batch.engine === "llm") return model;
  if (batch.engine === "mixed") return `${model} + lexical fallback`;
  if (batch.engine === "lexical") return "LLM unavailable — lexical fallback";
  return "Sentiment unavailable";
}
