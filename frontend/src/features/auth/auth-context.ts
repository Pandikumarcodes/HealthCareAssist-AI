import { createContext, useContext } from "react";
import type { DemoSession } from "../../services/auth";

type Auth = {
  session: DemoSession | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
export const AuthContext = createContext<Auth | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Authentication provider is required");
  return value;
}
