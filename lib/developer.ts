export const developer = {
  get name() {
    return process.env.DEVELOPER_NAME?.trim() || "Software Hub developer";
  },
  get email() {
    const value = process.env.DEVELOPER_EMAIL?.trim().toLowerCase() || "";
    return /^[^@\s<>]+@caedm\.ca$/.test(value) ? value : "";
  },
  title: "Developer, CAEDM Software Hub",
} as const;
