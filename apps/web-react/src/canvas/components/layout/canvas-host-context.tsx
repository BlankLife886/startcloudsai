import { createContext, useContext, type ReactNode } from "react";

type CanvasHostContextValue = {
    isAuthenticated: boolean;
    requestAuth: () => void;
};

const CanvasHostContext = createContext<CanvasHostContextValue>({
    isAuthenticated: true,
    requestAuth: () => undefined,
});

export function CanvasHostProvider({ children, isAuthenticated, requestAuth }: CanvasHostContextValue & { children: ReactNode }) {
    return <CanvasHostContext.Provider value={{ isAuthenticated, requestAuth }}>{children}</CanvasHostContext.Provider>;
}

export function useCanvasHost() {
    return useContext(CanvasHostContext);
}
