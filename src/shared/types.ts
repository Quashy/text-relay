export type Share = {
  id: string;
  title: string;
  body: string;
  code: string;
  enabled: boolean;
  version: number;
  created_at: number;
  updated_at: number;
};
export type ShareList = { items: Share[]; total: number; page: number; pages: number };
