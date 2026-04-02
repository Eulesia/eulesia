import type { Request } from "express";
import type { User, AdminAccount } from "../db/schema.js";

export interface AuthenticatedRequest extends Request {
  user?: User;
  sessionId?: string;
}

export interface AdminAuthenticatedRequest extends Request {
  admin?: AdminAccount;
  adminSessionId?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Thread filters
export interface ThreadFilters {
  scope?: "local" | "national" | "european";
  municipalityId?: string;
  tags?: string[];
  authorId?: string;
}

// Institutional context structure
export interface InstitutionalContext {
  docs?: { title: string; url: string }[];
  timeline?: { date: string; event: string }[];
  faq?: { q: string; a: string }[];
  contact?: string;
}
