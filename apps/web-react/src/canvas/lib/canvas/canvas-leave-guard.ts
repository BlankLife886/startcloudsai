export function shouldBlockCanvasNavigation(currentPathname: string, nextPathname: string, active: boolean, forceLeaving: boolean) {
    return active && !forceLeaving && currentPathname !== nextPathname;
}
