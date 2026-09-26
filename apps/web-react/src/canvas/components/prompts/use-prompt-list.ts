import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { ALL_PROMPTS_OPTION, fetchPromptCategories, fetchPrompts } from "@/services/api/prompts";

export const PROMPT_PAGE_SIZE = 20;

export function usePromptList({ keyword, tags, category, enabled = true }: { keyword: string; tags: string[]; category: string; enabled?: boolean }) {
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => clearTimeout(timer);
    }, [keyword]);
    const query = useInfiniteQuery({
        queryKey: ["prompts", debouncedKeyword, tags, category],
        queryFn: ({ pageParam }) => fetchPrompts({ keyword: debouncedKeyword, tag: tags, category, cursor: pageParam, pageSize: PROMPT_PAGE_SIZE }),
        initialPageParam: "",
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled,
    });
    const categoryQuery = useQuery({
        queryKey: ["prompt-categories"],
        queryFn: () => fetchPromptCategories(),
        enabled,
        staleTime: 60_000,
    });
    const firstPage = query.data?.pages[0];
    const categories = useMemo(() => {
        const configured = categoryQuery.data?.length ? categoryQuery.data : (firstPage?.categories || []).map((value) => ({ value, label: value }));
        return [{ value: ALL_PROMPTS_OPTION, label: ALL_PROMPTS_OPTION }, ...configured];
    }, [categoryQuery.data, firstPage?.categories]);
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        tags: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.tags || [])], [firstPage?.tags]),
        categories,
        total: firstPage?.total || 0,
    };
}
