export interface View {
  label: string;
  path: string;
}

/** The views that exist. A link shows only for a view in this list: add one when its page is built. */
export const VIEWS: readonly View[] = [{ label: "Foreman dash", path: "/" }];
