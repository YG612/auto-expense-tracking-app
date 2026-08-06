export interface Project {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budgetMinor?: number;
  currency: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}
