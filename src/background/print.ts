import type { PageState } from '../shared/messages';

/** Recolors Google's print PDF on its way to the tab (implemented in the printing milestone). */
export function installPrintInterceptor(_resolve: (url: string) => Promise<PageState>) {}
