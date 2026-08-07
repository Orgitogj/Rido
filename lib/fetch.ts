import { useCallback, useEffect, useState } from "react";

const resolveApiUrl = (url: string) => {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;

  const baseUrl = process.env.EXPO_PUBLIC_SERVER_URL?.replace(/\/$/, "");

  if (baseUrl) {
    return `${baseUrl}${url.startsWith("/") ? url : `/${url}`}`;
  }

  return url.startsWith("/")
    ? `http://localhost:8081${url}`
    : `http://localhost:8081/${url}`;
};

export const fetchAPI = async (url: string, options?: RequestInit) => {
  const resolvedUrl = resolveApiUrl(url);

  try {
    const response = await fetch(resolvedUrl, options);
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const trimmedText = text.trim();
    const isJsonResponse =
      contentType.includes("application/json") ||
      trimmedText.startsWith("{") ||
      trimmedText.startsWith("[");

    if (!response.ok) {
      const errorBody = isJsonResponse ? JSON.parse(text) : text;
      throw new Error(
        `HTTP error! status: ${response.status} - ${
          typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody)
        }`,
      );
    }

    if (isJsonResponse) {
      return JSON.parse(text);
    }

    return { text };
  } catch (error) {
    console.error("Fetch error:", error);
    throw error;
  }
};

export const useFetch = <T>(url: string, options?: RequestInit) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchAPI(url, options);
      setData((result && (result as any).data) ?? result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url, options]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
};
