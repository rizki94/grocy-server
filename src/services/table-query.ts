// types for table query params
export interface TableQueryParams {
    pageIndex?: string | number;
    pageSize?: string | number;
    search?: string;
    select?: string;
    sort?: string;
    order?: "asc" | "desc" | string;
    groupBy?: string;
    filters?: Record<string, string | number>;
    from?: string | Date;
    to?: string | Date;
}

export interface ParsedTableParams {
    pageIndex: number;
    pageSize: number;
    offset: number;
    search: string;
    select: string;
    sort: string;
    order: "asc" | "desc";
    groupBy?: string;
    filters: Record<string, string | number>;
    from?: Date;
    to?: Date;
}

export const parseTableQuery = (query: TableQueryParams): ParsedTableParams => {
    const pageIndex = Number(query.pageIndex ?? 0);
    const pageSize = Number(query.pageSize ?? 10);
    const offset = pageIndex * pageSize;

    const search = (query.search ?? "").trim();
    const select = query.select ?? "";
    const sort = query.sort ?? "";
    const order = query.order?.toLowerCase() === "desc" ? "desc" : "asc";

    const groupBy = query.groupBy ?? undefined;
    const filters = query.filters ?? {};

    const parseDate = (value?: string | Date): Date | undefined => {
        if (!value) return undefined;
        if (value instanceof Date) return value;
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? undefined : parsed;
    };

    const from = parseDate(query.from);
    const to = parseDate(query.to);

    return {
        pageIndex,
        pageSize,
        offset,
        search,
        select,
        sort,
        order,
        groupBy,
        filters,
        from,
        to,
    };
};
