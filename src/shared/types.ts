export type Attachment = { id: string; name: string; size: number };
export type PublicAttachment = Omit<Attachment, 'id'> & { downloadUrl: string };
export type Share = {
  attachment?: Attachment | null;
  cleanupPending?: boolean;
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

export type UserAccount = {
  id: number;
  username: string;
  role: 'superadmin' | 'user';
  version: number;
  created_at: number;
  updated_at: number;
};
