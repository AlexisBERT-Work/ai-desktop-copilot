/** Vocabulaire d'un article de presse, partagé par tout le pipeline. */
export interface NewsItem {
  title: string;
  url: string;
  source: string;
  points?: number;
  comments?: number;
  publishedAt?: string; // ISO 8601
  excerpt?: string; // short plain-text teaser, used as input for summarization
  fullText?: string; // article body fetched from the page (enrichArticleTexts), capped
}
