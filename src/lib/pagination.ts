export type PageSlice<T> = {
  items: T[];
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
};

export function paginate<T>(items: T[], requestedPage: number, pageSize: number): PageSlice<T> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize deve ser um inteiro maior que zero");
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const currentPage = Math.min(Math.max(normalizedPage, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    currentPage,
    totalPages,
    startIndex,
    endIndex: startIndex + pageItems.length,
  };
}
