"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type { SimulationResult } from "@/types";

const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

interface WeatherInfo {
  air_temp: number;
  track_temp: number;
  humidity: number;
  wind_speed: number;
  rainfall: boolean;
}

interface FreshnessState {
  results: SimulationResult[];
  lastUpdated: string | null;
  isLoading: boolean;
  status: string;
  raceName: string;
  dataSources: string[];
  hasQualifying: boolean;
  hasLongRuns: boolean;
  weather: WeatherInfo | null;
}

export function useFreshness(raceId: number | null) {
  const [state, setState] = useState<FreshnessState>({
    results: [],
    lastUpdated: null,
    isLoading: false,
    status: "idle",
    raceName: "",
    dataSources: [],
    hasQualifying: false,
    hasLongRuns: false,
    weather: null,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCached = useCallback(async () => {
    if (!raceId) return;

    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const data = await api.getCachedSimulation(raceId);
      setState({
        results: data.results || [],
        lastUpdated: data.simulated_at,
        isLoading: false,
        status: data.status,
        raceName: data.race_name || "",
        dataSources: data.data_sources || [],
        hasQualifying: data.has_qualifying || false,
        hasLongRuns: data.has_long_runs || false,
        weather: data.weather || null,
      });
    } catch {
      setState((prev) => ({ ...prev, isLoading: false, status: "error" }));
    }
  }, [raceId]);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      await api.triggerRefresh();
      await fetchCached();
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [fetchCached]);

  // Fetch on mount and when raceId changes
  useEffect(() => {
    fetchCached();
  }, [fetchCached]);

  // Poll every 15 minutes
  useEffect(() => {
    if (!raceId) return;
    intervalRef.current = setInterval(fetchCached, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchCached, raceId]);

  const timeSinceUpdate = state.lastUpdated
    ? Math.round((Date.now() - new Date(state.lastUpdated).getTime()) / 60000)
    : null;

  return {
    ...state,
    refresh,
    timeSinceUpdate,
    hasCachedData: state.results.length > 0,
  };
}
