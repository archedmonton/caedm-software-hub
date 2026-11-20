"use client";
import { createContext, useContext } from "react";
type Contact = { name: string; email: string; title: string };
const ContactContext = createContext<Contact>({
  name: "Software Hub developer",
  email: "",
  title: "Developer, CAEDM Software Hub",
});
export function DeveloperContactProvider({
  value,
  children,
}: {
  value: Contact;
  children: React.ReactNode;
}) {
  return (
    <ContactContext.Provider value={value}>{children}</ContactContext.Provider>
  );
}
export const useDeveloperContact = () => useContext(ContactContext);
