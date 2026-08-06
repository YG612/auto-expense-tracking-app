export interface Tag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionTag {
  transactionId: string;
  tagId: string;
}
