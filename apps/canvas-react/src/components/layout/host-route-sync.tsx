import { useEffect } from "react";
import { useLocation } from "react-router";

import { getHostAppOrigin } from "@/lib/host-app";

const CANVAS_ROUTE_MESSAGE = "starclouds:canvas:route";

export function HostRouteSync() {
    const location = useLocation();

    useEffect(() => {
        if (window.parent === window) return;
        window.parent.postMessage(
            {
                type: CANVAS_ROUTE_MESSAGE,
                path: `${location.pathname}${location.search}${location.hash}`,
            },
            getHostAppOrigin(),
        );
    }, [location.hash, location.pathname, location.search]);

    return null;
}
