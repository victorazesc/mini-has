"use client";

import { useEffect, useState } from "react";

export type AssetAvailability = "idle" | "checking" | "available" | "unavailable";

export function useAssetAvailability(url: string | null | undefined): AssetAvailability {
    const [availability, setAvailability] = useState<AssetAvailability>(url ? "checking" : "idle");

    useEffect(() => {
        if (!url) {
            setAvailability("idle");
            return;
        }

        const controller = new AbortController();
        setAvailability("checking");

        fetch(url, { cache: "no-store", method: "HEAD", signal: controller.signal })
            .then((response) => {
                setAvailability(response.ok ? "available" : "unavailable");
            })
            .catch(() => {
                if (!controller.signal.aborted) setAvailability("unavailable");
            });

        return () => {
            controller.abort();
        };
    }, [url]);

    return availability;
}