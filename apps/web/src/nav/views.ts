export interface View {
  label: string;
  path: string;
}

/** The views that exist. A link shows only for a view in this list: add one when its page is built. */
export const VIEWS: readonly View[] = [
  { label: "Foreman dash", path: "/" },
  { label: "Work", path: "/work" },
  { label: "Usage", path: "/usage" },
  { label: "Sessions", path: "/sessions" },
  { label: "Reviews", path: "/reviews" },
  { label: "Controls", path: "/controls" },
];
